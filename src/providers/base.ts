import type { ChatMessage, ChatOptions, LlmProvider, LlmResponse, ProviderId } from "./types.js";

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

  protected require_env(name: string): string {
    const value = String(process.env[name] || "").trim();
    if (!value) throw new Error(`env_missing:${name}`);
    return value;
  }

  abstract chat(options: ChatOptions): Promise<LlmResponse>;
}
