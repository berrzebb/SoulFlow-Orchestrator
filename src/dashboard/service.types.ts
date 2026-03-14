/**
 * DashboardService 공개 인터페이스·타입 정의.
 * 라우트 핸들러·부트스트랩 코드에서 DashboardService 전체를 import하지 않아도 된다.
 */

import type { AgentInspectorLike } from "../agent/inspector.types.js";
import type { MessageBusLike } from "../bus/index.js";
import type { ChannelManager } from "../channels/index.js";
import type { DecisionService } from "../decision/index.js";
import type { PromiseService } from "../decision/promise.service.js";
import type { WorkflowEventService } from "../events/index.js";
import type { HeartbeatService } from "../heartbeat/index.js";
import type { OpsRuntimeService } from "../ops/index.js";
import type { Logger } from "../logger.js";
import type { ProcessTrackerLike } from "../orchestration/process-tracker.js";
import type { TaskState, TeamScopeOpts } from "../contracts.js";
import type { CronScheduler } from "../cron/index.js";
import type { DispatchDlqStoreLike } from "../channels/dlq-store.js";
import type { DispatchServiceLike } from "../channels/dispatch.service.js";
import type { SecretVaultLike } from "../security/secret-vault.js";
import type { SessionStoreLike } from "../session/index.js";

export interface DashboardTaskOps {
  cancel_task(task_id: string, reason?: string, opts?: TeamScopeOpts): Promise<TaskState | null>;
  get_task(task_id: string, opts?: TeamScopeOpts): Promise<TaskState | null>;
  resume_task(task_id: string, user_input?: string, opts?: TeamScopeOpts): Promise<TaskState | null>;
}

export interface DashboardConfigOps {
  get_current_config(): Record<string, unknown>;
  get_sections(): Promise<Array<{ id: string; label: string; fields: unknown[] }>>;
  get_section(section: string): Promise<{ id: string; label: string; fields: unknown[] } | null>;
  set_value(path: string, value: unknown): Promise<void>;
  remove_value(path: string): Promise<void>;
}

export interface DashboardSkillOps {
  list_skills(): Array<Record<string, string>>;
  get_skill_detail(name: string): { metadata: Record<string, unknown> | null; content: string | null; references: Array<{ name: string; content: string }> | null };
  refresh(): void;
  upload_skill(name: string, zip_buffer: Buffer): { ok: boolean; path: string; error?: string };
  write_skill_file(name: string, file: string, content: string): { ok: boolean; error?: string };
}

export interface DashboardToolOps {
  tool_names(): string[];
  get_definitions(): Array<Record<string, unknown>>;
  list_mcp_servers(): Array<{ name: string; connected: boolean; tools: string[]; error?: string }>;
}

export interface DashboardTemplateOps {
  list(): Array<{ name: string; exists: boolean }>;
  read(name: string): string | null;
  write(name: string, content: string): { ok: boolean };
}

export interface DashboardStatsOps {
  get_cd_score(): { total: number; events: Array<{ indicator: string; points: number; context: string; at: string }> };
  reset_cd_score(): void;
}

export interface DashboardMemoryOps {
  read_longterm(): Promise<string>;
  write_longterm(content: string): Promise<void>;
  list_daily(): Promise<string[]>;
  read_daily(day?: string): Promise<string>;
  write_daily(content: string, day?: string): Promise<void>;
}

export interface DashboardWorkspaceOps {
  list_files(rel_path?: string): Promise<Array<{ name: string; rel: string; is_dir: boolean; size: number; mtime: number }>>;
  read_file(rel_path: string): Promise<string | null>;
}

export interface ChannelStatusInfo {
  provider: string;
  instance_id: string;
  label: string;
  enabled: boolean;
  running: boolean;
  healthy: boolean;
  last_error?: string;
  token_configured: boolean;
  default_target: string;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface DashboardChannelOps {
  list(): Promise<ChannelStatusInfo[]>;
  get(instance_id: string): Promise<ChannelStatusInfo | null>;
  create(input: {
    instance_id: string;
    provider: string;
    label: string;
    enabled: boolean;
    settings: Record<string, unknown>;
    token?: string;
  }): Promise<{ ok: boolean; error?: string }>;
  update(instance_id: string, patch: {
    label?: string;
    enabled?: boolean;
    settings?: Record<string, unknown>;
    token?: string;
  }): Promise<{ ok: boolean; error?: string }>;
  remove(instance_id: string): Promise<{ ok: boolean; error?: string }>;
  test_connection(instance_id: string): Promise<{ ok: boolean; detail?: string; error?: string }>;
  list_providers(): string[];
}

export interface AgentProviderStatusInfo {
  instance_id: string;
  provider_type: string;
  label: string;
  enabled: boolean;
  priority: number;
  model_purpose: "chat" | "embedding";
  supported_modes: string[];
  settings: Record<string, unknown>;
  connection_id?: string;
  scope_type: string;
  scope_id: string;
  created_at: string;
  updated_at: string;
  available: boolean;
  circuit_state: string;
  capabilities: Record<string, boolean> | null;
  token_configured: boolean;
}

export interface ProviderConnectionInfo {
  connection_id: string;
  provider_type: string;
  label: string;
  enabled: boolean;
  api_base?: string;
  token_configured: boolean;
  preset_count: number;
  created_at: string;
  updated_at: string;
}

export interface DashboardAgentProviderOps {
  list(scope_filter?: import("../agent/provider-store.js").ProviderScopeFilter): Promise<AgentProviderStatusInfo[]>;
  get(instance_id: string): Promise<AgentProviderStatusInfo | null>;
  create(input: {
    instance_id: string;
    provider_type: string;
    label?: string;
    enabled?: boolean;
    priority?: number;
    model_purpose?: string;
    supported_modes?: string[];
    settings?: Record<string, unknown>;
    token?: string;
    connection_id?: string;
    scope_type?: string;
    scope_id?: string;
  }): Promise<{ ok: boolean; error?: string }>;
  update(instance_id: string, patch: {
    label?: string;
    enabled?: boolean;
    priority?: number;
    model_purpose?: string;
    supported_modes?: string[];
    settings?: Record<string, unknown>;
    token?: string;
    connection_id?: string;
  }): Promise<{ ok: boolean; error?: string }>;
  remove(instance_id: string): Promise<{ ok: boolean; error?: string }>;
  test_availability(instance_id: string): Promise<{ ok: boolean; detail?: string; error?: string }>;
  list_provider_types(): string[];
  list_models(provider_type: string, opts?: { api_key?: string; api_base?: string }): Promise<import("../services/model-catalog.js").ModelInfo[]>;

  // ── Connection (API 연결) ──
  list_connections(): Promise<ProviderConnectionInfo[]>;
  get_connection(connection_id: string): Promise<ProviderConnectionInfo | null>;
  create_connection(input: {
    connection_id: string;
    provider_type: string;
    label?: string;
    enabled?: boolean;
    api_base?: string;
    token?: string;
  }): Promise<{ ok: boolean; error?: string }>;
  update_connection(connection_id: string, patch: {
    label?: string;
    enabled?: boolean;
    api_base?: string;
    token?: string;
  }): Promise<{ ok: boolean; error?: string }>;
  remove_connection(connection_id: string): Promise<{ ok: boolean; error?: string }>;
  test_connection(connection_id: string): Promise<{ ok: boolean; detail?: string; error?: string }>;
}

export interface BootstrapOps {
  get_status(): { needed: boolean; providers: string[] };
  apply(input: {
    providers: Array<{ instance_id: string; provider_type: string; label?: string; enabled?: boolean; priority?: number; token?: string; settings?: Record<string, unknown> }>;
    executor?: string;
    orchestrator?: string;
    alias?: string;
    persona_name?: string;
  }): Promise<{ ok: boolean; error?: string }>;
}

export interface OAuthIntegrationInfo {
  instance_id: string;
  service_type: string;
  label: string;
  enabled: boolean;
  scopes: string[];
  allowed_hosts: string[];
  token_configured: boolean;
  expired: boolean;
  expires_at: string | null;
  has_client_secret: boolean;
  created_at: string;
  updated_at: string;
}

export interface DashboardOAuthOps {
  list(): Promise<OAuthIntegrationInfo[]>;
  get(id: string): Promise<OAuthIntegrationInfo | null>;
  create(input: {
    service_type: string;
    label: string;
    client_id: string;
    client_secret?: string;
    scopes: string[];
    allowed_hosts?: string[];
    auth_url?: string;
    token_url?: string;
  }): Promise<{ ok: boolean; instance_id?: string; error?: string }>;
  update(id: string, patch: {
    label?: string;
    enabled?: boolean;
    scopes?: string[];
    allowed_hosts?: string[];
  }): Promise<{ ok: boolean; error?: string }>;
  remove(id: string): Promise<{ ok: boolean; error?: string }>;
  start_auth(id: string, client_secret?: string, origin?: string): Promise<{ ok: boolean; auth_url?: string; error?: string }>;
  refresh(id: string): Promise<{ ok: boolean; error?: string }>;
  test(id: string): Promise<{ ok: boolean; detail?: string; error?: string }>;
  list_presets(): Array<{ service_type: string; label: string; auth_url: string; token_url: string; scopes_available: string[]; default_scopes: string[]; supports_refresh: boolean; is_builtin?: boolean; token_auth_method?: "basic" | "body"; scope_separator?: " " | ","; test_url?: string }>;
  register_preset(preset: {
    service_type: string; label: string; auth_url: string; token_url: string;
    scopes_available?: string[]; default_scopes?: string[]; supports_refresh?: boolean;
    token_auth_method?: "basic" | "body"; scope_separator?: " " | ","; test_url?: string;
    extra_auth_params?: Record<string, string>;
  }): Promise<{ ok: boolean; error?: string }>;
  update_preset(service_type: string, patch: {
    scopes_available?: string[]; default_scopes?: string[]; supports_refresh?: boolean;
    token_auth_method?: "basic" | "body"; scope_separator?: " " | ","; test_url?: string;
    auth_url?: string; token_url?: string;
  }): Promise<{ ok: boolean; error?: string }>;
  unregister_preset(service_type: string): Promise<{ ok: boolean; error?: string }>;
}

export interface DashboardModelOps {
  list(): Promise<Array<{ name: string; size: number; modified_at: string; digest: string; parameter_size?: string; quantization_level?: string }>>;
  pull(name: string): Promise<{ status: string; completed?: number; total?: number }>;
  pull_stream(name: string): AsyncGenerator<{ status: string; completed?: number; total?: number }>;
  delete(name: string): Promise<boolean>;
  list_active(): Promise<Array<{ name: string; size: number; size_vram: number; expires_at: string }>>;
  get_runtime_status(): Promise<Record<string, unknown>>;
  switch_model(name: string): Promise<Record<string, unknown>>;
}

export interface DashboardWorkflowOps {
  list(): Promise<import("../agent/phase-loop.types.js").PhaseLoopState[]>;
  get(workflow_id: string): Promise<import("../agent/phase-loop.types.js").PhaseLoopState | null>;
  create(input: Record<string, unknown>): Promise<{ ok: boolean; workflow_id?: string; error?: string }>;
  cancel(workflow_id: string): Promise<boolean>;
  get_messages(workflow_id: string, phase_id: string, agent_id: string): Promise<import("../agent/phase-loop.types.js").PhaseMessage[]>;
  send_message(workflow_id: string, phase_id: string, agent_id: string, content: string): Promise<{ ok: boolean; error?: string }>;
  list_templates(): import("../orchestration/workflow-loader.js").TemplateWithSlug[];
  get_template(name: string): import("../agent/phase-loop.types.js").WorkflowDefinition | null;
  save_template(name: string, definition: import("../agent/phase-loop.types.js").WorkflowDefinition): string;
  delete_template(name: string): boolean;
  import_template(yaml_content: string): { ok: boolean; name?: string; error?: string };
  export_template(name: string): string | null;
  list_roles(): Array<{ id: string; name: string; description: string; soul: string | null; heart: string | null; tools: string[]; use_when: string; not_use_for: string; preferred_model: string | null; shared_protocols: string[]; rendered_prompt: string | null }>;
  resume(workflow_id: string): Promise<{ ok: boolean; error?: string }>;
  update_settings(workflow_id: string, settings: { auto_approve?: boolean; auto_resume?: boolean }): Promise<{ ok: boolean; error?: string }>;
  run_single_node?(node: Record<string, unknown>, input_memory: Record<string, unknown>): Promise<{ ok: boolean; output?: unknown; duration_ms?: number; error?: string }>;
  test_single_node?(node: Record<string, unknown>, input_memory: Record<string, unknown>): { ok: boolean; preview?: unknown; warnings?: string[] };
  suggest?(instruction: string, options: { name?: string; workflow?: Record<string, unknown>; provider_id?: string; model?: string; save?: boolean; on_patch?: (path: string, section: Record<string, unknown> | unknown[]) => void; on_stream?: (text: string) => void }): Promise<{ ok: boolean; workflow?: Record<string, unknown>; name?: string; error?: string }>;
}

export interface DashboardCliAuthOps {
  get_status(): Array<{ cli: string; authenticated: boolean; account?: string; error?: string }>;
  check(cli: string): Promise<{ cli: string; authenticated: boolean; account?: string; error?: string }>;
  check_all(): Promise<Array<{ cli: string; authenticated: boolean; account?: string; error?: string }>>;
}

export interface DashboardPromptOps {
  run(input: {
    provider_id?: string;
    model?: string;
    prompt: string;
    system?: string;
    temperature?: number;
    max_tokens?: number;
  }): Promise<Record<string, unknown>>;
}

export interface DashboardUsageOps {
  list_spans(filter?: import("../gateway/usage-store.js").ListSpansFilter): Promise<import("../gateway/usage-store.js").LlmSpan[]>;
  get_daily_summary(days?: number): Promise<import("../gateway/usage-store.js").DailySummary[]>;
  get_provider_summary(days?: number): Promise<import("../gateway/usage-store.js").ProviderSummary[]>;
  get_today_by_model(): Promise<import("../gateway/usage-store.js").ModelDailySummary[]>;
}

export type DashboardOptions = {
  host: string;
  port: number;
  port_fallback?: boolean;
  agent: AgentInspectorLike;
  bus: MessageBusLike;
  channels: ChannelManager;
  heartbeat: HeartbeatService;
  ops: OpsRuntimeService;
  decisions: DecisionService;
  promises: PromiseService;
  events: WorkflowEventService;
  process_tracker?: ProcessTrackerLike | null;
  cron?: CronScheduler | null;
  task_ops?: DashboardTaskOps | null;
  stats_ops?: DashboardStatsOps | null;
  dlq?: DispatchDlqStoreLike | null;
  dispatch?: DispatchServiceLike | null;
  secrets?: SecretVaultLike | null;
  config_ops?: DashboardConfigOps | null;
  skill_ops?: DashboardSkillOps | null;
  tool_ops?: DashboardToolOps | null;
  template_ops?: DashboardTemplateOps | null;
  channel_ops?: DashboardChannelOps | null;
  agent_provider_ops?: DashboardAgentProviderOps | null;
  bootstrap_ops?: BootstrapOps | null;
  session_store?: SessionStoreLike | null;
  memory_ops?: DashboardMemoryOps | null;
  /** per-user MemoryStore 팩토리. 멀티테넌트에서 유저별 메모리 격리에 사용. */
  memory_store_factory?: ((root: string) => import("../agent/memory.types.js").MemoryStoreLike) | null;
  workspace_ops?: DashboardWorkspaceOps | null;
  oauth_ops?: DashboardOAuthOps | null;
  cli_auth_ops?: DashboardCliAuthOps | null;
  model_ops?: DashboardModelOps | null;
  workflow_ops?: DashboardWorkflowOps | null;
  agent_definition_ops?: import("./ops/agent-definition.js").DashboardAgentDefinitionOps | null;
  kanban_store?: import("../services/kanban-store.js").KanbanStoreLike | null;
  kanban_rule_executor?: import("../services/kanban-rule-executor.js").KanbanRuleExecutor | (() => import("../services/kanban-rule-executor.js").KanbanRuleExecutor | null) | null;
  reference_store?: import("../services/reference-store.js").ReferenceStoreLike | null;
  prompt_ops?: DashboardPromptOps | null;
  usage_ops?: DashboardUsageOps | null;
  default_alias?: string;
  workspace?: string;
  /** /hooks/* 엔드포인트 Bearer 토큰. 미설정 시 인증 없이 허용. */
  webhookSecret?: string;
  /** 인증 서비스. 설정 시 /api/* 전체에 JWT 인증 강제 (opt-in). */
  auth_svc?: import("../auth/auth-service.js").AuthService | null;
  /** 3-tier workspace 레이어 해석기. 인증 사용 시 필수. */
  workspace_resolver?: import("../workspace/resolver.js").WorkspaceResolver | null;
  /** 멀티유저 워크스페이스 경로 레지스트리. JWT 인증 후 자동 디렉토리 보장. */
  workspace_registry?: import("../workspace/registry.js").WorkspaceRegistry | null;
  logger?: Logger | null;
  /** OB-5: observability 주입. 미설정 시 no-op. */
  observability?: import("../observability/context.js").ObservabilityLike | null;
};

export const MAX_CHAT_SESSIONS = 20;
export const MAX_MESSAGES_PER_SESSION = 500;

export type RecentMessage = { direction: "inbound" | "outbound"; sender_id: string; content: string; chat_id: string; team_id: string; at: string };

export type ChatMediaItem = { type: string; url: string; mime?: string; name?: string };
export type ChatSessionMessage = { direction: "user" | "assistant"; content: string; at: string; media?: ChatMediaItem[]; model?: string; provider_instance_id?: string };

export type ChatSession = {
  id: string;
  /** 세션 소유자 user_id. 인증 비활성 시 빈 문자열. */
  user_id: string;
  /** 세션 소속 team_id. 인증 비활성 시 빈 문자열. */
  team_id: string;
  created_at: string;
  messages: ChatSessionMessage[];
  /** 사용자 지정 탭 이름 */
  name?: string;
};
