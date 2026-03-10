/** Provider/backend bundle: ProviderRegistry, CLI auth, MCP, backend registry, capability 계산. */

import { join } from "node:path";
import type { AppConfig } from "../config/schema.js";
import type { SecretVaultService } from "../security/secret-vault.js";
import type { AgentBackend } from "../agent/agent.types.js";
import type { ProviderCapabilities } from "../providers/executor.js";
import type { CliPermissionConfig } from "../providers/cli-permission.js";
import { AgentProviderStore } from "../agent/provider-store.js";
import { AgentBackendRegistry } from "../agent/agent-registry.js";
import { AgentSessionStore } from "../agent/agent-session-store.js";
import { create_agent_provider } from "../agent/provider-factory.js";
import { CliAuthService } from "../agent/cli-auth.service.js";
import { McpClientManager } from "../mcp/index.js";
import { ProviderRegistry } from "../providers/index.js";
import { create_logger } from "../logger.js";

export interface ProviderBundle {
  providers: ProviderRegistry;
  cli_auth: CliAuthService;
  mcp: McpClientManager;
  agent_backend_registry: AgentBackendRegistry;
  agent_backends: AgentBackend[];
  agent_session_store: AgentSessionStore;
  provider_caps: ProviderCapabilities;
  /** instance_id → provider_type 해석 (없으면 원본 문자열 반환). */
  resolve_instance_to_type: (id: string) => string;
}

export interface ProviderBundleDeps {
  workspace: string;
  data_dir: string;
  app_config: AppConfig;
  shared_vault: SecretVaultService;
  provider_store: AgentProviderStore;
  logger: ReturnType<typeof create_logger>;
}

export async function create_provider_bundle(deps: ProviderBundleDeps): Promise<ProviderBundle> {
  const { workspace, data_dir, app_config, shared_vault, provider_store, logger } = deps;

  // vault에서 API 키 읽기
  const openrouter_config = provider_store.get("openrouter");
  const openrouter_key = await provider_store.get_token("openrouter");
  // orchestrator_llm 인스턴스 없으면 ollama/openai_compatible 첫 번째를 fallback으로 사용
  const ORCH_LLM_TYPES = new Set(["ollama", "openai_compatible", "container_cli"]);
  const orchestrator_llm_config =
    provider_store.get("orchestrator_llm") ??
    provider_store.list().find((p) => ORCH_LLM_TYPES.has(p.provider_type));
  const orchestrator_llm_key =
    (await provider_store.get_token("orchestrator_llm")) ??
    (orchestrator_llm_config ? await provider_store.get_token(orchestrator_llm_config.instance_id) : null);

  // CLI provider별 command/args/timeout/permission 설정 조립
  const cli_permission_config: CliPermissionConfig = {
    workspace_dir: workspace,
    codex_bypass_sandbox: Boolean(provider_store.get("codex_cli")?.settings.bypass_sandbox),
    codex_sandbox_mode: String(provider_store.get("codex_cli")?.settings.sandbox_mode || ""),
    codex_add_dirs: String(provider_store.get("codex_cli")?.settings.additional_dirs || ""),
    claude_permission_mode: String(provider_store.get("claude_cli")?.settings.permission_mode || ""),
    gemini_approval_mode: String(provider_store.get("gemini_cli")?.settings.approval_mode || ""),
    mcp_enabled: app_config.mcp.enabled,
  };
  const codex_settings = (provider_store.get("codex_cli")?.settings || {}) as Record<string, unknown>;
  const claude_settings = (provider_store.get("claude_cli")?.settings || {}) as Record<string, unknown>;
  const gemini_settings = (provider_store.get("gemini_cli")?.settings || {}) as Record<string, unknown>;

  const resolve_instance_to_type = (id: string): string => {
    if (!id) return "";
    const inst = provider_store.get(id);
    return inst?.provider_type || id;
  };

  const providers = new ProviderRegistry({
    secret_vault: shared_vault,
    orchestrator_max_tokens: app_config.orchestration.orchestratorMaxTokens,
    orchestrator_provider: resolve_instance_to_type(app_config.orchestration.orchestratorProvider),
    orchestrator_model_override: app_config.orchestration.orchestratorModel || undefined,
    openrouter_api_key: openrouter_key,
    openrouter_api_base: (openrouter_config?.settings.api_base as string) || undefined,
    openrouter_model: (openrouter_config?.settings.model as string) || undefined,
    openrouter_http_referer: (openrouter_config?.settings.http_referer as string) || undefined,
    openrouter_app_title: (openrouter_config?.settings.app_title as string) || undefined,
    orchestrator_llm_api_key: orchestrator_llm_key,
    orchestrator_llm_api_base: (orchestrator_llm_config?.settings.api_base as string) || undefined,
    orchestrator_llm_model: (orchestrator_llm_config?.settings.model as string) || undefined,
    cli_configs: {
      chatgpt: {
        command: String(codex_settings.command || "codex"),
        args: String(codex_settings.args || ""),
        timeout_ms: Number(codex_settings.timeout_ms) || undefined,
        permission_config: cli_permission_config,
      },
      claude_code: {
        command: String(claude_settings.command || "claude"),
        args: String(claude_settings.args || ""),
        timeout_ms: Number(claude_settings.timeout_ms) || undefined,
        permission_config: cli_permission_config,
      },
      gemini: {
        command: String(gemini_settings.command || "gemini"),
        args: String(gemini_settings.args || ""),
        timeout_ms: Number(gemini_settings.timeout_ms) || undefined,
        permission_config: cli_permission_config,
      },
    },
  });

  // CLI 인증 서비스: container_cli 백엔드의 OAuth 상태 관리
  const cli_auth = new CliAuthService({ logger: logger.child("cli-auth") });

  // MCP 클라이언트: CLI 백엔드의 ToolBridge에서 오케스트레이터 도구 중계에 사용
  const mcp = new McpClientManager({ logger: logger.child("mcp") });

  // 팩토리 기반 백엔드 생성
  const factory_deps = { provider_registry: providers, workspace, cli_auth_service: cli_auth, mcp };
  const agent_backends: AgentBackend[] = [];
  for (const config of provider_store.list()) {
    if (!config.enabled) continue;
    const token = await provider_store.resolve_token(config.instance_id);
    const resolved_api_base = provider_store.resolve_api_base(config.instance_id);
    const effective_config = resolved_api_base && resolved_api_base !== config.settings.api_base
      ? { ...config, settings: { ...config.settings, api_base: resolved_api_base } }
      : config;
    const backend = create_agent_provider(effective_config, token, factory_deps);
    if (backend) agent_backends.push(backend);
  }

  const agent_session_store = new AgentSessionStore(join(data_dir, "agent-sessions.db"));
  const agent_backend_registry = new AgentBackendRegistry({
    provider_registry: providers,
    backends: agent_backends,
    config: {
      claude_backend: (provider_store.get("claude_sdk")?.enabled ? "claude_sdk" : "claude_cli") as "claude_cli" | "claude_sdk",
      codex_backend: (provider_store.get("codex_appserver")?.enabled ? "codex_appserver" : "codex_cli") as "codex_cli" | "codex_appserver",
    },
    provider_store,
    session_store: agent_session_store,
    logger: logger.child("agent-registry"),
  });
  // provider_configs 동기화: store → registry
  for (const config of provider_store.list()) {
    const backend = agent_backend_registry.get_backend(config.instance_id);
    if (backend) agent_backend_registry.register(backend, config);
  }

  // provider 가용성 caps (store 기반)
  const codex_config = provider_store.get("codex_cli");
  const claude_config = provider_store.get("claude_cli") || provider_store.get("claude_sdk");
  const provider_caps: ProviderCapabilities = {
    chatgpt_available: codex_config?.enabled ?? false,
    claude_available: claude_config?.enabled ?? false,
    openrouter_available: Boolean(openrouter_key),
  };

  return {
    providers,
    cli_auth,
    mcp,
    agent_backend_registry,
    agent_backends,
    agent_session_store,
    provider_caps,
    resolve_instance_to_type,
  };
}
