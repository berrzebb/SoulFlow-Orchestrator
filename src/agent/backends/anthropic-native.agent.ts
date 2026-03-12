/**
 * Anthropic 네이티브 API 백엔드.
 * system + 도구 목록 끝에 `cache_control: { type: "ephemeral" }` 추가 (프롬프트 캐싱).
 * 스트리밍: SSE(text/event-stream), delta 단위로 on_stream 콜백 호출.
 */

import type { ToolSchema } from "../tools/types.js";
import type { ToolExecutionContext } from "../tools/types.js";
import type {
  AgentBackend, AgentBackendId, AgentEventSource,
  AgentRunOptions, AgentRunResult, BackendCapabilities,
} from "../agent.types.js";
import {
  build_executor_map, execute_single_tool, map_finish_reason,
  fire, accum_usage, emit_usage,
  type UsageAccumulator,
} from "./tool-loop-helpers.js";
import { now_iso, error_message, swallow, make_abort_signal } from "../../utils/common.js";

export type AnthropicNativeConfig = {
  api_base?: string;
  api_key: string;
  model: string;
  max_tokens?: number;
  temperature?: number;
  /** extended thinking: 0이면 비활성. */
  thinking_budget_tokens?: number;
  request_timeout_ms?: number;
};

// ── Anthropic API 내부 타입 ──

type TextBlock = { type: "text"; text: string };
type ToolUseBlock = { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };
type ToolResultBlock = { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };
type AnthropicContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

type AnthropicMessage = {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
};

type AnthropicTool = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  cache_control?: { type: "ephemeral" };
};

type AnthropicSystemBlock = {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
};

type AnthropicApiUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
};

type SseEvent =
  | { type: "message_start"; message: { usage?: AnthropicApiUsage } }
  | { type: "content_block_start"; index: number; content_block: { type: string; id?: string; name?: string } }
  | { type: "content_block_delta"; index: number; delta: { type: string; text?: string; partial_json?: string; thinking?: string } }
  | { type: "content_block_stop"; index: number }
  | { type: "message_delta"; delta: { stop_reason?: string }; usage?: { output_tokens: number } };

/** OpenAI ToolSchema → Anthropic Tool (마지막 도구에 cache_control 추가). */
function to_anthropic_tool(t: ToolSchema, is_last: boolean): AnthropicTool {
  return {
    name: t.function.name,
    description: t.function.description,
    input_schema: (t.function.parameters as Record<string, unknown>) ?? { type: "object", properties: {} },
    ...(is_last ? { cache_control: { type: "ephemeral" } } : {}),
  };
}

/** AnthropicApiUsage → LlmUsage (accum_usage 호환). */
function to_llm_usage(u: AnthropicApiUsage): import("../../providers/types.js").LlmUsage {
  return {
    prompt_tokens: u.input_tokens,
    completion_tokens: u.output_tokens,
    cache_read_input_tokens: u.cache_read_input_tokens,
    cache_creation_input_tokens: u.cache_creation_input_tokens,
  };
}

export class AnthropicNativeAgent implements AgentBackend {
  readonly native_tool_loop = true;
  readonly supports_resume = false;
  readonly capabilities: BackendCapabilities = {
    approval: false,
    structured_output: false,
    thinking: true,
    budget_tracking: false,
    tool_filtering: false,
    tool_result_events: true,
    send_input: false,
    tool_executors: true,
  };

  constructor(
    readonly id: AgentBackendId,
    private readonly config: AnthropicNativeConfig,
  ) {}

  is_available(): boolean { return Boolean(this.config.api_key); }

  async run(options: AgentRunOptions): Promise<AgentRunResult> {
    const emit = options.hooks?.on_event;
    const source: AgentEventSource = { backend: this.id, task_id: options.task_id };
    const executors = build_executor_map(options.tool_executors);
    const tool_ctx: ToolExecutionContext = {
      task_id: options.task_id,
      signal: options.abort_signal,
      ...options.tool_context,
    };

    const tools = options.tools?.length
      ? options.tools.map((t, i) => to_anthropic_tool(t, i === options.tools!.length - 1))
      : undefined;
    const system: AnthropicSystemBlock[] | undefined = options.system_prompt
      ? [{ type: "text", text: options.system_prompt, cache_control: { type: "ephemeral" } }]
      : undefined;

    const conversation: AnthropicMessage[] = [{ role: "user", content: options.task }];
    const max_turns = executors.size > 0 ? (options.max_turns ?? 8) : 1;
    let total_tool_calls = 0;
    const usage: UsageAccumulator = { input: 0, output: 0, cache_read: 0, cache_creation: 0, cost: 0 };

    fire(emit, { type: "init", source, at: now_iso() });

    try {
      for (let turn = 0; turn < max_turns; turn++) {
        if (options.abort_signal?.aborted) break;

        const { text_blocks, tool_blocks, stop_reason, api_usage } =
          await this._stream_turn(system, tools, conversation, options, emit, source);

        accum_usage(usage, to_llm_usage(api_usage));

        const result_text = text_blocks.map((b) => b.text).join("") || null;

        if (stop_reason !== "tool_use" || tool_blocks.length === 0 || executors.size === 0) {
          const finish = stop_reason === "max_tokens" ? "max_tokens" : "stop";
          fire(emit, {
            type: "complete", source, at: now_iso(),
            finish_reason: map_finish_reason(finish === "max_tokens" ? "length" : "stop"),
            content: result_text ?? undefined,
          });
          emit_usage(emit, source, usage);
          return {
            content: result_text,
            session: null,
            tool_calls_count: total_tool_calls,
            usage: {
              prompt_tokens: usage.input || undefined,
              completion_tokens: usage.output || undefined,
              cache_read_input_tokens: usage.cache_read || undefined,
              cache_creation_input_tokens: usage.cache_creation || undefined,
            },
            finish_reason: finish,
            metadata: { model: this.config.model },
          };
        }

        // 도구 실행 후 대화 계속
        const all_blocks: AnthropicContentBlock[] = [...text_blocks, ...tool_blocks];
        conversation.push({ role: "assistant", content: all_blocks });

        const tool_results: ToolResultBlock[] = [];
        total_tool_calls += tool_blocks.length;

        for (const tb of tool_blocks) {
          fire(emit, {
            type: "tool_use", source, at: now_iso(),
            tool_name: tb.name, tool_id: tb.id, params: tb.input,
          });
          const result = await execute_single_tool(tb.name, tb.input, executors, tool_ctx, options.hooks);
          tool_results.push({ type: "tool_result", tool_use_id: tb.id, content: result.text, is_error: result.is_error || undefined });
          fire(emit, {
            type: "tool_result", source, at: now_iso(),
            tool_name: tb.name, tool_id: tb.id,
            result: result.text, is_error: result.is_error,
          });
        }
        conversation.push({ role: "user", content: tool_results });
      }

      // max_turns 초과
      emit_usage(emit, source, usage);
      fire(emit, { type: "complete", source, at: now_iso(), finish_reason: "max_turns" });
      return {
        content: null, session: null,
        tool_calls_count: total_tool_calls,
        usage: { prompt_tokens: usage.input || undefined, completion_tokens: usage.output || undefined },
        finish_reason: "max_turns",
        metadata: { model: this.config.model },
      };
    } catch (error) {
      const msg = error_message(error);
      fire(emit, { type: "error", source, at: now_iso(), error: msg });
      return { content: `Error: ${msg}`, session: null, tool_calls_count: total_tool_calls, usage: {}, finish_reason: "error", metadata: { error: msg } };
    }
  }

  /**
   * SSE 스트림 1턴 실행.
   * 텍스트 delta → on_stream 콜백 + content_delta 이벤트.
   * tool_use input → 내부에서 조합.
   */
  private async _stream_turn(
    system: AnthropicSystemBlock[] | undefined,
    tools: AnthropicTool[] | undefined,
    messages: AnthropicMessage[],
    options: AgentRunOptions,
    emit: ((e: import("../agent.types.js").AgentEvent) => void | Promise<void>) | undefined,
    source: AgentEventSource,
  ): Promise<{
    text_blocks: TextBlock[];
    tool_blocks: ToolUseBlock[];
    stop_reason: string;
    api_usage: AnthropicApiUsage;
  }> {
    const model = options.model || this.config.model;
    const max_tokens = options.max_tokens ?? this.config.max_tokens ?? 8096;
    const temperature = options.temperature ?? this.config.temperature;
    const thinking_tokens = (options.enable_thinking || options.max_thinking_tokens)
      ? (options.max_thinking_tokens ?? this.config.thinking_budget_tokens ?? 10000)
      : undefined;

    const body: Record<string, unknown> = {
      model, max_tokens, stream: true, messages,
      ...(system?.length ? { system } : {}),
      ...(tools?.length ? { tools } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
      ...(thinking_tokens ? { thinking: { type: "enabled", budget_tokens: thinking_tokens } } : {}),
    };

    const api_base = (this.config.api_base ?? "https://api.anthropic.com").replace(/\/+$/, "");

    const signal = make_abort_signal(this.config.request_timeout_ms ?? 120_000, options.abort_signal);

    const res = await fetch(`${api_base}/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.config.api_key,
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "prompt-caching-2024-07-31",
        },
        body: JSON.stringify(body),
        signal,
      });
      if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
      if (!res.body) throw new Error("Response body missing");

      const api_usage: AnthropicApiUsage = {};
      const text_bufs = new Map<number, string>(); // index → 누적 텍스트
      const tool_input_bufs = new Map<number, string>(); // index → 누적 JSON
      const tool_meta = new Map<number, { id: string; name: string }>();
      const thinking_bufs = new Map<number, string>(); // index → 누적 thinking 텍스트
      let stop_reason = "end_turn";

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let leftover = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        leftover += decoder.decode(value, { stream: true });
        const lines = leftover.split("\n");
        leftover = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (raw === "[DONE]") continue;
          let ev: SseEvent;
          try { ev = JSON.parse(raw) as SseEvent; } catch { continue; }

          switch (ev.type) {
            case "message_start":
              if (ev.message.usage) Object.assign(api_usage, ev.message.usage);
              break;
            case "content_block_start": {
              const cb = ev.content_block;
              if (cb.type === "text") {
                text_bufs.set(ev.index, "");
              } else if (cb.type === "thinking") {
                thinking_bufs.set(ev.index, "");
              } else if (cb.type === "tool_use" && cb.id && cb.name) {
                tool_meta.set(ev.index, { id: cb.id, name: cb.name });
                tool_input_bufs.set(ev.index, "");
              }
              break;
            }
            case "content_block_delta": {
              const d = ev.delta;
              if (d.type === "text_delta" && d.text) {
                text_bufs.set(ev.index, (text_bufs.get(ev.index) ?? "") + d.text);
                fire(emit, { type: "content_delta", source, at: now_iso(), text: d.text });
                if (options.hooks?.on_stream) swallow(options.hooks.on_stream(d.text));
              } else if (d.type === "thinking_delta" && d.thinking) {
                thinking_bufs.set(ev.index, (thinking_bufs.get(ev.index) ?? "") + d.thinking);
              } else if (d.type === "input_json_delta" && d.partial_json !== undefined) {
                tool_input_bufs.set(ev.index, (tool_input_bufs.get(ev.index) ?? "") + d.partial_json);
              }
              break;
            }
            case "content_block_stop": {
              // thinking 블록 완성 시 이벤트 발행
              const thinking_text = thinking_bufs.get(ev.index);
              if (thinking_text !== undefined) {
                fire(emit, { type: "thinking", source, at: now_iso(), thinking_text });
                thinking_bufs.delete(ev.index);
              }
              break;
            }
            case "message_delta":
              if (ev.delta.stop_reason) stop_reason = ev.delta.stop_reason;
              if (ev.usage) api_usage.output_tokens = (api_usage.output_tokens ?? 0) + ev.usage.output_tokens;
              break;
          }
        }
      }

      // 누적 버퍼 → 블록 변환
      const text_blocks: TextBlock[] = [...text_bufs.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, text]) => ({ type: "text" as const, text }))
        .filter((b) => b.text);

      const tool_blocks: ToolUseBlock[] = [...tool_meta.entries()]
        .sort(([a], [b]) => a - b)
        .map(([index, meta]) => {
          const raw = tool_input_bufs.get(index) ?? "{}";
          let input: Record<string, unknown> = {};
          try { input = JSON.parse(raw) as Record<string, unknown>; } catch (e) {
            process.stderr.write(`[anthropic-native] tool input JSON parse failed: tool=${meta.name} raw=${raw.slice(0, 200)} err=${error_message(e)}\n`);
          }
          return { type: "tool_use" as const, id: meta.id, name: meta.name, input };
        });

      return { text_blocks, tool_blocks, stop_reason, api_usage };
  }

  /** 단순 텍스트 응답 전용 정적 헬퍼 (비스트리밍). system 캐싱 포함. */
  static async simple_call(params: {
    api_key: string;
    model: string;
    system?: string;
    messages: { role: "user" | "assistant"; content: string }[];
    max_tokens?: number;
    api_base?: string;
    signal?: AbortSignal;
  }): Promise<string> {
    const base = (params.api_base ?? "https://api.anthropic.com").replace(/\/+$/, "");
    const system: AnthropicSystemBlock[] | undefined = params.system
      ? [{ type: "text", text: params.system, cache_control: { type: "ephemeral" } }]
      : undefined;
    const res = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": params.api_key,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "prompt-caching-2024-07-31",
      },
      body: JSON.stringify({
        model: params.model,
        max_tokens: params.max_tokens ?? 4096,
        messages: params.messages,
        ...(system ? { system } : {}),
      }),
      signal: params.signal ?? AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
    const data = await res.json() as { content: { type: string; text: string }[] };
    return data.content.filter((b) => b.type === "text").map((b) => b.text).join("") || "";
  }
}
