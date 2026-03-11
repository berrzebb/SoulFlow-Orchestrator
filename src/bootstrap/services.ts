/** Services bundle: late-inject commands + service registration + progress relay + post-boot tasks. */

import { error_message } from "../utils/common.js";
import { resilient_loop } from "../utils/resilient-loop.js";
import type { AgentDomain } from "../agent/index.js";
import type { AgentBackend } from "../agent/agent.types.js";
import type { AgentSessionStore } from "../agent/agent-session-store.js";
import type { ChannelManager } from "../channels/manager.js";
import type { ChannelInstanceStore } from "../channels/index.js";
import type { DispatchService } from "../channels/dispatch.service.js";
import type { create_command_router } from "../channels/create-command-router.js";
import type { MessageBusRuntime } from "../bus/types.js";
import type { CronService } from "../cron/index.js";
import type { HeartbeatService } from "../heartbeat/index.js";
import type { McpClientManager } from "../mcp/index.js";
import type { OpsRuntimeService } from "../ops/index.js";
import type { OrchestratorLlmRuntime } from "../providers/index.js";
import type { CliAuthService } from "../agent/cli-auth.service.js";
import type { MemoryConsolidationService } from "../agent/memory-consolidation.service.js";
import type { MutableBroadcaster } from "../dashboard/broadcaster.js";
import type { DashboardService } from "../dashboard/service.js";
import type { ServiceManager } from "../runtime/service-manager.js";
import type { AppConfig } from "../config/schema.js";
import type { create_logger } from "../logger.js";
import { OrchestratorLlmServiceAdapter } from "../providers/orchestrator-llm-service.adapter.js";

export interface LateCommandsDeps {
  command_router: ReturnType<typeof create_command_router>;
  workflow_ops_result: {
    list(): Promise<Array<{ workflow_id: string; title?: string; status: string; created_at?: string; current_phase?: number }>>;
    get(id: string): Promise<{ workflow_id: string; title?: string; status: string; created_at?: string; current_phase?: number } | null>;
    create(input: Record<string, unknown>): Promise<{ ok: boolean; workflow_id?: string; error?: string }>;
    cancel(id: string): Promise<boolean>;
    list_templates(): Array<{ title: string; slug: string }>;
  };
  orchestrator_llm_runtime: OrchestratorLlmRuntime;
}

/** /workflow, /model 커맨드 late-inject. */
export async function register_late_commands(deps: LateCommandsDeps): Promise<void> {
  const { command_router, workflow_ops_result, orchestrator_llm_runtime } = deps;

  const { WorkflowHandler, ModelHandler } = await import("../channels/commands/index.js");
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
}

export interface ServiceRegistrationDeps {
  app_config: AppConfig;
  agent: AgentDomain;
  dispatch: DispatchService;
  channel_manager: ChannelManager;
  cron: CronService;
  heartbeat: HeartbeatService;
  ops: OpsRuntimeService;
  dashboard: DashboardService | null;
  mcp: McpClientManager;
  orchestrator_llm_runtime: OrchestratorLlmRuntime;
  memory_consolidation: MemoryConsolidationService;
  services: ServiceManager;
}

/** ServiceManager에 모든 서비스 등록. */
export function register_services(deps: ServiceRegistrationDeps): void {
  const {
    app_config, agent, dispatch, channel_manager, cron,
    heartbeat, ops, dashboard, mcp, orchestrator_llm_runtime,
    memory_consolidation, services,
  } = deps;

  services.register(agent, { required: true });
  services.register(dispatch, { required: true });
  services.register(channel_manager, { required: true });
  services.register(cron, { required: true });
  services.register(heartbeat, { required: false });
  services.register(ops, { required: false });
  if (dashboard) services.register(dashboard, { required: false });
  services.register(mcp, { required: false });
  services.register(new OrchestratorLlmServiceAdapter(orchestrator_llm_runtime), { required: false });
  if (app_config.memory.consolidation.enabled) services.register(memory_consolidation, { required: false });
}

/** progress relay: bus → broadcaster SSE 릴레이 시작. 크래시 시 지수 백오프 재시작. */
export function start_progress_relay(
  bus: MessageBusRuntime,
  broadcaster: MutableBroadcaster,
  logger: ReturnType<typeof create_logger>,
): void {
  resilient_loop(
    async () => {
      while (!bus.is_closed()) {
        const event = await bus.consume_progress({ timeout_ms: 5000 });
        if (event) broadcaster.broadcast_progress_event(event);
      }
    },
    {
      name: "progress_relay",
      should_run: () => !bus.is_closed(),
      on_error: (e) => logger.error("[progress_relay] crashed, restarting:", { error: error_message(e) }),
    },
  );
}

export interface PostBootDeps {
  instance_store: ChannelInstanceStore;
  primary_provider: string;
  agent_session_store: AgentSessionStore;
  agent_backends: AgentBackend[];
  cli_auth: CliAuthService;
  dashboard: DashboardService | null;
  orchestrator_llm_runtime: OrchestratorLlmRuntime;
  logger: ReturnType<typeof create_logger>;
}

export interface PostBootResult {
  session_prune_timer: ReturnType<typeof setInterval>;
}

/** 서비스 시작 후 비차단 작업: 채널 로그, 세션 정리, CLI 인증, 상태 로그. */
export function run_post_boot(deps: PostBootDeps): PostBootResult {
  const {
    instance_store, primary_provider,
    agent_session_store, agent_backends, cli_auth,
    dashboard, orchestrator_llm_runtime, logger,
  } = deps;

  const enabled_channels = instance_store.list().filter((c) => c.enabled).map((c) => c.provider);
  logger.info(`channels=${enabled_channels.join(",")} primary=${primary_provider}`);

  // 만료된 에이전트 세션 정리: 시작 시 즉시 + 1시간 간격
  try { agent_session_store.prune_expired(); } catch { /* noop */ }
  const session_prune_timer = setInterval(() => {
    try { agent_session_store.prune_expired(); } catch { /* noop */ }
  }, 60 * 60 * 1000);
  session_prune_timer.unref();

  // CLI 인증 상태 비차단 확인
  cli_auth.check_all().then((statuses) => {
    for (const s of statuses) {
      logger.info(`cli-auth ${s.cli} authenticated=${s.authenticated}${s.account ? ` account=${s.account}` : ""}`);
    }
    for (const backend of agent_backends) {
      if ("check_auth" in backend && typeof (backend as { check_auth: () => Promise<boolean> }).check_auth === "function") {
        void (backend as { check_auth: () => Promise<boolean> }).check_auth();
      }
    }
  }).catch((err) => {
    logger.warn(`cli-auth check failed: ${error_message(err)}`);
  });

  if (dashboard) logger.info(`dashboard ${dashboard.get_url()}`);
  const orch_llm_status = orchestrator_llm_runtime.get_status();
  if (orch_llm_status.enabled) {
    logger.info(`orchestrator-llm running=${orch_llm_status.running} engine=${orch_llm_status.engine || "n/a"} base=${orch_llm_status.api_base}`);
  }

  return { session_prune_timer };
}
