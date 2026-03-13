import { error_message } from "./utils/common.js";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { seed_default_workflows } from "./bootstrap/runtime-paths.js";
import { migrate_to_global_scope } from "./bootstrap/scope-migration.js";
import { create_config_bundle } from "./bootstrap/config.js";
import { create_provider_bundle } from "./bootstrap/providers.js";
import { create_agent_core } from "./bootstrap/agent-core.js";
import { create_channel_bundle } from "./bootstrap/channels.js";
import { create_orchestration_bundle } from "./bootstrap/orchestration.js";
import { create_workflow_ops_bundle } from "./bootstrap/workflow-ops.js";
import { create_dashboard_bundle } from "./bootstrap/dashboard.js";
import { register_runtime_tools, register_mcp_tools } from "./bootstrap/runtime-tools.js";
import { run_trigger_sync } from "./bootstrap/trigger-sync.js";
import { register_late_commands, register_services, start_progress_relay, run_post_boot } from "./bootstrap/services.js";
import { create_runtime_support } from "./bootstrap/runtime-support.js";
import { create_runtime_data } from "./bootstrap/runtime-data.js";
import { create_channel_wiring } from "./bootstrap/channel-wiring.js";
import { register_shutdown_handlers } from "./bootstrap/lifecycle.js";
import { AgentDomain, PollTool, CanvasTool } from "./agent/index.js";
import type { MessageBusRuntime } from "./bus/index.js";
import { ChannelManager, type ChannelRegistryLike } from "./channels/index.js";
import { CronService } from "./cron/index.js";
import { DashboardService } from "./dashboard/service.js";
import { MutableBroadcaster } from "./dashboard/broadcaster.js";
import { DecisionService } from "./decision/index.js";
import { WorkflowEventService } from "./events/index.js";
import { HeartbeatService } from "./heartbeat/index.js";
import { create_logger } from "./logger.js";
import { ExecutionSpanRecorder } from "./observability/span.js";
import { MetricsSink } from "./observability/metrics.js";
import type { ObservabilityLike } from "./observability/context.js";
import { OpsRuntimeService } from "./ops/index.js";
import { OrchestratorLlmRuntime, ProviderRegistry } from "./providers/index.js";
import { acquire_runtime_instance_lock } from "./runtime/instance-lock.js";
import { ServiceManager } from "./runtime/service-manager.js";
import { type SessionStoreLike } from "./session/index.js";
import { McpClientManager } from "./mcp/index.js";
import { AgentBackendRegistry } from "./agent/agent-registry.js";
import { CliAuthService } from "./agent/cli-auth.service.js";
import { UsageStore } from "./gateway/usage-store.js";
import { existsSync } from "node:fs";
import { AdminStore } from "./auth/admin-store.js";
import { AuthService } from "./auth/auth-service.js";
import { WorkspaceRegistry } from "./workspace/registry.js";
import { create_workspace_context, type UserWorkspace } from "./workspace/workspace-context.js";
import { randomUUID } from "node:crypto";

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

export async function createRuntime(): Promise<RuntimeApp> {
  const workspace = resolve_workspace();
  const app_root = resolve_app_root();

  // 부트 identity 해석 → team_id, user_id 추출
  const { team_id, user_id, user_dir } = resolve_boot_identity(workspace);

  // 3-tier 스코프 마이그레이션: user → global, user → team
  const team_dir = team_id ? join(workspace, "tenants", team_id) : undefined;
  migrate_to_global_scope(workspace, user_dir, team_dir);

  // 기본 워크플로우 템플릿 시드 (user_dir/workflows/ 가 비어있으면 default-workflows/ 에서 복사)
  seed_default_workflows(user_dir, app_root);

  const { shared_vault, config_store, app_config } = await create_config_bundle(workspace);

  // 3-tier 워크스페이스 문맥 생성
  const ctx = create_workspace_context({ workspace, team_id, user_id });

  const logger = create_logger("runtime");
  logger.info(`workspace_context team_id=${ctx.team_id} user_id=${ctx.user_id} admin=${ctx.admin_runtime} team=${ctx.team_runtime} user=${ctx.user_runtime}`);

  const {
    data_dir, sessions_dir, bus, decisions, events,
    provider_store, agent_definition_store, oauth_store, oauth_flow,
    embed_service, embed_worker_config, image_embed_service, vector_store_service, webhook_store, query_db_service,
    chunk_queue,
  } = await create_runtime_data({ ctx, app_config, shared_vault, logger });

  const {
    providers, cli_auth, mcp, agent_backend_registry, agent_backends,
    agent_session_store, provider_caps, resolve_instance_to_type,
  } = await create_provider_bundle({
    workspace, user_dir, data_dir, app_config, shared_vault, provider_store, logger,
  });

  const broadcaster = new MutableBroadcaster();

  // OB-5: 공유 observability 인스턴스 — 모든 서비스에 DI로 전달
  const observability: ObservabilityLike = {
    spans: new ExecutionSpanRecorder(),
    metrics: new MetricsSink(),
  };

  const {
    agent, agent_runtime, agent_inspector,
    persona_renderer, tone_pref_store,
    phase_workflow_store, kanban_store, kanban_tool, kanban_automation,
    tool_index, reference_store, sessions, memory_consolidation,
  } = await create_agent_core({
    workspace, user_dir, data_dir, sessions_dir, app_root, app_config,
    providers, bus, events, agent_backend_registry, provider_caps,
    embed_service, embed_worker_config, image_embed_service, oauth_store, oauth_flow, broadcaster, logger,
    chunk_queue,
  });

  const {
    instance_store, channels, primary_provider, default_chat_id,
    dlq_store, dispatch, session_recorder, media_collector, approval,
    active_run_controller, render_profile_store,
    process_tracker, confirmation_guard, hitl_pending_store,
  } = await create_channel_bundle({
    ctx, workspace, user_dir, data_dir, app_config, shared_vault,
    bus, broadcaster, agent, agent_runtime, sessions, logger,
  });
  // channels 생성 후 PollTool 지연 등록 (AgentDomain이 channels보다 먼저 생성되므로)
  agent.tools.register(new PollTool(channels));
  const dashboard: { current: DashboardService | null } = { current: null };
  // CanvasTool 지연 등록 — dashboard.current는 클로저 실행 시점에 평가
  agent.tools.register(new CanvasTool({
    broadcast_callback: (chat_id, spec) => { dashboard.current?.sse.broadcast_canvas(chat_id, spec); },
  }));

  const { orchestration, cron, create_task_fn, oauth_fetch_service } = await create_orchestration_bundle({
    ctx, workspace, user_dir, data_dir, app_config,
    providers, agent, agent_runtime, agent_backend_registry, provider_caps,
    bus, events, decisions, process_tracker, mcp,
    phase_workflow_store, broadcaster, confirmation_guard,
    oauth_store, oauth_flow,
    embed_service, vector_store_service, webhook_store, kanban_store, query_db_service,
    persona_renderer, hitl_pending_store, tool_index,
    resolve_instance_to_type, primary_provider, default_chat_id, logger,
    observability,
  });

  const usage_store = new UsageStore(user_dir);

  // 인증은 항상 활성 — admin.db 부재 시 자동 생성 (미초기화 상태로 시작)
  const admin_db_path = join(workspace, "admin", "admin.db");
  const auth_svc = new AuthService(new AdminStore(admin_db_path));

  // 멀티테넌트: JWT 인증 후 개인 워크스페이스 디렉토리 보장
  const workspace_registry = auth_svc ? new WorkspaceRegistry(workspace) : null;

  const { command_router, channel_manager } = create_channel_wiring({
    workspace, user_dir, app_config, agent, agent_runtime, agent_backend_registry,
    bus, broadcaster, channels, instance_store,
    dispatch, session_recorder, media_collector, approval,
    active_run_controller, render_profile_store,
    process_tracker, confirmation_guard, orchestration,
    providers, mcp, cron, decisions, sessions,
    persona_renderer, tone_pref_store, memory_consolidation, logger,
    usage_store, observability,
  });

  const { orchestrator_llm_runtime, services, heartbeat, ops } = create_runtime_support({
    workspace, user_dir, app_config, provider_store,
    agent, agent_runtime, bus, channel_manager,
    cron, decisions, providers, sessions, dlq_store,
    primary_provider, default_chat_id, logger,
  });

  // WorkflowOps는 대시보드 + WorkflowTool 양쪽에서 사용
  const trigger_sync_args = { workspace, user_dir, app_config, bus, orchestration, cron, webhook_store, kanban_store, primary_provider, default_chat_id, logger };
  const { workflow_ops: workflow_ops_result } = await create_workflow_ops_bundle({
    workspace, user_dir, agent, agent_runtime: agent_runtime, bus, providers, provider_store, decisions,
    phase_workflow_store, kanban_store, kanban_tool, kanban_automation,
    hitl_pending_store, persona_renderer, broadcaster, channel_manager,
    embed_service, vector_store_service, webhook_store, query_db_service,
    oauth_fetch_service, create_task_fn, logger, tool_index, cron,
    on_template_changed: () => run_trigger_sync(trigger_sync_args),
  });

  await register_late_commands({ command_router, workflow_ops_result, orchestrator_llm_runtime });

  const { dashboard: dashboard_instance, agent_provider_ops: agent_provider_ops_result } = create_dashboard_bundle({
    workspace, user_dir, app_config, config_store,
    agent, agent_runtime, agent_inspector, agent_backend_registry, provider_store, providers,
    bus, broadcaster, channel_manager, channels, instance_store,
    cli_auth, decisions, events, heartbeat, mcp, ops,
    orchestrator_llm_runtime, orchestration, process_tracker, cron,
    sessions, dlq_store, dispatch, oauth_store, oauth_flow,
    kanban_store, kanban_automation, reference_store, webhook_store,
    agent_definition_store, workflow_ops_result, usage_store,
    auth_svc, workspace_registry, observability,
  });
  dashboard.current = dashboard_instance;

  start_progress_relay(bus, broadcaster, logger);

  register_runtime_tools({
    workspace, agent, agent_runtime, providers, cron, decisions,
    oauth_store, oauth_flow, mcp, kanban_tool,
    workflow_ops_result, agent_provider_ops_result, logger,
  });

  register_services({
    app_config, agent, dispatch, channel_manager, cron,
    heartbeat, ops, dashboard: dashboard.current, mcp,
    orchestrator_llm_runtime, memory_consolidation, services,
  });

  await register_mcp_tools(workspace, mcp, agent_runtime, logger).catch((err) => {
    logger.error(`mcp tool registration failed: ${error_message(err)}`);
  });

  const session_id = randomUUID();
  agent.loop.set_session_id(session_id);
  logger.info(`session_id=${session_id}`);

  await services.start();

  await run_trigger_sync(trigger_sync_args);

  // 서버 재시작 후 고아 상태(running)인 워크플로우 자동 재개
  workflow_ops_result.resume_orphaned().catch((err) => {
    logger.error(`orphan_workflow_resume_failed: ${error_message(err)}`);
  });

  const { session_prune_timer } = run_post_boot({
    instance_store, primary_provider,
    agent_session_store, agent_backends, cli_auth,
    dashboard: dashboard.current, orchestrator_llm_runtime, logger,
  });

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


function resolve_workspace(): string {
  if (process.env.WORKSPACE) return resolve(process.env.WORKSPACE);
  const src_dir = fileURLToPath(new URL(".", import.meta.url));
  return join(resolve(src_dir, ".."), "workspace");
}

/** 부트 시 워크스페이스 identity 해석 — team_id, user_id, user_dir 반환. */
function resolve_boot_identity(workspace: string): { team_id: string; user_id: string; user_dir: string } {
  const admin_db = join(workspace, "admin", "admin.db");
  if (existsSync(admin_db)) {
    const superadmin = new AdminStore(admin_db).list_users()
      .find((u) => u.system_role === "superadmin" && u.default_team_id);
    if (superadmin) {
      return {
        team_id: superadmin.default_team_id!,
        user_id: superadmin.id,
        user_dir: join(workspace, "tenants", superadmin.default_team_id!, "users", superadmin.id),
      };
    }
    // auth 활성이지만 팀 미배정 → 루트 오염 방지
    return { team_id: "", user_id: "", user_dir: join(workspace, "_shared") };
  }
  return { team_id: "", user_id: "", user_dir: workspace };
}

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
    register_shutdown_handlers(app, boot_logger, release_lock);
  })().catch((error) => {
    const detail = error_message(error);
    create_logger("boot").error(`bootstrap failed: ${detail}`);
    process.exit(1);
  });
}
