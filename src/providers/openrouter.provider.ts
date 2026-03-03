import { BaseLlmProvider } from "./base.js";
import { create_logger } from "../logger.js";
import { LlmResponse, parse_openai_response, sanitize_messages_for_api, type ChatOptions } from "./types.js";

const log = create_logger("provider:openrouter");

const DEFAULT_TIMEOUT_MS = 120_000;

export class OpenRouterProvider extends BaseLlmProvider {
  private readonly http_referer: string;
  private readonly app_title: string;
  private readonly api_key: string;

  constructor(args?: {
    api_base?: string; default_model?: string;
    api_key?: string; http_referer?: string; app_title?: string;
  }) {
    super({
      id: "openrouter",
      api_base: args?.api_base ?? "https://openrouter.ai/api/v1",
      default_model: args?.default_model ?? "openai/gpt-4.1-mini",
      supports_tool_loop: true,
    });
    this.api_key = (args?.api_key ?? "").trim();
    this.http_referer = (args?.http_referer ?? "").trim();
    this.app_title = (args?.app_title ?? "").trim();
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
      if (!this.api_key) throw new Error("openrouter_api_key_missing");
      const api_key = this.api_key;
      const headers: Record<string, string> = {
        Authorization: `Bearer ${api_key}`,
        "Content-Type": "application/json",
      };
      if (this.http_referer) headers["HTTP-Referer"] = this.http_referer;
      if (this.app_title) headers["X-Title"] = this.app_title;

      const timeout_signal = AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
      const signal = options.abort_signal
        ? AbortSignal.any([options.abort_signal, timeout_signal])
        : timeout_signal;

      const response = await fetch(`${this.api_base}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal,
      });
      const raw = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        log.warn("api error", { status: response.status, model: body.model });
        return new LlmResponse({
          content: `Error calling OpenRouter: ${JSON.stringify(raw)}`,
          finish_reason: "error",
        });
      }

      const parsed = parse_openai_response(raw);
      return new LlmResponse(parsed);
    } catch (error) {
      log.warn("request failed", { error: error instanceof Error ? error.message : String(error) });
      return new LlmResponse({
        content: `Error calling OpenRouter: ${error instanceof Error ? error.message : String(error)}`,
        finish_reason: "error",
      });
    }
  }
}
