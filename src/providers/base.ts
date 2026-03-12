import type { ChatMessage, ChatOptions, LlmProvider, ProviderId } from "./types.js";
import { LlmResponse } from "./types.js";
import { ndjson_to_stream_events, type NdjsonConverterState } from "./cli-protocol.js";
import type { StreamEvent } from "../channels/stream-event.js";

/**
 * OpenAI Chat Completions SSE 스트림 파싱.
 * `data: {JSON}` 또는 plain NDJSON 모두 처리. `data: [DONE]`에서 종료.
 * on_stream_event가 있으면 StreamEvent를 emit (tool_start, usage 등 포함).
 * on_stream은 delta 텍스트만 emit (하위 호환).
 */
export async function parse_openai_sse_stream(
  body: ReadableStream<Uint8Array>,
  opts: {
    on_stream?: (chunk: string) => void | Promise<void>;
    on_stream_event?: (event: StreamEvent) => void | Promise<void>;
  },
): Promise<LlmResponse> {
  const { on_stream, on_stream_event } = opts;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full_content = "";
  const state: NdjsonConverterState = { last_full_text: "", metadata: {} };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === "data: [DONE]" || trimmed === "[DONE]") continue;
        const json_str = trimmed.startsWith("data: ") ? trimmed.slice(6) : trimmed;
        if (!json_str.startsWith("{")) continue;
        try {
          const chunk = JSON.parse(json_str) as Record<string, unknown>;
          const events = ndjson_to_stream_events(chunk, state);
          for (const ev of events) {
            if (on_stream_event) {
              try { await on_stream_event(ev); } catch { /* 실패 무시 */ }
            }
            if (ev.type === "delta") {
              full_content += ev.content;
              if (on_stream) {
                try { await on_stream(ev.content); } catch { /* 실패 무시 */ }
              }
            }
          }
        } catch { /* JSON 파싱 실패 무시 */ }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return new LlmResponse({
    content: full_content || null,
    finish_reason: "stop",
    metadata: state.metadata ?? {},
  });
}

export abstract class BaseLlmProvider implements LlmProvider {
  readonly id: ProviderId;
  readonly supports_tool_loop: boolean;
  protected readonly api_base: string;
  protected readonly default_model: string;

  constructor(args: {
    id: ProviderId;
    api_base: string;
    default_model: string;
    supports_tool_loop?: boolean;
  }) {
    this.id = args.id;
    this.api_base = args.api_base;
    this.default_model = args.default_model;
    this.supports_tool_loop = args.supports_tool_loop ?? false;
  }

  get_default_model(): string {
    return this.default_model;
  }

  protected sanitize_messages(messages: ChatMessage[]): ChatMessage[] {
    const out: ChatMessage[] = [];
    for (const msg of messages) {
      const content = msg.content;
      if (typeof content === "string" && content.length === 0) {
        out.push({
          ...msg,
          content: msg.role === "assistant" && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0 ? null : "(empty)",
        });
        continue;
      }
      if (Array.isArray(content)) {
        const filtered = content.filter((item) => {
          if (!item || typeof item !== "object") return true;
          const rec = item as Record<string, unknown>;
          if (!["text", "input_text", "output_text"].includes(String(rec.type || ""))) return true;
          return Boolean(rec.text);
        });
        out.push({
          ...msg,
          content: filtered.length > 0
            ? filtered
            : (msg.role === "assistant" && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0 ? null : "(empty)"),
        });
        continue;
      }
      out.push(msg);
    }
    return out;
  }

  protected normalize_options(options: ChatOptions): Required<Pick<ChatOptions, "max_tokens" | "temperature">> {
    return {
      max_tokens: Math.max(1, Number(options.max_tokens ?? 4096)),
      temperature: Number(options.temperature ?? 0.7),
    };
  }

  abstract chat(options: ChatOptions): Promise<LlmResponse>;
}
