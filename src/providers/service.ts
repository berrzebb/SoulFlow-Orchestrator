import { CliHeadlessProvider } from "./cli.provider.js";
import { OpenRouterProvider } from "./openrouter.provider.js";
import { OrchestratorLlmProvider } from "./orchestrator-llm.provider.js";
import type { ChatMessage, ChatOptions, LlmProvider, LlmResponse, ProviderId } from "./types.js";
import type { ContextBuilder } from "../agent/context.js";
import { redact_sensitive_text, redact_sensitive_unknown } from "../security/sensitive.js";
import { get_shared_secret_vault } from "../security/secret-vault-factory.js";
import type { SecretVaultService } from "../security/secret-vault.js";
import { CircuitBreaker, type CircuitBreakerOptions } from "./circuit-breaker.js";
import { ProviderHealthScorer, type HealthScorerOptions } from "./health-scorer.js";

/** 일시적 오류 재시도 설정. */
const MAX_TRANSIENT_RETRIES = 2;
const RETRY_BASE_MS = 1000;

function sleep_ms(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const TRANSIENT_ERROR_PATTERNS = [
  /rate.?limit/i,
  /too.?many.?requests/i,
  /429/,
  /5\d{2}\b/,
  /timeout/i,
  /ECONNRESET/i,
  /ECONNREFUSED/i,
  /ETIMEDOUT/i,
  /network/i,
  /socket hang up/i,
  /stream disconnected/i,
];

/** thrown exception이 일시적 오류인지 판별. */
function is_transient_exception(err: unknown): boolean {
  const msg = String((err as Error)?.message || err || "");
  return TRANSIENT_ERROR_PATTERNS.some((p) => p.test(msg));
}

/** LLM 응답의 error content가 일시적 오류인지 판별. */
function is_transient_error_content(content: string): boolean {
  const c = String(content || "").toLowerCase();
  return TRANSIENT_ERROR_PATTERNS.some((p) => p.test(c));
}

function parse_provider_id(raw: string): ProviderId | null {
  const v = String(raw || "").trim().toLowerCase();
  if (v === "chatgpt") return "chatgpt";
  if (v === "claude_code") return "claude_code";
  if (v === "openrouter") return "openrouter";
  if (v === "orchestrator_llm") return "orchestrator_llm";
  if (v === "gemini") return "gemini";
  return null;
}

export class ProviderRegistry {
  private readonly providers = new Map<ProviderId, LlmProvider>();
  private readonly breakers = new Map<ProviderId, CircuitBreaker>();
  private readonly health_scorer: ProviderHealthScorer;
  private active_provider_id: ProviderId = "chatgpt";
  private orchestrator_provider_id: ProviderId = "orchestrator_llm";
  private readonly orchestrator_max_tokens: number;
  private readonly secret_vault: SecretVaultService;

  constructor(options?: {
    openrouter_api_key?: string | null;
    openrouter_api_base?: string;
    openrouter_model?: string;
    openrouter_http_referer?: string;
    openrouter_app_title?: string;
    orchestrator_llm_api_key?: string | null;
    orchestrator_llm_api_base?: string;
    orchestrator_llm_model?: string;
    orchestrator_max_tokens?: number;
    orchestrator_provider?: string;
    circuit_breaker?: CircuitBreakerOptions;
    health_scorer?: HealthScorerOptions;
    cli_configs?: Record<string, { command?: string; args?: string; timeout_ms?: number; permission_config?: import("./cli-permission.js").CliPermissionConfig }>;
  }) {
    this.secret_vault = get_shared_secret_vault(process.cwd());
    const cli = options?.cli_configs || {};
    this.providers.set(
      "chatgpt",
        new CliHeadlessProvider({
          id: "chatgpt",
          default_model: "chatgpt-cli-headless",
          command: cli.chatgpt?.command || "codex",
          args: cli.chatgpt?.args || "exec --json --sandbox workspace-write --skip-git-repo-check -",
          timeout_ms: cli.chatgpt?.timeout_ms || 180000,
          permission_config: cli.chatgpt?.permission_config,
        }),
      );
    this.providers.set(
      "claude_code",
        new CliHeadlessProvider({
          id: "claude_code",
          default_model: "claude-cli-headless",
          command: cli.claude_code?.command || "claude",
          args: cli.claude_code?.args || "-p --verbose --output-format stream-json --include-partial-messages --permission-mode dontAsk -",
          timeout_ms: cli.claude_code?.timeout_ms || 180000,
          permission_config: cli.claude_code?.permission_config,
        }),
      );
    this.providers.set(
      "openrouter",
      new OpenRouterProvider({
        api_key: options?.openrouter_api_key ?? undefined,
        api_base: options?.openrouter_api_base,
        default_model: options?.openrouter_model,
        http_referer: options?.openrouter_http_referer,
        app_title: options?.openrouter_app_title,
      }),
    );
    this.providers.set("orchestrator_llm", new OrchestratorLlmProvider({
      api_key: options?.orchestrator_llm_api_key ?? undefined,
      api_base: options?.orchestrator_llm_api_base,
      default_model: options?.orchestrator_llm_model,
    }));
    this.providers.set("gemini", new CliHeadlessProvider({
      id: "gemini",
      default_model: "gemini-cli-headless",
      command: cli.gemini?.command || "gemini",
      args: cli.gemini?.args || "--output-format stream-json",
      timeout_ms: cli.gemini?.timeout_ms || 180000,
      permission_config: cli.gemini?.permission_config,
    }));

    for (const id of this.providers.keys()) {
      this.breakers.set(id, new CircuitBreaker(options?.circuit_breaker));
    }
    this.health_scorer = new ProviderHealthScorer(options?.health_scorer);

    this.orchestrator_max_tokens = options?.orchestrator_max_tokens ?? 4096;
    this.orchestrator_provider_id = this.resolve_default_orchestrator_provider(options?.orchestrator_provider);
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

  private resolve_default_orchestrator_provider(override?: string): ProviderId {
    const preferred = parse_provider_id(override || "");
    if (preferred && this.providers.has(preferred)) return preferred;
    return "orchestrator_llm";
  }

  /** 지정 ID의 LlmProvider 인스턴스 반환. AgentBackendRegistry에서 래핑 시 사용. */
  get_provider_instance(provider_id: ProviderId): LlmProvider {
    const provider = this.providers.get(provider_id);
    if (!provider) throw new Error(`provider_not_found:${provider_id}`);
    return provider;
  }

  private get_provider(provider_id?: ProviderId): LlmProvider {
    const id = provider_id || this.active_provider_id;
    return this.get_provider_instance(id);
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

  /** 지정 프로바이더가 multi-turn tool loop을 지원하는지 확인. */
  supports_tool_loop(provider_id?: ProviderId): boolean {
    return this.get_provider(provider_id).supports_tool_loop;
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

    let last_error: unknown;
    for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt++) {
      if (attempt > 0) {
        if (args.abort_signal?.aborted) throw last_error;
        await sleep_ms(RETRY_BASE_MS * 2 ** (attempt - 1));
        if (args.abort_signal?.aborted) throw last_error;
      }

      const start = Date.now();
      try {
        const result = await provider.chat(options);
        const is_error = result.finish_reason === "error";
        if (is_error && attempt < MAX_TRANSIENT_RETRIES && is_transient_error_content(String(result.content || ""))) {
          breaker?.record_failure();
          this.health_scorer.record(id, { ok: false, latency_ms: Date.now() - start });
          last_error = new Error(String(result.content || "transient_error"));
          continue;
        }
        if (is_error) {
          breaker?.record_failure();
        } else {
          breaker?.record_success();
        }
        this.health_scorer.record(id, { ok: !is_error, latency_ms: Date.now() - start });
        return result;
      } catch (err) {
        this.health_scorer.record(id, { ok: false, latency_ms: Date.now() - start });
        last_error = err;
        if (!is_transient_exception(err) || attempt >= MAX_TRANSIENT_RETRIES) {
          breaker?.record_failure();
          throw err;
        }
        breaker?.record_failure();
      }
    }
    throw last_error;
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
      max_tokens: args.max_tokens ?? this.orchestrator_max_tokens,
      temperature: args.temperature ?? 0.2,
    });
  }
}
