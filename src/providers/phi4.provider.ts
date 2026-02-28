import { BaseLlmProvider } from "./base.js";
import { LlmResponse, parse_openai_response, sanitize_messages_for_api, type ChatOptions } from "./types.js";
import { parse_tool_calls_from_text } from "../agent/tool-call-parser.js";

const DEFAULT_PER_CALL_TIMEOUT_MS = 90_000;

export class Phi4LocalProvider extends BaseLlmProvider {
  private readonly per_call_timeout_ms: number;

  constructor(args?: { api_base?: string; default_model?: string; per_call_timeout_ms?: number }) {
    super({
      id: "phi4_local",
      api_base: args?.api_base ?? (process.env.PHI4_API_BASE || "http://127.0.0.1:11434/v1"),
      default_model: args?.default_model ?? (process.env.PHI4_MODEL || "phi4"),
    });
    this.per_call_timeout_ms = args?.per_call_timeout_ms ?? DEFAULT_PER_CALL_TIMEOUT_MS;
  }

  async chat(options: ChatOptions): Promise<LlmResponse> {
    const normalized = this.normalize_options(options);
    const body: Record<string, unknown> = {
      model: options.model || this.default_model,
      messages: sanitize_messages_for_api(this.sanitize_messages(options.messages)),
      max_tokens: normalized.max_tokens,
      temperature: normalized.temperature,
    };
    if (Array.isArray(options.tools) && options.tools.length > 0) {
      body.tools = options.tools;
      body.tool_choice = "auto";
    }

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (process.env.PHI4_API_KEY) headers.Authorization = `Bearer ${process.env.PHI4_API_KEY}`;

      const timeout_signal = AbortSignal.timeout(this.per_call_timeout_ms);
      const signal = options.abort_signal
        ? AbortSignal.any([options.abort_signal, timeout_signal])
        : timeout_signal;

      const response = await fetch(`${this.api_base}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal,
      });
      const raw = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (!response.ok) {
        return new LlmResponse({
          content: `Error calling phi4_local: ${JSON.stringify(raw)}`,
          finish_reason: "error",
        });
      }

      const parsed = parse_openai_response(raw);

      // 소형 LLM은 tool_calls를 구조화된 필드 대신 콘텐츠에 텍스트로 출력하는 경우가 있음
      if (parsed.tool_calls.length === 0 && parsed.content && Array.isArray(options.tools) && options.tools.length > 0) {
        const extracted = parse_tool_calls_from_text(parsed.content);
        if (extracted.length > 0) {
          return new LlmResponse({ ...parsed, content: null, tool_calls: extracted });
        }
      }

      return new LlmResponse(parsed);
    } catch (error) {
      return new LlmResponse({
        content: `Error calling phi4_local: ${error instanceof Error ? error.message : String(error)}`,
        finish_reason: "error",
      });
    }
  }
}
