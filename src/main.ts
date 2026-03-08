import { error_message } from "./utils/common.js";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { seed_default_workflows } from "./bootstrap/runtime-paths.js";
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
import { AgentDomain } from "./agent/index.js";
import type { MessageBusRuntime } from "./bus/index.js";
import { ChannelManager, type ChannelRegistryLike } from "./channels/index.js";
import { CronService } from "./cron/index.js";
import { DashboardService } from "./dashboard/service.js";
import { MutableBroadcaster } from "./dashboard/broadcaster.js";
import { DecisionService } from "./decision/index.js";
import { WorkflowEventService } from "./events/index.js";
import { HeartbeatService } from "./heartbeat/index.js";
import { create_logger } from "./logger.js";
import { OpsRuntimeService } from "./ops/index.js";
import { OrchestratorLlmRuntime, ProviderRegistry } from "./providers/index.js";
import { acquire_runtime_instance_lock } from "./runtime/instance-lock.js";
import { ServiceManager } from "./runtime/service-manager.js";
import { type SessionStoreLike } from "./session/index.js";
import { McpClientManager } from "./mcp/index.js";
import { AgentBackendRegistry } from "./agent/agent-registry.js";
import { CliAuthService } from "./agent/cli-auth.service.js";
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

  // 기본 워크플로우 템플릿 시드 (WORKSPACE/workflows/ 가 비어있으면 default-workflows/ 에서 복사)
  seed_default_workflows(workspace, app_root);

  const { shared_vault, config_store, app_config } = await create_config_bundle(workspace);

  const logger = create_logger("runtime");

  const {
    data_dir, sessions_dir, bus, decisions, events,
    provider_store, oauth_store, oauth_flow,
    embed_service, vector_store_service, webhook_store, query_db_service,
  } = await create_runtime_data({ workspace, app_config, shared_vault, logger });

  const {
    providers, cli_auth, mcp, agent_backend_registry, agent_backends,
    agent_session_store, provider_caps, resolve_instance_to_type,
  } = await create_provider_bundle({
    workspace, data_dir, app_config, shared_vault, provider_store, logger,
  });

  const broadcaster = new MutableBroadcaster();

  const {
    agent, agent_runtime, agent_inspector,
    persona_renderer, tone_pref_store,
    phase_workflow_store, kanban_store, kanban_tool, kanban_automation,
    tool_index, reference_store, sessions, memory_consolidation,
  } = await create_agent_core({
    workspace, data_dir, sessions_dir, app_root, app_config,
    providers, bus, events, agent_backend_registry, provider_caps,
    embed_service, oauth_store, oauth_flow, broadcaster, logger,
  });

  const {
    instance_store, channels, primary_provider, default_chat_id,
    dlq_store, dispatch, session_recorder, media_collector, approval,
    active_run_controller, render_profile_store,
    process_tracker, confirmation_guard, hitl_pending_store,
  } = await create_channel_bundle({
    workspace, data_dir, app_config, shared_vault,
    bus, broadcaster, agent, agent_runtime, sessions, logger,
  });
  const dashboard: { current: DashboardService | null } = { current: null };

  const { orchestration, cron, create_task_fn, oauth_fetch_service } = await create_orchestration_bundle({
    workspace, data_dir, app_config,
    providers, agent, agent_runtime, agent_backend_registry, provider_caps,
    bus, events, decisions, process_tracker, mcp,
    phase_workflow_store, broadcaster, confirmation_guard,
    oauth_store, oauth_flow,
    embed_service, vector_store_service, webhook_store, kanban_store, query_db_service,
    persona_renderer, hitl_pending_store, tool_index,
    resolve_instance_to_type, primary_provider, default_chat_id, logger,
  });

  const { command_router, channel_manager } = create_channel_wiring({
    workspace, app_config, agent, agent_runtime, agent_backend_registry,
    bus, broadcaster, channels, instance_store,
    dispatch, session_recorder, media_collector, approval,
    active_run_controller, render_profile_store,
    process_tracker, confirmation_guard, orchestration,
    providers, mcp, cron, decisions, sessions,
    persona_renderer, tone_pref_store, memory_consolidation, logger,
  });

  const { orchestrator_llm_runtime, services, heartbeat, ops } = create_runtime_support({
    workspace, app_config, provider_store,
    agent, agent_runtime, bus, channel_manager,
    cron, decisions, providers, sessions, dlq_store,
    primary_provider, default_chat_id, logger,
  });

  // WorkflowOps는 대시보드 + WorkflowTool 양쪽에서 사용
  const { workflow_ops: workflow_ops_result } = await create_workflow_ops_bundle({
    workspace, agent, agent_runtime: agent_runtime, bus, providers, provider_store, decisions,
    phase_workflow_store, kanban_store, kanban_tool, kanban_automation,
    hitl_pending_store, persona_renderer, broadcaster, channel_manager,
    embed_service, vector_store_service, webhook_store, query_db_service,
    oauth_fetch_service, create_task_fn, logger, tool_index,
  });

  await register_late_commands({ command_router, workflow_ops_result, orchestrator_llm_runtime });

  const { dashboard: dashboard_instance, agent_provider_ops: agent_provider_ops_result } = create_dashboard_bundle({
    workspace, app_config, config_store,
    agent, agent_runtime, agent_inspector, agent_backend_registry, provider_store, providers,
    bus, broadcaster, channel_manager, channels, instance_store,
    cli_auth, decisions, events, heartbeat, mcp, ops,
    orchestrator_llm_runtime, orchestration, process_tracker, cron,
    sessions, dlq_store, dispatch, oauth_store, oauth_flow,
    kanban_store, kanban_automation, reference_store, webhook_store,
    workflow_ops_result,
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

  await run_trigger_sync({
    workspace, app_config, bus, orchestration, cron,
    webhook_store, kanban_store, primary_provider, default_chat_id, logger,
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
