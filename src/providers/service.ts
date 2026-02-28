import { CliHeadlessProvider } from "./cli.provider.js";
import { OpenRouterProvider } from "./openrouter.provider.js";
import { Phi4LocalProvider } from "./phi4.provider.js";
import type { ChatMessage, ChatOptions, LlmProvider, LlmResponse, ProviderId } from "./types.js";
import type { ContextBuilder } from "../agent/context.js";
import { redact_sensitive_text, redact_sensitive_unknown } from "../security/sensitive.js";
import { get_shared_secret_vault } from "../security/secret-vault-factory.js";
import type { SecretVaultService } from "../security/secret-vault.js";
import { CircuitBreaker, type CircuitBreakerOptions } from "./circuit-breaker.js";
import { ProviderHealthScorer, type HealthScorerOptions } from "./health-scorer.js";

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
  private readonly breakers = new Map<ProviderId, CircuitBreaker>();
  private readonly health_scorer: ProviderHealthScorer;
  private active_provider_id: ProviderId = "chatgpt";
  private orchestrator_provider_id: ProviderId = "phi4_local";
  private readonly secret_vault: SecretVaultService;

  constructor(options?: {
    openrouter_api_base?: string;
    openrouter_model?: string;
    phi4_api_base?: string;
    phi4_model?: string;
    circuit_breaker?: CircuitBreakerOptions;
    health_scorer?: HealthScorerOptions;
  }) {
    this.secret_vault = get_shared_secret_vault(process.cwd());
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
          default_args: "-p --verbose --output-format stream-json --include-partial-messages --permission-mode dontAsk -",
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
    this.providers.set("phi4_local", new Phi4LocalProvider({
      api_base: options?.phi4_api_base,
      default_model: options?.phi4_model,
    }));

    for (const id of this.providers.keys()) {
      this.breakers.set(id, new CircuitBreaker(options?.circuit_breaker));
    }
    this.health_scorer = new ProviderHealthScorer(options?.health_scorer);

    this.orchestrator_provider_id = this.resolve_default_orchestrator_provider();
  }

  get_secret_vault(): SecretVaultService {
    return this.secret_vault;
  }

  private async redact_string(value: string): Promise<string> {
    const masked = await this.secret_vault.mask_known_secrets(value);
    return redact_sensitive_text(masked).text;
  }

  private async redact_prompt_content(content: unknown): Promise<unknown> {
    if (typeof content === "string") return this.redact_string(content);
    if (!Array.isArray(content)) return redact_sensitive_unknown(content);

    const out: unknown[] = [];
    for (const item of content) {
      if (!item || typeof item !== "object") { out.push(item); continue; }
      const rec = { ...(item as Record<string, unknown>) };
      if (typeof rec.text === "string") rec.text = await this.redact_string(rec.text);
      if (typeof rec.media_url === "string") rec.media_url = await this.redact_string(rec.media_url);
      if (rec.image_url && typeof rec.image_url === "object") {
        const img = { ...(rec.image_url as Record<string, unknown>) };
        if (typeof img.url === "string") img.url = await this.redact_string(img.url);
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

  get_circuit_breaker(provider_id: ProviderId): CircuitBreaker | undefined {
    return this.breakers.get(provider_id);
  }

  /** 해당 프로바이더의 circuit breaker가 요청을 허용하는지 확인. */
  is_provider_available(provider_id: ProviderId): boolean {
    const breaker = this.breakers.get(provider_id);
    return breaker ? breaker.can_acquire() : true;
  }

  get_health_scorer(): ProviderHealthScorer {
    return this.health_scorer;
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
    const id = args.provider_id || this.active_provider_id;
    const provider = this.get_provider(id);
    const breaker = this.breakers.get(id);

    if (breaker && !breaker.try_acquire()) {
      throw new Error(`circuit_open:${id}`);
    }

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

    const start = Date.now();
    try {
      const result = await provider.chat(options);
      const is_error = result.finish_reason === "error";
      if (is_error) {
        breaker?.record_failure();
      } else {
        breaker?.record_success();
      }
      this.health_scorer.record(id, { ok: !is_error, latency_ms: Date.now() - start });
      return result;
    } catch (err) {
      breaker?.record_failure();
      this.health_scorer.record(id, { ok: false, latency_ms: Date.now() - start });
      throw err;
    }
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
    if (args.system?.trim()) messages.push({ role: "system", content: args.system });
    messages.push({ role: "user", content: args.prompt });
    const { prompt: _prompt, system: _system, ...headless_args } = args;
    return this.run_headless({ ...headless_args, messages });
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
    const { context_builder, history_days, current_message, skill_names, media, channel, chat_id, ...headless_args } = args;
    const messages = await context_builder.build_messages(
      history_days, current_message, skill_names, media, channel, chat_id,
    );
    return this.run_headless({ ...headless_args, messages: messages as ChatMessage[] });
  }

  async run_orchestrator(args: {
    messages: ChatMessage[];
    tools?: Record<string, unknown>[];
    provider_id?: ProviderId;
    model?: string;
    max_tokens?: number;
    temperature?: number;
    on_stream?: (chunk: string) => void | Promise<void>;
    runtime_policy?: ChatOptions["runtime_policy"];
    abort_signal?: AbortSignal;
  }): Promise<LlmResponse> {
    return this.run_headless({
      ...args,
      provider_id: args.provider_id || this.orchestrator_provider_id,
      max_tokens: args.max_tokens ?? 2048,
      temperature: args.temperature ?? 0.2,
    });
  }
}
