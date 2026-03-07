import { error_message, now_iso} from "./utils/common.js";
import { join, resolve } from "node:path";
import { mkdirSync, readdirSync, copyFileSync, existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AgentDomain } from "./agent/index.js";
import { create_agent_inspector } from "./agent/inspector.service.js";
import { create_agent_runtime } from "./agent/runtime.service.js";
import { CronTool, MemoryTool, DecisionTool, SecretTool, PromiseTool, TaskQueryTool, WorkflowTool } from "./agent/tools/index.js";
import { KanbanTool } from "./agent/tools/kanban.js";
import { KanbanStore, type KanbanStoreLike, type KanbanEvent } from "./services/kanban-store.js";
import { KanbanAutomationRuntime } from "./services/kanban-automation-runtime.js";
import { create_message_bus } from "./bus/index.js";
import type { MessageBusRuntime } from "./bus/index.js";
import {
  ChannelManager,
  SqliteDispatchDlqStore,
  ChannelInstanceStore,
  create_channels_from_store,
  type ChannelRegistryLike,
} from "./channels/index.js";
import { ActiveRunController } from "./channels/active-run-controller.js";
import { InMemoryRenderProfileStore } from "./channels/commands/render.handler.js";
import { ApprovalService } from "./channels/approval.service.js";
import { create_command_router } from "./channels/create-command-router.js";
import { TaskResumeService } from "./channels/task-resume.service.js";
import { DispatchService } from "./channels/dispatch.service.js";
import { MediaCollector } from "./channels/media-collector.js";
import { DefaultOutboundDedupePolicy } from "./channels/outbound-dedupe.js";
import { sanitize_provider_output } from "./channels/output-sanitizer.js";
import { PersonaMessageRenderer, TonePreferenceStore } from "./channels/persona-message-renderer.js";
import { DefaultRuntimePolicyResolver } from "./channels/runtime-policy.js";
import { SessionRecorder } from "./channels/session-recorder.js";
import { load_config_merged } from "./config/schema.js";
import { ConfigStore } from "./config/config-store.js";
import { get_shared_secret_vault, set_default_vault_workspace } from "./security/secret-vault-factory.js";
import { create_cron_job_handler, CronService } from "./cron/index.js";
import { sync_all_workflow_triggers } from "./cron/workflow-trigger-sync.js";
import { MemoryConsolidationService } from "./agent/memory-consolidation.service.js";
import { DashboardService } from "./dashboard/service.js";
import { MutableBroadcaster } from "./dashboard/broadcaster.js";
import { ToolIndex } from "./orchestration/tool-index.js";
import { DecisionService } from "./decision/index.js";
import { WorkflowEventService } from "./events/index.js";
import { HeartbeatService } from "./heartbeat/index.js";
import { create_logger } from "./logger.js";
import { OpsRuntimeService } from "./ops/index.js";
import { OrchestrationService, detect_hitl_type } from "./orchestration/service.js";
import { resolve_reply_to } from "./orchestration/service.js";
import { extract_persona_name } from "./orchestration/prompts.js";
import { ProcessTracker } from "./orchestration/process-tracker.js";
import { ConfirmationGuard } from "./orchestration/confirmation-guard.js";
import { HitlPendingStore } from "./orchestration/hitl-pending-store.js";
import { parse_executor_preference, resolve_executor_provider, type ProviderCapabilities } from "./providers/executor.js";
import { OrchestratorLlmRuntime, ProviderRegistry } from "./providers/index.js";
import { OrchestratorLlmServiceAdapter } from "./providers/orchestrator-llm-service.adapter.js";
import { acquire_runtime_instance_lock } from "./runtime/instance-lock.js";
import { ServiceManager } from "./runtime/service-manager.js";
import { SessionStore, type SessionStoreLike } from "./session/index.js";
import { McpClientManager, create_mcp_tool_adapters } from "./mcp/index.js";
import { FileMcpServerStore } from "./agent/tools/mcp-store.js";
import { AgentBackendRegistry } from "./agent/agent-registry.js";
import { AgentSessionStore } from "./agent/agent-session-store.js";
import { AgentProviderStore } from "./agent/provider-store.js";
import { create_agent_provider } from "./agent/provider-factory.js";
import { CliAuthService } from "./agent/cli-auth.service.js";
import { randomUUID } from "node:crypto";
import { init_log_level } from "./logger.js";
import { OAuthIntegrationStore } from "./oauth/integration-store.js";
import { OAuthFlowService } from "./oauth/flow-service.js";
import { OAuthFetchTool } from "./agent/tools/oauth-fetch.js";
import {
  create_template_ops, create_channel_ops, create_agent_provider_ops,
  create_bootstrap_ops, create_memory_ops, create_workspace_ops, create_oauth_ops,
  create_config_ops, create_skill_ops, create_tool_ops, create_cli_auth_ops, create_model_ops,
  create_workflow_ops,
} from "./dashboard/ops-factory.js";
import { PhaseWorkflowStore } from "./agent/phase-workflow-store.js";
import { create_embed_service_from_provider } from "./services/embed.service.js";
import { create_vector_store_service } from "./services/vector-store.service.js";
import { WebhookStore } from "./services/webhook-store.service.js";
import { create_task_service } from "./services/create-task.service.js";
import { create_query_db_service } from "./services/query-db.service.js";
import { ReferenceStore } from "./services/reference-store.js";

export interface RuntimeApp {
  agent: AgentDomain;
  bus: MessageBusRuntime;
  channels: ChannelRegistryLike;
  channel_manager: ChannelManager;
  cron: CronService;
  heartbeat: HeartbeatService;
  mcp: McpClientManager;
  providers: ProviderRegistry;
  agent_backends: AgentBackendRegistry;
  orchestrator_llm_runtime: OrchestratorLlmRuntime;
  sessions: SessionStoreLike;
  dashboard: DashboardService | null;
  decisions: DecisionService;
  events: WorkflowEventService;
  ops: OpsRuntimeService;
  services: ServiceManager;
  session_prune_timer: ReturnType<typeof setInterval>;
  cli_auth: CliAuthService;
}

/** KanbanStore subscribe를 Promise 기반 one-shot 대기로 변환. */
function make_wait_kanban_event(store: KanbanStoreLike) {
  return async (raw_board_id: string, filter: { actions?: string[]; column_id?: string }) => {
    // P1-8: scope:type:id 형식을 실제 board_id로 resolve
    let board_id = raw_board_id;
    const scope_match = raw_board_id.match(/^scope:(\w+):(.+)$/);
    if (scope_match) {
      const boards = await store.list_boards(scope_match[1] as import("./services/kanban-store.js").ScopeType, scope_match[2]);
      if (boards.length > 0) board_id = boards[0].board_id;
    }
    return new Promise<{ card_id: string; board_id: string; action: string; actor: string; detail: Record<string, unknown>; created_at: string } | null>((resolve) => {
      const timeout = setTimeout(() => { store.unsubscribe(board_id, handler); resolve(null); }, 60_000);
      const handler = (event: KanbanEvent) => {
        const act = event.data;
        if (filter.actions?.length && !filter.actions.includes(act.action)) return;
        if (filter.column_id) {
          const d = act.detail as Record<string, unknown>;
          const matches = d.column_id === filter.column_id || d.to === filter.column_id;
          if (!matches) return;
        }
        clearTimeout(timeout);
        store.unsubscribe(board_id, handler);
        resolve({ card_id: act.card_id, board_id: act.board_id, action: act.action, actor: act.actor, detail: act.detail, created_at: act.created_at });
      };
      store.subscribe(board_id, handler);
    });
  };
}

function resolve_from_workspace(workspace: string, path_value: string, fallback: string): string {
  const raw = String(path_value || "").trim();
  if (!raw) return fallback;
  return resolve(workspace, raw);
}

export async function createRuntime(): Promise<RuntimeApp> {
  const workspace = resolve_workspace();
  const app_root = resolve_app_root();

  // 기본 워크플로우 템플릿 시드 (WORKSPACE/workflows/ 가 비어있으면 default-workflows/ 에서 복사)
  seed_default_workflows(workspace, app_root);

  // vault default workspace 설정 — 이후 인자 없이 get_shared_secret_vault() 호출 가능
  set_default_vault_workspace(workspace);

  // ConfigStore: 하드코딩 기본값 위에 영속 오버라이드 + vault 민감 설정 병합
  const bootstrap_data_dir = join(workspace, "runtime");
  const shared_vault = get_shared_secret_vault(workspace);
  const config_store = new ConfigStore(join(bootstrap_data_dir, "config", "config.db"), shared_vault);
  const app_config = await load_config_merged(config_store);

  init_log_level(app_config.logging.level);

  const logger = create_logger("runtime");
  const data_dir = resolve_from_workspace(workspace, app_config.dataDir, join(workspace, "runtime"));
  const decisions_dir = join(data_dir, "decisions");
  const events_dir = join(data_dir, "events");
  const sessions_dir = join(data_dir, "sessions");
  const bus = await create_message_bus({
    backend: app_config.bus.backend,
    redis: {
      url: app_config.bus.redis.url,
      keyPrefix: app_config.bus.redis.keyPrefix,
      blockMs: app_config.bus.redis.blockMs,
      claimIdleMs: app_config.bus.redis.claimIdleMs,
      streamMaxlen: app_config.bus.redis.streamMaxlen,
    },
  });
  const decisions = new DecisionService(workspace, decisions_dir);
  const events = new WorkflowEventService(workspace, events_dir, null, app_config.taskLoopMaxTurns);
  // 에이전트 프로바이더 스토어: SQLite 영속화 + vault 토큰 관리
  const provider_store = new AgentProviderStore(
    join(data_dir, "agent-providers", "providers.db"),
    shared_vault,
  );
  // OAuth 연동 스토어 + 플로우 서비스
  const oauth_store = new OAuthIntegrationStore(
    join(data_dir, "oauth", "integrations.db"),
    shared_vault,
  );
  const oauth_flow = new OAuthFlowService(oauth_store);
  oauth_flow.load_custom_presets();

  // 워크플로우 노드용 서비스 인프라
  // 등록된 embedding 프로바이더 인스턴스에서 embed service 생성
  const embed_instance_id = app_config.embedding.instanceId
    || provider_store.list_for_purpose("embedding")[0]?.instance_id;
  const embed_provider = embed_instance_id ? provider_store.get(embed_instance_id) : null;
  const embed_model_override = app_config.embedding.model || undefined;
  const embed_service = embed_provider
    ? create_embed_service_from_provider({
      provider_type: embed_provider.provider_type,
      model: embed_model_override || (typeof embed_provider.settings.model === "string" ? embed_provider.settings.model : undefined),
      api_base: provider_store.resolve_api_base(embed_instance_id!),
      get_api_key: () => provider_store.resolve_token(embed_instance_id!),
    })
    : undefined;
  const vector_store_service = create_vector_store_service(data_dir);
  const webhook_store = new WebhookStore();
  const query_db_service = create_query_db_service(data_dir);

  // vault에서 API 키 읽기
  const openrouter_config = provider_store.get("openrouter");
  const openrouter_key = await provider_store.get_token("openrouter");
  const orchestrator_llm_config = provider_store.get("orchestrator_llm");
  const orchestrator_llm_key = await provider_store.get_token("orchestrator_llm");

  // CLI provider별 command/args/timeout/permission 설정 조립
  const cli_permission_config: import("./providers/cli-permission.js").CliPermissionConfig = {
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

  // 인스턴스 ID에서 provider_type 해석 (instance_id → provider_type, 없으면 원본 문자열 그대로 사용)
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
  const agent_backends: import("./agent/agent.types.js").AgentBackend[] = [];
  for (const config of provider_store.list()) {
    if (!config.enabled) continue;
    const token = await provider_store.resolve_token(config.instance_id);
    // connection의 api_base를 settings에 머지 (connection 우선)
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

  const tone_pref_store = new TonePreferenceStore(join(workspace, "runtime", "tone-preferences.json"));
  const persona_renderer = new PersonaMessageRenderer({
    get_persona_name: () => {
      try {
        for (const p of [join(workspace, "templates", "SOUL.md"), join(workspace, "SOUL.md")]) {
          if (existsSync(p)) { const r = readFileSync(p, "utf-8").trim(); if (r) return extract_persona_name(r); }
        }
      } catch { /* no soul */ }
      return "assistant";
    },
    get_heart: () => {
      try {
        for (const p of [join(workspace, "templates", "HEART.md"), join(workspace, "HEART.md")]) {
          if (existsSync(p)) { const r = readFileSync(p, "utf-8").trim(); if (r) return r; }
        }
      } catch { /* no heart */ }
      return "";
    },
    get_tone_preference: (chat_key) => tone_pref_store.get(chat_key),
  });

  const agent = new AgentDomain(workspace, {
    providers, bus, data_dir, events, agent_backends: agent_backend_registry,
    secret_vault: providers.get_secret_vault(), logger: logger.child("agent"),
    provider_caps, app_root,
    on_task_change: (task) => {
      broadcaster.broadcast_task_event("status_change", task);
      // HITL 상태를 채널에 알림 (최상위 + 서브태스크 모두)
      if (task.status === "waiting_user_input" || task.status === "max_turns_reached") {
        const channel = task.channel || String(task.memory?.channel || "");
        const chat_id = task.chatId || String(task.memory?.chat_id || "");
        if (!channel || !chat_id) return;
        const raw_prompt = String(task.memory?.last_output || "").trim();
        // ask_user 도구가 이미 채널에 질문을 직접 전송한 경우 중복 발송 방지
        if (raw_prompt.includes("ask_user_sent:")) return;
        const prompt = raw_prompt || build_hitl_fallback_body(task);
        const hitl_type = task.status === "max_turns_reached" ? "error" as const : detect_hitl_type(prompt);
        const body = task.status === "max_turns_reached"
          ? prompt || `최대 실행 횟수(${task.maxTurns}턴)에 도달하여 작업이 일시 중지되었습니다.`
          : prompt;
        const content = persona_renderer.render({ kind: "hitl_prompt", hitl_type: hitl_type, body });
        const reply_to = String(task.memory?.__trigger_message_id || "").trim() || undefined;
        bus.publish_outbound({
          id: `hitl-${task.taskId}-${Date.now()}`,
          provider: channel, channel, sender_id: "agent",
          chat_id, content, reply_to, at: now_iso(),
          metadata: { kind: "task_hitl_notify", task_id: task.taskId, status: task.status },
        }).catch(() => { /* bus 발행 실패가 태스크 실행을 차단하면 안 됨 */ });
      }
    },
  });
  agent.context.set_oauth_summary_provider(async () => {
    const configs = oauth_store.list();
    const results = [];
    for (const c of configs) {
      if (!c.enabled) continue;
      const connected = await oauth_store.has_access_token(c.instance_id);
      results.push({
        instance_id: c.instance_id,
        service_type: c.service_type,
        label: c.label,
        scopes: c.scopes,
        connected,
      });
    }
    return results;
  });
  const phase_workflow_store = new PhaseWorkflowStore(join(workspace, "runtime", "workflows"));
  const kanban_store = new KanbanStore(join(workspace, "runtime"));
  const kanban_tool = new KanbanTool(kanban_store);
  const kanban_automation = new KanbanAutomationRuntime();
  const agent_inspector = create_agent_inspector(agent);
  const agent_runtime = create_agent_runtime(agent, { phase_workflow_store });
  // 도구 인덱스: runtime-owned instance (global singleton 대신 명시적 주입)
  const tool_index = new ToolIndex();
  // 임베딩 서비스 연결 (벡터 시멘틱 검색 활성화)
  if (embed_service) {
    agent.context.memory_store.set_embed?.(embed_service);
    tool_index.set_embed(embed_service);
  }
  agent.context.set_daily_injection(app_config.memory.dailyInjectionDays, app_config.memory.dailyInjectionMaxChars);
  // Reference 문서 스토어 (workspace/references/ → 자동 임베딩 + 컨텍스트 주입)
  const reference_store = new ReferenceStore(workspace);
  if (embed_service) reference_store.set_embed(embed_service);
  agent.context.set_reference_store(reference_store);
  const sessions = new SessionStore(workspace, sessions_dir);

  events.bind_task_store(agent.task_store);

  // 메모리 압축 서비스
  const memory_consolidation = new MemoryConsolidationService({
    memory_store: agent.context.memory_store,
    config: {
      enabled: app_config.memory.consolidation.enabled,
      trigger: app_config.memory.consolidation.trigger,
      idle_after_ms: app_config.memory.consolidation.idleAfterMs,
      interval_ms: app_config.memory.consolidation.intervalMs,
      window_days: app_config.memory.consolidation.windowDays,
      archive_used: app_config.memory.consolidation.archiveUsed,
    },
    logger,
  });

  const instance_store = new ChannelInstanceStore(join(data_dir, "channels", "instances.db"), shared_vault);

  const channels = await create_channels_from_store(instance_store);

  // 기본 채널 타겟 해석
  const primary_channel = instance_store.list().find((c) => c.enabled);
  const primary_provider = primary_channel?.provider || "slack";
  const default_chat_id = primary_channel
    ? String(
        (primary_channel.settings as Record<string, unknown>).default_channel
        || (primary_channel.settings as Record<string, unknown>).default_chat_id
        || "",
      ).trim()
    : "";

  const dlq_store = app_config.channel.dispatch.dlqEnabled
    ? new SqliteDispatchDlqStore(resolve_from_workspace(workspace, app_config.channel.dispatch.dlqPath, join(data_dir, "dlq", "dlq.db")))
    : null;
  const dispatch = new DispatchService({
    bus,
    registry: channels,
    retry_config: app_config.channel.dispatch,
    dedupe_config: app_config.channel.outboundDedupe,
    dlq_store,
    dedupe_policy: new DefaultOutboundDedupePolicy(),
    logger: logger.child("dispatch"),
    on_direct_send: (msg) => broadcaster.broadcast_message_event("outbound", msg.sender_id, msg.content, msg.chat_id),
  });

  const session_recorder = new SessionRecorder({
    sessions,
    daily_memory: agent_runtime,
    sanitize_for_storage: sanitize_provider_output,
    logger: logger.child("session"),
    on_mirror_message: (event) => broadcaster.broadcast_mirror_message(event),
  });

  const slack_token = await instance_store.get_token("slack") || "";
  const telegram_token = await instance_store.get_token("telegram") || "";
  const telegram_settings = (instance_store.get("telegram")?.settings as Record<string, unknown>) || {};
  const media_collector = new MediaCollector({
    workspace_dir: workspace,
    tokens: {
      slack_bot_token: slack_token,
      telegram_bot_token: telegram_token,
      telegram_api_base: String(telegram_settings.api_base || "https://api.telegram.org"),
    },
    logger,
  });

  const approval = new ApprovalService({
    agent_runtime,
    send_reply: (provider, message) => dispatch.send(provider, message),
    resolve_reply_to,
    logger: logger.child("approval"),
  });

  const active_run_controller = new ActiveRunController();
  const render_profile_store = new InMemoryRenderProfileStore();
  const dashboard: { current: DashboardService | null } = { current: null };
  const broadcaster = new MutableBroadcaster();

  const process_tracker = new ProcessTracker({
    max_history: 100,
    cancel_strategy: {
      abort_run: (provider, chat_id, alias) => {
        const key = `${provider}:${chat_id}:${alias}`.toLowerCase();
        return active_run_controller.cancel(key) > 0;
      },
      stop_loop: (loop_id) => !!agent_runtime.stop_loop(loop_id),
      cancel_task: async (task_id) => !!(await agent_runtime.cancel_task(task_id)),
      cancel_subagent: (id) => agent.subagents.cancel(id),
    },
    on_change: (type, entry) => broadcaster.broadcast_process_event(type, entry),
  });

  const confirmation_guard = new ConfirmationGuard();
  const hitl_pending_store = new HitlPendingStore();

  // oauth_fetch 서비스: 워크플로우 노드에서 OAuth 인증 HTTP 호출 지원
  const oauth_fetch_service = async (
    service_id: string,
    opts: { url: string; method: string; headers?: Record<string, string>; body?: unknown },
  ): Promise<{ status: number; body: unknown; headers: Record<string, string> }> => {
    const { normalize_headers, serialize_body, timed_fetch } = await import("./agent/tools/http-utils.js");
    const integration = oauth_store.get(service_id);
    if (!integration) throw new Error(`OAuth integration "${service_id}" not found`);
    if (!integration.enabled) throw new Error(`OAuth integration "${service_id}" is disabled`);

    const { token, error } = await oauth_flow.get_valid_access_token(service_id);
    if (!token) throw new Error(`No valid token for "${service_id}": ${error || "not configured"}`);

    const method = (opts.method || "GET").toUpperCase();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...normalize_headers(opts.headers),
    };
    const body = serialize_body(opts.body, headers);

    let res = await timed_fetch(opts.url, { method, headers, body, timeout_ms: 15_000 });

    // 401 → 토큰 갱신 후 재시도
    if (res.status === 401) {
      const refresh_result = await oauth_flow.refresh_token(service_id);
      if (refresh_result.ok) {
        const new_token = await oauth_store.get_access_token(service_id);
        if (new_token) {
          headers.Authorization = `Bearer ${new_token}`;
          res = await timed_fetch(opts.url, { method, headers, body, timeout_ms: 15_000 });
        }
      }
    }

    const res_headers: Record<string, string> = {};
    res.headers.forEach((v, k) => { res_headers[k] = v; });
    const content_type = res.headers.get("content-type") || "";
    const res_body = content_type.includes("json") ? await res.json() : await res.text();
    return { status: res.status, body: res_body, headers: res_headers };
  };

  // create_task: lazy thunk — 클로저 내부에서 orchestration을 참조하지만, 호출 시점에만 resolve됨
  const create_task_fn = create_task_service(() => ({
    execute: async (opts) => {
      const run_id = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const result = await orchestration.execute({
        message: {
          id: run_id,
          provider: opts.channel,
          channel: opts.channel,
          sender_id: "workflow",
          chat_id: opts.chat_id,
          content: opts.objective,
          at: now_iso(),
        },
        alias: opts.title || "default",
        provider: opts.channel,
        media_inputs: [],
        session_history: [],
        run_id,
        max_turns: opts.max_turns,
        initial_memory: opts.initial_memory,
      });
      const has_error = !!result.error;
      return {
        task_id: result.run_id || run_id,
        status: has_error ? "failed" : "completed",
        result: result.reply ?? undefined,
        error: has_error ? (result.error || result.reply || undefined) : undefined,
      };
    },
  }));

  const orchestration = new OrchestrationService({
    providers,
    agent_runtime,
    secret_vault: providers.get_secret_vault(),
    runtime_policy_resolver: new DefaultRuntimePolicyResolver(),
    config: {
      executor_provider: resolve_executor_provider(
        parse_executor_preference(resolve_instance_to_type(app_config.orchestration.executorProvider) || app_config.orchestration.executorProvider),
        provider_caps,
      ),
      agent_loop_max_turns: app_config.agentLoopMaxTurns,
      task_loop_max_turns: app_config.taskLoopMaxTurns,
      streaming_enabled: app_config.channel.streaming.enabled,
      streaming_interval_ms: app_config.channel.streaming.intervalMs,
      streaming_min_chars: app_config.channel.streaming.minChars,
      max_tool_result_chars: app_config.orchestration.maxToolResultChars,
      orchestrator_max_tokens: app_config.orchestration.orchestratorMaxTokens,
    },
    logger: logger.child("orchestration"),
    agent_backends: agent_backend_registry,
    process_tracker,
    get_mcp_configs: () => mcp.get_server_configs(),
    events,
    workspace,
    subagents: agent.subagents,
    phase_workflow_store,
    get_sse_broadcaster: () => broadcaster,
    confirmation_guard,
    bus,
    decision_service: decisions,
    promise_service: agent.context.promise_service,
    oauth_fetch: oauth_fetch_service,
    embed: embed_service,
    vector_store: vector_store_service,
    get_webhook_data: (path) => webhook_store.get(path),
    wait_kanban_event: make_wait_kanban_event(kanban_store),
    query_db: query_db_service,
    renderer: persona_renderer,
    hitl_pending_store,
    tool_index,
    create_task: create_task_fn,
  });

  const cron = new CronService(join(data_dir, "cron"), create_cron_job_handler({
    config: {
      agent_loop_max_turns: app_config.agentLoopMaxTurns,
      default_alias: app_config.channel.defaultAlias,
      executor_provider: resolve_instance_to_type(app_config.orchestration.executorProvider) || app_config.orchestration.executorProvider,
      provider_caps,
      resolve_default_target: () => {
        if (!default_chat_id) return null;
        return { provider: primary_provider, chat_id: default_chat_id };
      },
    },
    bus,
    events,
    agent_runtime,
    agent_backends: agent_backend_registry,
    secret_vault: providers.get_secret_vault(),
    on_workflow_trigger: async (slug, channel, chat_id) => {
      try {
        const { load_workflow_template, substitute_variables } = await import("./orchestration/workflow-loader.js");
        const template = load_workflow_template(workspace, slug);
        if (!template) return { ok: false, error: `template not found: ${slug}` };
        const substituted = substitute_variables(template, { ...template.variables, channel });
        const run_id = `wf-cron_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const result = await orchestration.execute({
          message: { id: run_id, provider: channel, channel, sender_id: "cron", chat_id, content: substituted.objective || substituted.title, at: now_iso() },
          alias: app_config.channel.defaultAlias,
          provider: channel,
          media_inputs: [],
          session_history: [],
          run_id,
        });
        return { ok: !result.error, workflow_id: result.run_id || run_id, error: result.error || undefined };
      } catch (e) {
        return { ok: false, error: error_message(e) };
      }
    },
  }), {
    on_change: (type, job_id) => broadcaster.broadcast_cron_event(type, job_id),
  });

  const command_router = create_command_router({
    cancel_active_runs: (key) => active_run_controller.cancel(key),
    render_profile: render_profile_store,
    agent, agent_runtime, process_tracker, orchestration, providers,
    agent_backend_registry, mcp, session_recorder, cron, decisions,
    default_alias: app_config.channel.defaultAlias,
    confirmation_guard,
    tone_store: tone_pref_store,
  });

  const task_resume = new TaskResumeService({
    agent_runtime,
    logger: logger.child("task-resume"),
  });

  // bot identity: instance_id 우선 조회 → provider 폴백
  const bot_identity = {
    get_bot_self_id(id: string): string {
      const inst = instance_store.get(id);
      return String((inst?.settings as Record<string, unknown>)?.bot_self_id || "").trim();
    },
    get_default_target(id: string): string {
      const inst = instance_store.get(id);
      const s = (inst?.settings as Record<string, unknown>) || {};
      return String(s.default_channel || s.default_chat_id || "").trim();
    },
  };

  const channel_manager = new ChannelManager({
    bus,
    registry: channels,
    dispatch,
    command_router,
    orchestration,
    approval,
    task_resume,
    session_recorder,
    session_store: sessions,
    media_collector,
    process_tracker,
    providers,
    config: app_config.channel,
    workspace_dir: workspace,
    logger: app_config.channel.debug ? create_logger("channels", "debug") : logger.child("channels"),
    bot_identity,
    on_agent_event: (event) => broadcaster.broadcast_agent_event(event),
    on_web_stream: (chat_id, content, done) => broadcaster.broadcast_web_stream(chat_id, content, done),
    confirmation_guard,
    on_activity_start: () => memory_consolidation.touch_start(),
    on_activity_end: () => memory_consolidation.touch_end(),
    renderer: persona_renderer,
    active_run_controller,
    render_profile_store,
  });
  // ActiveRunController에 ProcessTracker 연결 (cancel 시 run 종료 기록)
  active_run_controller.set_tracker(process_tracker);

  const orchestrator_llm_runtime = new OrchestratorLlmRuntime({
    enabled: app_config.orchestratorLlm.enabled,
    engine: app_config.orchestratorLlm.engine,
    image: app_config.orchestratorLlm.image,
    container: app_config.orchestratorLlm.container,
    port: app_config.orchestratorLlm.port,
    model: app_config.orchestratorLlm.model,
    pull_model: app_config.orchestratorLlm.pullModel,
    auto_stop: app_config.orchestratorLlm.autoStop,
    gpu_enabled: app_config.orchestratorLlm.gpuEnabled,
    gpu_args: app_config.orchestratorLlm.gpuArgs,
    api_base: (orchestrator_llm_config?.settings.api_base as string) || app_config.orchestratorLlm.apiBase,
  });

  const services = new ServiceManager(logger.child("services"));

  const heartbeat = new HeartbeatService(workspace, {
    on_heartbeat: async (prompt) => {
      const result = await agent_runtime.spawn_and_wait({ task: prompt, max_turns: 5, timeout_ms: 60_000 });
      return String(result || "");
    },
    on_notify: default_chat_id
      ? async (message) => {
          await bus.publish_outbound({
            id: `heartbeat-notify-${Date.now()}`,
            provider: primary_provider,
            channel: primary_provider,
            sender_id: "heartbeat",
            chat_id: default_chat_id,
            content: `💓 Heartbeat:\n${message}`,
            at: now_iso(),
            metadata: { kind: "heartbeat_notify" },
          });
        }
      : null,
  });
  const ops = new OpsRuntimeService({
    bus,
    channels: channel_manager,
    cron,
    heartbeat,
    decisions,
    services,
    secret_vault: providers.get_secret_vault(),
    session_store: sessions,
    promises: agent.context.promise_service,
    dlq: dlq_store,
  }, app_config.ops);

  // WorkflowOps는 대시보드 + WorkflowTool 양쪽에서 사용
  const workflow_ops_result = create_workflow_ops({
    hitl_pending_store, renderer: persona_renderer,
    store: phase_workflow_store, subagents: agent.subagents, workspace, logger, bus,
    skills_loader: agent.context.skills_loader,
    on_workflow_event: (e) => broadcaster.broadcast_workflow_event(e),
    invoke_tool: (tool_id, params, ctx) => agent.tools.execute(tool_id, params, ctx ? { channel: ctx.channel, chat_id: ctx.chat_id, sender_id: ctx.sender_id, task_id: ctx.workflow_id } : undefined),
    providers,
    get_tool_summaries: () => agent.tools.get_all().map((t) => ({
      name: t.name, description: t.description, category: t.category,
    })),
    get_provider_summaries: () => {
      try {
        return provider_store.list().filter((p) => p.enabled).map((p) => ({
          backend: p.instance_id, label: p.label, provider_type: p.provider_type,
          models: [String(p.settings?.model || "")].filter(Boolean),
        }));
      } catch { return []; }
    },
    decision_service: decisions,
    promise_service: agent.context.promise_service,
    oauth_fetch: oauth_fetch_service,
    embed: embed_service,
    vector_store: vector_store_service,
    get_webhook_data: (path) => webhook_store.get(path),
    wait_kanban_event: make_wait_kanban_event(kanban_store),
    create_task: create_task_fn,
    query_db: query_db_service,
    on_kanban_trigger_waiting: (wf_id) => kanban_automation.notify_workflow_waiting(wf_id),
  });
  // HITL bridge: 공유 store 기반 단일 bridge
  channel_manager.set_workflow_hitl({
    async try_resolve(chat_id, content) {
      return hitl_pending_store.try_resolve(chat_id, content);
    },
  });

  // kanban automation: trigger watcher + rule executor 초기화
  await kanban_automation.init_trigger_watcher({
    kanban_store,
    workflow_store: phase_workflow_store,
    resumer: workflow_ops_result,
  });
  await kanban_automation.init_rule_executor(kanban_store, {
    async run_workflow(params) {
      const result = await workflow_ops_result.create({
        template_name: params.template,
        title: params.title,
        objective: params.objective,
        channel: params.channel || "dashboard",
        chat_id: params.chat_id || "kanban-rule",
      });
      return { ok: result.ok, workflow_id: result.workflow_id, error: result.error };
    },
    async create_task(params) {
      const result = await create_task_fn({
        title: params.prompt,
        objective: params.prompt,
        channel: params.channel,
        chat_id: params.chat_id,
      });
      return { ok: !!result.task_id, task_id: result.task_id, error: result.error };
    },
  });
  const rule_executor = kanban_automation.get_rule_executor();
  if (rule_executor) kanban_tool.set_rule_executor(rule_executor);

  // late-inject: /workflow, /model 커맨드
  const { WorkflowHandler, ModelHandler } = await import("./channels/commands/index.js");
  command_router.add_handler(new WorkflowHandler({
    list_runs: async () => {
      const runs = await workflow_ops_result.list();
      return runs.map((r) => ({
        workflow_id: r.workflow_id,
        title: r.title || "",
        status: r.status,
        created_at: r.created_at,
        current_phase: r.current_phase,
      }));
    },
    get_run: async (id) => {
      const r = await workflow_ops_result.get(id);
      if (!r) return null;
      return { workflow_id: r.workflow_id, title: r.title || "", status: r.status, created_at: r.created_at, current_phase: r.current_phase };
    },
    create: (input) => workflow_ops_result.create(input),
    cancel: (id) => workflow_ops_result.cancel(id),
    list_templates: () => workflow_ops_result.list_templates(),
  }));
  if (orchestrator_llm_runtime.get_status().enabled) {
    command_router.add_handler(new ModelHandler({
      list: async () => {
        try { return (await orchestrator_llm_runtime.list_models()).map((m) => ({ name: m.name })); }
        catch { return []; }
      },
      get_default: () => orchestrator_llm_runtime.get_status().model || null,
      set_default: (model) => { orchestrator_llm_runtime.switch_model(model); return true; },
    }));
  }

  const agent_provider_ops_result = create_agent_provider_ops({
    provider_store, agent_backends: agent_backend_registry,
    provider_registry: providers, workspace,
  });

  if (app_config.dashboard.enabled) {
    const dash = new DashboardService({
      host: app_config.dashboard.host,
      port: app_config.dashboard.port,
      port_fallback: app_config.dashboard.portFallback,
      agent: agent_inspector,
      bus,
      channels: channel_manager,
      heartbeat,
      ops,
      decisions,
      promises: agent.context.promise_service,
      events,
      process_tracker,
      cron,
      task_ops: {
        cancel_task: (id, reason) => agent_runtime.cancel_task(id, reason),
        get_task: (id) => agent_runtime.get_task(id),
        resume_task: (id, text) => agent_runtime.resume_task(id, text),
      },
      stats_ops: {
        get_cd_score: () => orchestration.get_cd_score(),
        reset_cd_score: () => orchestration.reset_cd_score(),
      },
      dlq: dlq_store,
      secrets: providers.get_secret_vault(),
      config_ops: create_config_ops({ app_config, config_store }),
      skill_ops: create_skill_ops({ skills_loader: agent.context.skills_loader, workspace }),
      tool_ops: create_tool_ops({ tool_names: () => agent.tools.tool_names(), get_definitions: () => agent.tools.get_definitions(), mcp }),
      template_ops: create_template_ops(workspace),
      channel_ops: create_channel_ops({ channels, instance_store, app_config }),
      agent_provider_ops: agent_provider_ops_result,
      bootstrap_ops: create_bootstrap_ops({ provider_store, config_store, provider_registry: providers, agent_backends: agent_backend_registry, workspace }),
      session_store: sessions,
      memory_ops: create_memory_ops(agent.context.memory_store),
      workspace_ops: create_workspace_ops(workspace),
      oauth_ops: create_oauth_ops({ oauth_store, oauth_flow, dashboard_port: app_config.dashboard.port, public_url: app_config.dashboard.publicUrl }),
      cli_auth_ops: create_cli_auth_ops({ cli_auth }),
      model_ops: orchestrator_llm_runtime ? create_model_ops(orchestrator_llm_runtime) : null,
      workflow_ops: workflow_ops_result,
      kanban_store,
      kanban_rule_executor: () => kanban_automation.get_rule_executor(),
      reference_store,
      default_alias: app_config.channel.defaultAlias,
      workspace,
    });
    dashboard.current = dash;
    broadcaster.attach(dash.sse);
    dash.set_oauth_callback_handler((code: string, state: string) => oauth_flow.handle_callback(code, state));
    dash.set_webhook_store(webhook_store);
    bus.on_publish((dir, msg) => {
      broadcaster.broadcast_message_event(dir, msg.sender_id, msg.content, msg.chat_id);
      if (dir === "outbound" && msg.provider === "web" && msg.chat_id) {
        const media = msg.media?.map((m) => ({ type: m.type as string, url: m.url, mime: m.mime, name: m.name }));
        dash.capture_web_outbound(msg.chat_id, msg.content, media);
      }
    });
  }

  // ProgressEvent consumer: bus → dashboard SSE 릴레이 (대시보드 비활성 시에도 큐 소비)
  (async function progress_relay() {
    while (!bus.is_closed()) {
      const event = await bus.consume_progress({ timeout_ms: 5000 });
      if (event) broadcaster.broadcast_progress_event(event);
    }
  })().catch((e) => logger.error("[progress_relay] unhandled:", e));

  if (!agent_runtime.has_tool("cron")) {
    agent_runtime.register_tool(new CronTool(cron));
  }
  if (!agent_runtime.has_tool("memory")) {
    agent_runtime.register_tool(new MemoryTool(agent.context.memory_store));
  }
  if (!agent_runtime.has_tool("decision")) {
    agent_runtime.register_tool(new DecisionTool(decisions));
  }
  if (!agent_runtime.has_tool("secret")) {
    agent_runtime.register_tool(new SecretTool(providers.get_secret_vault()));
  }
  if (!agent_runtime.has_tool("promise")) {
    agent_runtime.register_tool(new PromiseTool(agent.context.promise_service));
  }
  if (!agent_runtime.has_tool("task_query")) {
    agent_runtime.register_tool(new TaskQueryTool(async (task_id) => {
      const state = await agent_runtime.get_task(task_id);
      if (!state) return null;
      return {
        task_id: state.taskId,
        title: state.title,
        status: state.status,
        current_step: state.currentStep,
        exit_reason: state.exitReason,
        current_turn: state.currentTurn,
        max_turns: state.maxTurns,
      };
    }));
  }
  if (!agent_runtime.has_tool("oauth_fetch")) {
    agent_runtime.register_tool(new OAuthFetchTool(oauth_store, oauth_flow));
  }
  if (!agent_runtime.has_tool("workflow")) {
    agent_runtime.register_tool(new WorkflowTool(workflow_ops_result, agent_provider_ops_result));
  }
  if (!agent_runtime.has_tool("kanban")) {
    agent_runtime.register_tool(kanban_tool);
  }

  services.register(agent, { required: true });
  services.register(dispatch, { required: true });
  services.register(channel_manager, { required: true });
  services.register(cron, { required: true });
  services.register(heartbeat, { required: false });
  services.register(ops, { required: false });
  if (dashboard.current) services.register(dashboard.current, { required: false });
  services.register(mcp, { required: false });
  services.register(new OrchestratorLlmServiceAdapter(orchestrator_llm_runtime), { required: false });
  if (app_config.memory.consolidation.enabled) services.register(memory_consolidation, { required: false });

  const enabled_channels = instance_store.list().filter((c) => c.enabled).map((c) => c.provider);
  logger.info(`channels=${enabled_channels.join(",")} primary=${primary_provider}`);

  await register_mcp_tools(workspace, mcp, agent_runtime, logger).catch((error) => {
    logger.error(`mcp tool registration failed: ${error_message(error)}`);
  });

  const session_id = randomUUID();
  agent.loop.set_session_id(session_id);
  logger.info(`session_id=${session_id}`);

  await services.start();

  // 워크플로우 trigger_nodes → 런타임 서비스 동기화 (cron/webhook/channel_message)
  const trigger_sync_deps = {
    cron,
    bus,
    webhook_store: webhook_store,
    kanban_store: kanban_store as import("./services/kanban-store.js").KanbanStoreLike,
    execute: async (slug: string, channel: string, chat_id: string, trigger_data?: Record<string, unknown>) => {
      try {
        const { load_workflow_template, substitute_variables } = await import("./orchestration/workflow-loader.js");
        const template = load_workflow_template(workspace, slug);
        if (!template) return { ok: false, error: `template not found: ${slug}` };
        const substituted = substitute_variables(template, { ...template.variables, channel });
        const run_id = `wf-trigger_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const content = trigger_data
          ? `${substituted.objective || substituted.title}\n\n[trigger data]\n${JSON.stringify(trigger_data, null, 2)}`
          : substituted.objective || substituted.title;
        const result = await orchestration.execute({
          message: { id: run_id, provider: channel, channel, sender_id: "trigger", chat_id, content, at: now_iso() },
          alias: app_config.channel.defaultAlias,
          provider: channel,
          media_inputs: [],
          session_history: [],
          run_id,
        });
        return { ok: !result.error, workflow_id: result.run_id || run_id, error: result.error || undefined };
      } catch (e) {
        return { ok: false, error: error_message(e) };
      }
    },
    default_channel: primary_provider,
    default_chat_id: default_chat_id || "",
  };
  try {
    const { load_workflow_templates } = await import("./orchestration/workflow-loader.js");
    const templates = load_workflow_templates(workspace);
    const sync_result = await sync_all_workflow_triggers(templates, trigger_sync_deps);
    const total = sync_result.cron.added + sync_result.webhook.registered + sync_result.channel_message.registered + sync_result.kanban_event.registered;
    if (total > 0) logger.info(`workflow triggers synced: cron=${sync_result.cron.added} webhook=${sync_result.webhook.registered} channel=${sync_result.channel_message.registered} kanban=${sync_result.kanban_event.registered}`);
  } catch (e) {
    logger.warn(`workflow trigger sync failed: ${error_message(e)}`);
  }

  // 만료된 에이전트 세션 정리: 시작 시 즉시 + 1시간 간격
  try { agent_session_store.prune_expired(); } catch { /* noop */ }
  const session_prune_timer = setInterval(() => {
    try { agent_session_store.prune_expired(); } catch { /* noop */ }
  }, 60 * 60 * 1000);
  session_prune_timer.unref();

  // CLI 인증 상태 비차단 확인: container_cli 백엔드의 is_available() 갱신
  cli_auth.check_all().then((statuses) => {
    for (const s of statuses) {
      logger.info(`cli-auth ${s.cli} authenticated=${s.authenticated}${s.account ? ` account=${s.account}` : ""}`);
    }
    // ContainerCliAgent.check_auth() 호출하여 is_available() 반영
    for (const backend of agent_backends) {
      if ("check_auth" in backend && typeof (backend as { check_auth: () => Promise<boolean> }).check_auth === "function") {
        void (backend as { check_auth: () => Promise<boolean> }).check_auth();
      }
    }
  }).catch((err) => {
    logger.warn(`cli-auth check failed: ${error_message(err)}`);
  });

  if (dashboard.current) logger.info(`dashboard ${dashboard.current.get_url()}`);
  const orch_llm_status = orchestrator_llm_runtime.get_status();
  if (orch_llm_status.enabled) {
    logger.info(`orchestrator-llm running=${orch_llm_status.running} engine=${orch_llm_status.engine || "n/a"} base=${orch_llm_status.api_base}`);
  }

  const app: RuntimeApp = {
    agent,
    bus,
    channels,
    channel_manager,
    cron,
    heartbeat,
    mcp,
    providers,
    agent_backends: agent_backend_registry,
    orchestrator_llm_runtime,
    sessions,
    dashboard: dashboard.current,
    decisions,
    events,
    ops,
    services,
    session_prune_timer,
    cli_auth,
  };

  return app;
}

async function register_mcp_tools(
  workspace: string,
  mcp: McpClientManager,
  agent_runtime: ReturnType<typeof create_agent_runtime>,
  logger: ReturnType<typeof create_logger>,
): Promise<void> {
  const mcp_store = new FileMcpServerStore(workspace);
  const servers = await mcp_store.list_servers();
  for (const [name, entry] of Object.entries(servers)) {
    if (entry.command) {
      mcp.register_server(name, {
        command: entry.command,
        args: entry.args,
        env: entry.env,
        cwd: entry.cwd,
        startup_timeout_ms: (entry.startup_timeout_sec ?? 15) * 1000,
      });
    }
  }
  await mcp.start();
  const adapters = create_mcp_tool_adapters(mcp);
  for (const adapter of adapters) {
    agent_runtime.register_tool(adapter);
  }
  if (adapters.length > 0) {
    logger.info(`mcp tools registered count=${adapters.length}`);
  }
}

/** last_output이 비어있을 때 task 상태에서 유용한 컨텍스트를 조합. */
function build_hitl_fallback_body(task: import("./contracts.js").TaskState): string {
  const parts: string[] = [];
  const objective = String(task.objective || "").trim();
  if (objective) parts.push(`**작업:** ${objective.slice(0, 300)}`);
  const reason = String(task.exitReason || "").trim();
  if (reason && reason !== "waiting_user_input") parts.push(`**상태:** ${reason}`);
  return parts.join("\n") || "";
}

/** WORKSPACE/workflows/ 가 비어있으면 빌트인 기본 템플릿을 시드. */
function seed_default_workflows(workspace: string, app_root: string): void {
  const target_dir = join(workspace, "workflows");
  mkdirSync(target_dir, { recursive: true });

  const existing = readdirSync(target_dir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  if (existing.length > 0) return;

  // production: Dockerfile COPY → default-workflows/
  // dev: 볼륨 마운트 → workspace/workflows/ (소스 직접 참조)
  const candidates = [
    join(app_root, "default-workflows"),
    join(app_root, "workspace", "workflows"),
  ];
  const source_dir = candidates.find((d) => existsSync(d));
  if (!source_dir) return;

  const templates = readdirSync(source_dir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  for (const file of templates) {
    copyFileSync(join(source_dir, file), join(target_dir, file));
  }
}

function resolve_workspace(): string {
  if (process.env.WORKSPACE) return resolve(process.env.WORKSPACE);
  const src_dir = fileURLToPath(new URL(".", import.meta.url));
  return join(resolve(src_dir, ".."), "workspace");
}

/** dist/main.js → 프로젝트 루트. Docker에서 workspace와 앱 루트가 다를 때 builtin skill 탐색에 사용. */
function resolve_app_root(): string {
  const src_dir = fileURLToPath(new URL(".", import.meta.url));
  return resolve(src_dir, "..");
}

function is_main_entry(): boolean {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  const entry = resolve(argv1).toLowerCase();
  const current = resolve(fileURLToPath(import.meta.url)).toLowerCase();
  return entry === current;
}

if (is_main_entry()) {
  void (async () => {
    const boot_logger = create_logger("boot");
    const workspace = resolve_workspace();
    boot_logger.info(`workspace=${workspace}`);
    const skip_lock = process.env.SKIP_INSTANCE_LOCK === "1";
    const lock = skip_lock ? null : await acquire_runtime_instance_lock({ workspace, retries: 25, retry_ms: 200 });
    if (lock && !lock.acquired) {
      boot_logger.error(`another instance is active holder_pid=${lock.holder_pid || "unknown"} lock=${lock.lock_path}`);
      process.exit(1);
    }

    const app = await createRuntime();
    const release_lock = async (): Promise<void> => {
      await lock?.release().catch(() => undefined);
    };
    const SHUTDOWN_TIMEOUT_MS = 5_000;
    let shutting_down = false;
    const on_signal = (sig: string) => {
      if (shutting_down) return;
      shutting_down = true;
      boot_logger.info(`graceful shutdown start signal=${sig}`);
      clearInterval(app.session_prune_timer);
      const force_exit = setTimeout(() => {
        boot_logger.warn("shutdown timeout — forcing exit");
        process.exit(1);
      }, SHUTDOWN_TIMEOUT_MS);
      force_exit.unref();
      void app.services.stop()
        .then(() => app.agent_backends.close())
        .then(() => app.bus.close())
        .then(() => { if ("close" in app.sessions) (app.sessions as { close(): void }).close(); })
        .catch((err: unknown) => { boot_logger.error(`shutdown error: ${error_message(err)}`); })
        .finally(() => {
          clearTimeout(force_exit);
          void release_lock().finally(() => {
            boot_logger.info("graceful shutdown done");
            process.exit(0);
          });
        });
    };
    process.on("SIGINT", () => on_signal("SIGINT"));
    process.on("SIGTERM", () => on_signal("SIGTERM"));
  })().catch((error) => {
    const detail = error_message(error);
    create_logger("boot").error(`bootstrap failed: ${detail}`);
    process.exit(1);
  });
}
