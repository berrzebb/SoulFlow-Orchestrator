import { CliHeadlessProvider } from "./cli.provider.js";
import { OpenRouterProvider } from "./openrouter.provider.js";
import { Phi4LocalProvider } from "./phi4.provider.js";
import type { ChatMessage, ChatOptions, LlmProvider, LlmResponse, ProviderId } from "./types.js";
import type { ContextBuilder } from "../agent/context.js";

export class ProviderRegistry {
  private readonly providers = new Map<ProviderId, LlmProvider>();
  private active_provider_id: ProviderId = "chatgpt";
  private orchestrator_provider_id: ProviderId = "phi4_local";

  constructor(options?: {
    openrouter_api_base?: string;
    openrouter_model?: string;
  }) {
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
    model?: string;
    max_tokens?: number;
    temperature?: number;
    on_stream?: (chunk: string) => void | Promise<void>;
    abort_signal?: AbortSignal;
  }): Promise<LlmResponse> {
    const provider = this.get_provider(args.provider_id);
    const options: ChatOptions = {
      messages: args.messages,
      tools: args.tools,
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
