import { error_message } from "../utils/common.js";
import { BaseLlmProvider } from "./base.js";
import { create_logger } from "../logger.js";
import { LlmResponse, parse_openai_response, sanitize_messages_for_api, type ChatOptions } from "./types.js";
import { parse_tool_calls_from_text } from "../agent/tool-call-parser.js";

const log = create_logger("provider:orchestrator-llm");

const DEFAULT_PER_CALL_TIMEOUT_MS = 90_000;

export class OrchestratorLlmProvider extends BaseLlmProvider {
  private readonly per_call_timeout_ms: number;
  private readonly api_key: string;

  constructor(args?: {
    api_base?: string; default_model?: string;
    per_call_timeout_ms?: number; api_key?: string;
  }) {
    super({
      id: "orchestrator_llm",
      api_base: args?.api_base ?? "http://ollama:11434/v1",
      default_model: args?.default_model ?? "",
    });
    this.per_call_timeout_ms = args?.per_call_timeout_ms ?? DEFAULT_PER_CALL_TIMEOUT_MS;
    this.api_key = (args?.api_key ?? "").trim();
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
      if (this.api_key) headers.Authorization = `Bearer ${this.api_key}`;

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
        log.warn("api error", { status: response.status, model: body.model });
        return new LlmResponse({
          content: `Error calling orchestrator_llm: ${JSON.stringify(raw)}`,
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
      log.warn("request failed", { error: error_message(error) });
      return new LlmResponse({
        content: `Error calling orchestrator_llm: ${error_message(error)}`,
        finish_reason: "error",
      });
    }
  }
}
