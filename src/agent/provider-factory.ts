/**
 * AgentProviderFactory — 프로바이더 타입명으로 AgentBackend 인스턴스를 생성하는 팩토리 레지스트리.
 * 빌트인 4타입을 기본 등록하고, 동적 프로바이더는 register_agent_provider_factory()로 추가.
 */

import type { AgentBackend, AgentProviderConfig } from "./agent.types.js";
import type { ProviderRegistry } from "../providers/service.js";
import { CliAgent } from "./backends/cli-agent.js";
import { ClaudeSdkAgent } from "./backends/claude-sdk.agent.js";
import { CodexAppServerAgent } from "./backends/codex-appserver.agent.js";
import { OpenAiCompatibleAgent } from "./backends/openai-compatible.agent.js";

export type AgentProviderFactoryDeps = {
  provider_registry: ProviderRegistry;
  workspace: string;
};

export type AgentProviderFactoryFn = (
  config: AgentProviderConfig,
  token: string | null,
  deps: AgentProviderFactoryDeps,
) => AgentBackend;

const FACTORIES = new Map<string, AgentProviderFactoryFn>();

export function register_agent_provider_factory(type: string, factory: AgentProviderFactoryFn): void {
  FACTORIES.set(type.toLowerCase(), factory);
}

export function get_agent_provider_factory(type: string): AgentProviderFactoryFn | null {
  return FACTORIES.get(type.toLowerCase()) || null;
}

export function list_registered_provider_types(): string[] {
  return [...FACTORIES.keys()];
}

/** AgentProviderConfig + 토큰으로 AgentBackend 인스턴스 생성. */
export function create_agent_provider(
  config: AgentProviderConfig,
  token: string | null,
  deps: AgentProviderFactoryDeps,
): AgentBackend | null {
  const factory = FACTORIES.get(config.provider_type.toLowerCase());
  if (!factory) return null;
  return factory(config, token, deps);
}

// ── 빌트인 팩토리 등록 ──

register_agent_provider_factory("claude_cli", (config, _token, deps) => {
  return new CliAgent(config.instance_id, deps.provider_registry.get_provider_instance("claude_code"));
});

register_agent_provider_factory("codex_cli", (config, _token, deps) => {
  return new CliAgent(config.instance_id, deps.provider_registry.get_provider_instance("chatgpt"));
});

register_agent_provider_factory("claude_sdk", (config) => {
  const s = config.settings;
  return new ClaudeSdkAgent({
    id: config.instance_id,
    cwd: typeof s.cwd === "string" ? s.cwd : undefined,
    model: typeof s.model === "string" ? s.model : undefined,
    max_budget_usd: typeof s.max_budget_usd === "number" ? s.max_budget_usd : undefined,
  });
});

register_agent_provider_factory("codex_appserver", (config) => {
  const s = config.settings;
  return new CodexAppServerAgent({
    id: config.instance_id,
    cwd: typeof s.cwd === "string" ? s.cwd : undefined,
    command: typeof s.command === "string" ? s.command : undefined,
    model: typeof s.model === "string" ? s.model : undefined,
    request_timeout_ms: typeof s.request_timeout_ms === "number" ? s.request_timeout_ms : undefined,
  });
});

register_agent_provider_factory("gemini_cli", (config, _token, deps) => {
  return new CliAgent(config.instance_id, deps.provider_registry.get_provider_instance("gemini"));
});

register_agent_provider_factory("openai_compatible", (config, token) => {
  const s = config.settings;
  return new OpenAiCompatibleAgent(config.instance_id, {
    api_base: typeof s.api_base === "string" ? s.api_base : "https://api.openai.com/v1",
    api_key: token || "",
    model: typeof s.model === "string" ? s.model : "gpt-4o",
    max_tokens: typeof s.max_tokens === "number" ? s.max_tokens : undefined,
    temperature: typeof s.temperature === "number" ? s.temperature : undefined,
    request_timeout_ms: typeof s.request_timeout_ms === "number" ? s.request_timeout_ms : undefined,
  });
});
