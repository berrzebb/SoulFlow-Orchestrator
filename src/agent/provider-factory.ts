/**
 * AgentProviderFactory — 프로바이더 타입명으로 AgentBackend 인스턴스를 생성하는 팩토리 레지스트리.
 * 빌트인 타입을 기본 등록하고, 동적 프로바이더는 register_agent_provider_factory()로 추가.
 */

import type { AgentBackend, AgentProviderConfig } from "./agent.types.js";
import type { ProviderRegistry } from "../providers/service.js";
import { ClaudeSdkAgent } from "./backends/claude-sdk.agent.js";
import { CodexAppServerAgent } from "./backends/codex-appserver.agent.js";
import { OpenAiCompatibleAgent } from "./backends/openai-compatible.agent.js";
import { ContainerCliAgent } from "./pty/container-cli-agent.js";
import { AgentBus } from "./pty/agent-bus.js";
import { ContainerPool } from "./pty/container-pool.js";
import { ClaudeCliAdapter, CodexCliAdapter, GeminiCliAdapter } from "./pty/cli-adapter.js";
import { local_pty_factory } from "./pty/local-pty.js";
import { CliDockerOps } from "./pty/docker-ops.js";
import { create_docker_pty_factory } from "./pty/docker-pty.js";
import { resolve_secrets, type SecretMapping } from "./pty/secret-reader.js";
import { ToolBridgeServer } from "./pty/tool-bridge-server.js";
import { create_logger } from "../logger.js";
import type { CliAuthService } from "./cli-auth.service.js";
import type { McpClientManager } from "../mcp/client-manager.js";
import type { CliAdapter, PtyFactory } from "./pty/types.js";

export type AgentProviderFactoryDeps = {
  provider_registry: ProviderRegistry;
  workspace: string;
  cli_auth_service?: CliAuthService;
  mcp?: McpClientManager;
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

// ── CLI 백엔드 공통 헬퍼 ──

/** CLI 어댑터로 ContainerCliAgent를 생성하는 공통 로직. */
function create_cli_backend(
  config: AgentProviderConfig,
  adapter: CliAdapter,
  deps: AgentProviderFactoryDeps,
): ContainerCliAgent {
  const s = config.settings;
  const logger = create_logger(`pty:${config.instance_id}`);
  const default_env: Record<string, string> = {};
  if (typeof s.env === "object" && s.env !== null) {
    for (const [k, v] of Object.entries(s.env as Record<string, unknown>)) {
      if (typeof v === "string") default_env[k] = v;
    }
  }

  if (Array.isArray(s.secret_mappings)) {
    const secrets = resolve_secrets(s.secret_mappings as SecretMapping[]);
    Object.assign(default_env, secrets);
  }

  const execution_mode = typeof s.execution_mode === "string" ? s.execution_mode : "local";
  let pty_factory: PtyFactory;
  let is_alive: ((pid: string) => Promise<boolean>) | undefined;

  if (execution_mode === "docker") {
    const docker = new CliDockerOps({ docker_host: process.env.DOCKER_HOST });
    const image = typeof s.image === "string" ? s.image : "soulflow/agent-runner:latest";
    pty_factory = create_docker_pty_factory({ docker, image });
    is_alive = async (pid) => {
      try { await docker.inspect(pid); return true; }
      catch { return false; }
    };
  } else {
    pty_factory = local_pty_factory;
  }

  const pool = new ContainerPool({
    pty_factory,
    adapter,
    default_env,
    cwd: typeof s.cwd === "string" ? s.cwd : deps.workspace,
    max_idle_ms: typeof s.max_idle_ms === "number" ? s.max_idle_ms : 300_000,
    logger,
    is_alive,
  });

  const bus = new AgentBus({ pool, adapter, logger });

  const profile_key_map = new Map<number, Record<string, string>>();
  if (Array.isArray(s.auth_profiles)) {
    for (let i = 0; i < s.auth_profiles.length; i++) {
      const entry = s.auth_profiles[i] as Record<string, unknown> | undefined;
      if (entry && typeof entry.env === "object" && entry.env !== null) {
        const env_map: Record<string, string> = {};
        for (const [k, v] of Object.entries(entry.env as Record<string, unknown>)) {
          if (typeof v === "string") env_map[k] = v;
        }
        if (Object.keys(env_map).length > 0) profile_key_map.set(i, env_map);
      }
    }
  }

  // MCP 도구 브릿지: mcp가 주입되면 ToolBridgeServer 생성하여 CLI가 오케스트레이터 도구를 호출 가능
  const tool_bridge = deps.mcp
    ? new ToolBridgeServer({ mcp: deps.mcp, logger })
    : undefined;

  return new ContainerCliAgent({
    id: config.instance_id,
    bus,
    adapter,
    logger,
    auth_profile_count: typeof s.auth_profile_count === "number" ? s.auth_profile_count : profile_key_map.size || undefined,
    fallback_configured: typeof s.fallback_configured === "boolean" ? s.fallback_configured : undefined,
    default_env,
    auth_service: deps.cli_auth_service,
    profile_key_map: profile_key_map.size > 0 ? profile_key_map : undefined,
    tool_bridge,
  });
}

// ── 빌트인 팩토리 등록 ──

register_agent_provider_factory("claude_cli", (config, _token, deps) => {
  return create_cli_backend(config, new ClaudeCliAdapter(), deps);
});

register_agent_provider_factory("codex_cli", (config, _token, deps) => {
  return create_cli_backend(config, new CodexCliAdapter(), deps);
});

register_agent_provider_factory("gemini_cli", (config, _token, deps) => {
  return create_cli_backend(config, new GeminiCliAdapter(), deps);
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

/** OpenAI-compatible 계열 공통 설정 추출. */
function extract_openai_settings(
  s: Record<string, unknown>,
  defaults: { api_base: string; model: string },
): Pick<import("./backends/openai-compatible.agent.js").OpenAiCompatibleConfig, "api_base" | "model" | "max_tokens" | "temperature" | "request_timeout_ms"> {
  return {
    api_base: typeof s.api_base === "string" ? s.api_base : defaults.api_base,
    model: typeof s.model === "string" ? s.model : defaults.model,
    max_tokens: typeof s.max_tokens === "number" ? s.max_tokens : undefined,
    temperature: typeof s.temperature === "number" ? s.temperature : undefined,
    request_timeout_ms: typeof s.request_timeout_ms === "number" ? s.request_timeout_ms : undefined,
  };
}

register_agent_provider_factory("openai_compatible", (config, token) => {
  return new OpenAiCompatibleAgent(config.instance_id, {
    ...extract_openai_settings(config.settings, { api_base: "https://api.openai.com/v1", model: "gpt-4o" }),
    api_key: token || "",
  });
});

register_agent_provider_factory("openrouter", (config, token) => {
  const s = config.settings;
  const extra_headers: Record<string, string> = {};
  if (typeof s.site_url === "string" && s.site_url) extra_headers["HTTP-Referer"] = s.site_url;
  if (typeof s.app_name === "string" && s.app_name) extra_headers["X-Title"] = s.app_name;
  return new OpenAiCompatibleAgent(config.instance_id, {
    ...extract_openai_settings(s, { api_base: "https://openrouter.ai/api/v1", model: "anthropic/claude-sonnet-4" }),
    api_key: token || "",
    extra_headers: Object.keys(extra_headers).length > 0 ? extra_headers : undefined,
  });
});

register_agent_provider_factory("ollama", (config, _token) => {
  return new OpenAiCompatibleAgent(config.instance_id, {
    ...extract_openai_settings(config.settings, { api_base: "http://ollama:11434/v1", model: "llama3.2" }),
    api_key: "",
  });
});

register_agent_provider_factory("container_cli", (config, _token, deps) => {
  const s = config.settings;
  const cli_type = typeof s.cli_type === "string" ? s.cli_type : "claude";
  const adapter = cli_type === "codex" ? new CodexCliAdapter()
    : cli_type === "gemini" ? new GeminiCliAdapter()
    : new ClaudeCliAdapter();
  return create_cli_backend(config, adapter, deps);
});
