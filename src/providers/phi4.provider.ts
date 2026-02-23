import { BaseLlmProvider } from "./base.js";
import { LlmResponse, type ChatMessage, type ChatOptions, type ToolCallRequest } from "./types.js";

function parse_json_or_raw(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : { raw };
  } catch {
    return { raw };
  }
}

function sanitize_messages(messages: ChatMessage[]): Array<Record<string, unknown>> {
  return messages.map((m) => {
    const out: Record<string, unknown> = {
      role: m.role,
      content: m.content ?? "",
    };
    if (Array.isArray(m.tool_calls) && m.tool_calls.length > 0) out.tool_calls = m.tool_calls;
    if (typeof m.tool_call_id === "string") out.tool_call_id = m.tool_call_id;
    if (typeof m.name === "string") out.name = m.name;
    return out;
  });
}

export class Phi4LocalProvider extends BaseLlmProvider {
  constructor(args?: { api_base?: string; default_model?: string }) {
    super({
      id: "phi4_local",
      api_base: args?.api_base ?? (process.env.PHI4_API_BASE || "http://127.0.0.1:11434/v1"),
      default_model: args?.default_model ?? (process.env.PHI4_MODEL || "phi4"),
    });
  }

  async chat(options: ChatOptions): Promise<LlmResponse> {
    const normalized = this.normalize_options(options);
    const body: Record<string, unknown> = {
      model: options.model || this.default_model,
      messages: sanitize_messages(this.sanitize_messages(options.messages)),
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

      const response = await fetch(`${this.api_base}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: options.abort_signal,
      });
      const raw = (await response.json()) as Record<string, unknown>;
      if (!response.ok) {
        return new LlmResponse({
          content: `Error calling phi4_local: ${JSON.stringify(raw)}`,
          finish_reason: "error",
        });
      }

      const choices = Array.isArray(raw.choices) ? raw.choices : [];
      const first = (choices[0] as Record<string, unknown>) || {};
      const message = (first.message as Record<string, unknown>) || {};
      const tool_calls_raw = Array.isArray(message.tool_calls) ? message.tool_calls : [];
      const tool_calls: ToolCallRequest[] = tool_calls_raw
        .map((tc): ToolCallRequest | null => {
          const rec = tc as Record<string, unknown>;
          const fn = (rec.function as Record<string, unknown>) || {};
          const id = String(rec.id || "");
          const name = String(fn.name || rec.name || "");
          if (!id || !name) return null;
          return {
            id,
            name,
            arguments: parse_json_or_raw(fn.arguments || rec.arguments),
          };
        })
        .filter((v): v is ToolCallRequest => Boolean(v));

      const usage_raw = (raw.usage as Record<string, unknown>) || {};
      return new LlmResponse({
        content: typeof message.content === "string" ? message.content : null,
        tool_calls,
        finish_reason: typeof first.finish_reason === "string" ? first.finish_reason : "stop",
        usage: {
          prompt_tokens: Number(usage_raw.prompt_tokens || 0),
          completion_tokens: Number(usage_raw.completion_tokens || 0),
          total_tokens: Number(usage_raw.total_tokens || 0),
        },
      });
    } catch (error) {
      return new LlmResponse({
        content: `Error calling phi4_local: ${error instanceof Error ? error.message : String(error)}`,
        finish_reason: "error",
      });
    }
  }
}
