/**
 * AgentProviderFactory — 프로바이더 타입명으로 AgentBackend 인스턴스를 생성하는 팩토리 레지스트리.
 * 빌트인 타입을 기본 등록하고, 동적 프로바이더는 register_agent_provider_factory()로 추가.
 */

import type { AgentBackend, AgentProviderConfig } from "./agent.types.js";
import type {
  CliProviderSettings,
  ContainerCliSettings,
  ClaudeSdkSettings,
  CodexAppServerSettings,
  OpenAiCompatibleSettings,
  OpenRouterSettings,
  OllamaSettings,
} from "./provider-settings.types.js";
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
  /** CLI 인증 홈 디렉토리 (user_dir/.agents). 미설정 시 process.env.HOME 사용. */
  agents_home?: string;
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
  const s = config.settings as CliProviderSettings;
  const logger = create_logger(`pty:${config.instance_id}`);
  const default_env: Record<string, string> = {};
  if (deps.agents_home) default_env.HOME = deps.agents_home;
  // env는 JSON 저장 값이므로 런타임 타입 체크 유지 (실제 값이 선언 타입과 다를 수 있음)
  if (s.env != null && typeof s.env === "object") {
    for (const [k, v] of Object.entries(s.env)) {
      if (typeof v === "string") default_env[k] = v;
    }
  }

  if (s.secret_mappings) {
    const secrets = resolve_secrets(s.secret_mappings);
    Object.assign(default_env, secrets);
  }

  const execution_mode = s.execution_mode ?? "local";
  let pty_factory: PtyFactory;
  let is_alive: ((pid: string) => Promise<boolean>) | undefined;

  if (execution_mode === "docker") {
    const docker = new CliDockerOps({ docker_host: process.env.DOCKER_HOST });
    const image = s.image ?? "soulflow/agent-runner:latest";
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
    cwd: s.cwd ?? deps.workspace,
    max_idle_ms: s.max_idle_ms ?? 300_000,
    logger,
    is_alive,
  });

  const bus = new AgentBus({ pool, adapter, logger });

  const profile_key_map = new Map<number, Record<string, string>>();
  if (s.auth_profiles) {
    for (let i = 0; i < s.auth_profiles.length; i++) {
      const entry = s.auth_profiles[i];
      // env는 JSON 저장 값이므로 런타임 타입 체크 유지
      if (entry?.env != null && typeof entry.env === "object") {
        const env_map: Record<string, string> = {};
        for (const [k, v] of Object.entries(entry.env)) {
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
    auth_profile_count: s.auth_profile_count ?? (profile_key_map.size || undefined),
    fallback_configured: s.fallback_configured,
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
  const s = config.settings as ClaudeSdkSettings;
  return new ClaudeSdkAgent({
    id: config.instance_id,
    cwd: s.cwd,
    model: s.model,
    max_budget_usd: s.max_budget_usd,
  });
});

register_agent_provider_factory("codex_appserver", (config) => {
  const s = config.settings as CodexAppServerSettings;
  return new CodexAppServerAgent({
    id: config.instance_id,
    cwd: s.cwd,
    command: s.command,
    model: s.model,
    request_timeout_ms: s.request_timeout_ms,
  });
});

/** OpenAI-compatible 계열 공통 설정 추출. */
function extract_openai_settings(
  s: OpenAiCompatibleSettings,
  defaults: { api_base: string; model: string },
): Pick<import("./backends/openai-compatible.agent.js").OpenAiCompatibleConfig, "api_base" | "model" | "max_tokens" | "temperature" | "request_timeout_ms"> {
  return {
    api_base: s.api_base ?? defaults.api_base,
    model: s.model ?? defaults.model,
    max_tokens: s.max_tokens,
    temperature: s.temperature,
    request_timeout_ms: s.request_timeout_ms,
  };
}

register_agent_provider_factory("openai_compatible", (config, token) => {
  return new OpenAiCompatibleAgent(config.instance_id, {
    ...extract_openai_settings(config.settings as OpenAiCompatibleSettings, { api_base: "https://api.openai.com/v1", model: "gpt-4o" }),
    api_key: token || "",
  });
});

register_agent_provider_factory("openrouter", (config, token) => {
  const s = config.settings as OpenRouterSettings;
  const extra_headers: Record<string, string> = {};
  if (s.site_url) extra_headers["HTTP-Referer"] = s.site_url;
  if (s.app_name) extra_headers["X-Title"] = s.app_name;
  return new OpenAiCompatibleAgent(config.instance_id, {
    ...extract_openai_settings(s, { api_base: "https://openrouter.ai/api/v1", model: "anthropic/claude-sonnet-4" }),
    api_key: token || "",
    extra_headers: Object.keys(extra_headers).length > 0 ? extra_headers : undefined,
  });
});

register_agent_provider_factory("ollama", (config, _token) => {
  const s = config.settings as OllamaSettings;
  const base = extract_openai_settings(s, { api_base: "http://ollama:11434/v1", model: "llama3.2" });
  return new OpenAiCompatibleAgent(config.instance_id, {
    ...base,
    // 로컬 대형 모델(120B+)은 응답 생성이 오래 걸리므로 기본 10분으로 설정
    request_timeout_ms: base.request_timeout_ms ?? 600_000,
    api_key: "",
    // 함수 호출 미지원 모델을 위해 no_tool_choice를 settings에서 제어 가능 (기본값: false)
    no_tool_choice: s.no_tool_choice ?? false,
  });
});

register_agent_provider_factory("container_cli", (config, _token, deps) => {
  const s = config.settings as ContainerCliSettings;
  const adapter = s.cli_type === "codex" ? new CodexCliAdapter()
    : s.cli_type === "gemini" ? new GeminiCliAdapter()
    : new ClaudeCliAdapter();
  return create_cli_backend(config, adapter, deps);
});
