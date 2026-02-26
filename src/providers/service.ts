import { CliHeadlessProvider } from "./cli.provider.js";
import { OpenRouterProvider } from "./openrouter.provider.js";
import { Phi4LocalProvider } from "./phi4.provider.js";
import type { ChatMessage, ChatOptions, LlmProvider, LlmResponse, ProviderId } from "./types.js";
import type { ContextBuilder } from "../agent/context.js";
import { redact_sensitive_text, redact_sensitive_unknown } from "../security/sensitive.js";
import { SecretVaultService } from "../security/secret-vault.js";

function parse_provider_id(raw: string): ProviderId | null {
  const v = String(raw || "").trim().toLowerCase();
  if (v === "chatgpt") return "chatgpt";
  if (v === "claude_code") return "claude_code";
  if (v === "openrouter") return "openrouter";
  if (v === "phi4_local") return "phi4_local";
  return null;
}

export class ProviderRegistry {
  private readonly providers = new Map<ProviderId, LlmProvider>();
  private active_provider_id: ProviderId = "chatgpt";
  private orchestrator_provider_id: ProviderId = "phi4_local";
  private readonly secret_vault: SecretVaultService;

  constructor(options?: {
    openrouter_api_base?: string;
    openrouter_model?: string;
  }) {
    this.secret_vault = new SecretVaultService(process.cwd());
    this.providers.set(
      "chatgpt",
        new CliHeadlessProvider({
          id: "chatgpt",
          default_model: "chatgpt-cli-headless",
          command_env: "CHATGPT_HEADLESS_COMMAND",
          args_env: "CHATGPT_HEADLESS_ARGS",
          timeout_env: "CHATGPT_HEADLESS_TIMEOUT_MS",
          default_command: "codex",
          default_args: "exec --json --sandbox workspace-write --skip-git-repo-check -",
          default_timeout_ms: 180000,
        }),
      );
    this.providers.set(
      "claude_code",
        new CliHeadlessProvider({
          id: "claude_code",
          default_model: "claude-cli-headless",
          command_env: "CLAUDE_HEADLESS_COMMAND",
          args_env: "CLAUDE_HEADLESS_ARGS",
          timeout_env: "CLAUDE_HEADLESS_TIMEOUT_MS",
          default_command: "claude",
          default_args: "-p --output-format stream-json --include-partial-messages --permission-mode dontAsk -",
          default_timeout_ms: 180000,
        }),
      );
    this.providers.set(
      "openrouter",
      new OpenRouterProvider({
        api_base: options?.openrouter_api_base,
        default_model: options?.openrouter_model,
      }),
    );
    this.providers.set("phi4_local", new Phi4LocalProvider());
    this.orchestrator_provider_id = this.resolve_default_orchestrator_provider();
  }

  get_secret_vault(): SecretVaultService {
    return this.secret_vault;
  }

  private async redact_prompt_content(content: unknown): Promise<unknown> {
    if (typeof content === "string") {
      const masked = await this.secret_vault.mask_known_secrets(content);
      return redact_sensitive_text(masked).text;
    }
    if (!Array.isArray(content)) {
      return redact_sensitive_unknown(content);
    }
    const out: unknown[] = [];
    for (const item of content) {
      if (!item || typeof item !== "object") {
        out.push(item);
        continue;
      }
      const rec = { ...(item as Record<string, unknown>) };
      if (typeof rec.text === "string") {
        const masked = await this.secret_vault.mask_known_secrets(rec.text);
        rec.text = redact_sensitive_text(masked).text;
      }
      if (typeof rec.media_url === "string") {
        const masked = await this.secret_vault.mask_known_secrets(rec.media_url);
        rec.media_url = redact_sensitive_text(masked).text;
      }
      if (rec.image_url && typeof rec.image_url === "object") {
        const img = { ...(rec.image_url as Record<string, unknown>) };
        if (typeof img.url === "string") {
          const masked = await this.secret_vault.mask_known_secrets(img.url);
          img.url = redact_sensitive_text(masked).text;
        }
        rec.image_url = img;
      }
      out.push(rec);
    }
    return out;
  }

  private async sanitize_prompt_messages(messages: ChatMessage[]): Promise<ChatMessage[]> {
    const out: ChatMessage[] = [];
    for (const msg of messages || []) {
      const next: ChatMessage = {
        ...msg,
        content: await this.redact_prompt_content(msg.content),
      };
      if (Array.isArray(msg.tool_calls)) {
        next.tool_calls = msg.tool_calls.map((row) => {
          if (!row || typeof row !== "object") return row;
          return redact_sensitive_unknown(row) as Record<string, unknown>;
        });
      }
      out.push(next);
    }
    return out;
  }

  list_providers(): ProviderId[] {
    return [...this.providers.keys()];
  }

  set_active_provider(provider_id: ProviderId): void {
    if (!this.providers.has(provider_id)) throw new Error(`provider_not_found:${provider_id}`);
    this.active_provider_id = provider_id;
  }

  get_active_provider_id(): ProviderId {
    return this.active_provider_id;
  }

  set_orchestrator_provider(provider_id: ProviderId): void {
    if (!this.providers.has(provider_id)) throw new Error(`provider_not_found:${provider_id}`);
    this.orchestrator_provider_id = provider_id;
  }

  get_orchestrator_provider_id(): ProviderId {
    return this.orchestrator_provider_id;
  }

  private resolve_default_orchestrator_provider(): ProviderId {
    const preferred = parse_provider_id(String(process.env.ORCH_ORCHESTRATOR_PROVIDER || ""));
    if (preferred && this.providers.has(preferred)) return preferred;
    return "phi4_local";
  }

  private get_provider(provider_id?: ProviderId): LlmProvider {
    const id = provider_id || this.active_provider_id;
    const provider = this.providers.get(id);
    if (!provider) throw new Error(`provider_not_found:${id}`);
    return provider;
  }

  async run_headless(args: {
    provider_id?: ProviderId;
    messages: ChatMessage[];
    tools?: Record<string, unknown>[];
    runtime_policy?: ChatOptions["runtime_policy"];
    model?: string;
    max_tokens?: number;
    temperature?: number;
    on_stream?: (chunk: string) => void | Promise<void>;
    abort_signal?: AbortSignal;
  }): Promise<LlmResponse> {
    const provider = this.get_provider(args.provider_id);
    const sanitized_messages = await this.sanitize_prompt_messages(args.messages || []);
    const options: ChatOptions = {
      messages: sanitized_messages,
      tools: args.tools,
      runtime_policy: args.runtime_policy,
      model: args.model,
      max_tokens: args.max_tokens,
      temperature: args.temperature,
      on_stream: args.on_stream,
      abort_signal: args.abort_signal,
    };
    return provider.chat(options);
  }

  async run_headless_prompt(args: {
    provider_id?: ProviderId;
    prompt: string;
    system?: string;
    runtime_policy?: ChatOptions["runtime_policy"];
    model?: string;
    max_tokens?: number;
    temperature?: number;
    on_stream?: (chunk: string) => void | Promise<void>;
    abort_signal?: AbortSignal;
  }): Promise<LlmResponse> {
    const messages: ChatMessage[] = [];
    if (args.system && args.system.trim().length > 0) {
      messages.push({ role: "system", content: args.system });
    }
    messages.push({ role: "user", content: args.prompt });
    return this.run_headless({
      provider_id: args.provider_id,
      messages,
      runtime_policy: args.runtime_policy,
      model: args.model,
      max_tokens: args.max_tokens,
      temperature: args.temperature,
      on_stream: args.on_stream,
      abort_signal: args.abort_signal,
    });
  }

  async run_headless_with_context(args: {
    context_builder: ContextBuilder;
    provider_id?: ProviderId;
    history_days: string[];
    current_message: string;
    skill_names?: string[] | null;
    media?: string[] | null;
    channel?: string | null;
    chat_id?: string | null;
    tools?: Record<string, unknown>[];
    runtime_policy?: ChatOptions["runtime_policy"];
    model?: string;
    max_tokens?: number;
    temperature?: number;
    on_stream?: (chunk: string) => void | Promise<void>;
    abort_signal?: AbortSignal;
  }): Promise<LlmResponse> {
    const messages = await args.context_builder.build_messages(
      args.history_days,
      args.current_message,
      args.skill_names,
      args.media,
      args.channel,
      args.chat_id,
    );
    return this.run_headless({
      provider_id: args.provider_id,
      messages: messages as ChatMessage[],
      tools: args.tools,
      runtime_policy: args.runtime_policy,
      model: args.model,
      max_tokens: args.max_tokens,
      temperature: args.temperature,
      on_stream: args.on_stream,
      abort_signal: args.abort_signal,
    });
  }

  async run_orchestrator(args: {
    messages: ChatMessage[];
    tools?: Record<string, unknown>[];
    provider_id?: ProviderId;
    model?: string;
    max_tokens?: number;
    temperature?: number;
    on_stream?: (chunk: string) => void | Promise<void>;
  }): Promise<LlmResponse> {
    const provider_id = args.provider_id || this.orchestrator_provider_id;
    return this.run_headless({
      provider_id,
      messages: args.messages,
      tools: args.tools,
      model: args.model,
      max_tokens: args.max_tokens ?? 2048,
      temperature: args.temperature ?? 0.2,
      on_stream: args.on_stream,
    });
  }
}
