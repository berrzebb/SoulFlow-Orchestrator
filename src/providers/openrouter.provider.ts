import { BaseLlmProvider } from "./base.js";
import { LlmResponse, parse_openai_response, sanitize_messages_for_api, type ChatOptions } from "./types.js";

const DEFAULT_TIMEOUT_MS = 120_000;

export class OpenRouterProvider extends BaseLlmProvider {
  constructor(args?: { api_base?: string; default_model?: string }) {
    super({
      id: "openrouter",
      api_base: args?.api_base ?? (process.env.OPENROUTER_API_BASE || "https://openrouter.ai/api/v1"),
      default_model: args?.default_model ?? (process.env.OPENROUTER_MODEL || "openai/gpt-4.1-mini"),
    });
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
      const api_key = this.require_env("OPENROUTER_API_KEY");
      const headers: Record<string, string> = {
        Authorization: `Bearer ${api_key}`,
        "Content-Type": "application/json",
      };
      const referer = String(process.env.OPENROUTER_HTTP_REFERER || "").trim();
      const title = String(process.env.OPENROUTER_APP_TITLE || "").trim();
      if (referer) headers["HTTP-Referer"] = referer;
      if (title) headers["X-Title"] = title;

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
        return new LlmResponse({
          content: `Error calling OpenRouter: ${JSON.stringify(raw)}`,
          finish_reason: "error",
        });
      }

      const parsed = parse_openai_response(raw);
      return new LlmResponse(parsed);
    } catch (error) {
      return new LlmResponse({
        content: `Error calling OpenRouter: ${error instanceof Error ? error.message : String(error)}`,
        finish_reason: "error",
      });
    }
  }
}
