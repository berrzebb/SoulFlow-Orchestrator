/** Channel wiring bundle: command router + task resume + bot identity + ChannelManager 조립. */

import type { AppConfig } from "../config/schema.js";
import type { AgentDomain } from "../agent/index.js";
import type { create_agent_runtime } from "../agent/runtime.service.js";
import type { AgentBackendRegistry } from "../agent/agent-registry.js";
import type { MemoryConsolidationService } from "../agent/memory-consolidation.service.js";
import type { MessageBusRuntime } from "../bus/types.js";
import type {
  ChannelInstanceStore, ChannelRegistryLike,
} from "../channels/index.js";
import type { DispatchService } from "../channels/dispatch.service.js";
import type { SessionRecorder } from "../channels/session-recorder.js";
import type { MediaCollector } from "../channels/media-collector.js";
import type { ApprovalService } from "../channels/approval.service.js";
import type { ActiveRunController } from "../channels/active-run-controller.js";
import type { InMemoryRenderProfileStore } from "../channels/commands/render.handler.js";
import type { PersonaMessageRendererLike } from "../channels/persona-message-renderer.js";
import type { TonePreferenceStore } from "../channels/persona-message-renderer.js";
import type { CronService } from "../cron/index.js";
import type { DecisionService } from "../decision/index.js";
import type { McpClientManager } from "../mcp/index.js";
import type { OrchestrationService } from "../orchestration/service.js";
import type { ProcessTracker } from "../orchestration/process-tracker.js";
import type { ConfirmationGuard } from "../orchestration/confirmation-guard.js";
import type { ProviderRegistry } from "../providers/index.js";
import type { SessionStoreLike } from "../session/index.js";
import type { MutableBroadcaster } from "../dashboard/broadcaster.js";
import { create_logger } from "../logger.js";
import { ChannelManager } from "../channels/index.js";
import { create_command_router } from "../channels/create-command-router.js";
import { TaskResumeService } from "../channels/task-resume.service.js";

export interface ChannelWiringDeps {
  workspace: string;
  app_config: AppConfig;
  agent: AgentDomain;
  agent_runtime: ReturnType<typeof create_agent_runtime>;
  agent_backend_registry: AgentBackendRegistry;
  bus: MessageBusRuntime;
  broadcaster: MutableBroadcaster;
  channels: ChannelRegistryLike;
  instance_store: ChannelInstanceStore;
  dispatch: DispatchService;
  session_recorder: SessionRecorder;
  media_collector: MediaCollector;
  approval: ApprovalService;
  active_run_controller: ActiveRunController;
  render_profile_store: InMemoryRenderProfileStore;
  process_tracker: ProcessTracker;
  confirmation_guard: ConfirmationGuard;
  orchestration: OrchestrationService;
  providers: ProviderRegistry;
  mcp: McpClientManager;
  cron: CronService;
  decisions: DecisionService;
  sessions: SessionStoreLike;
  persona_renderer: PersonaMessageRendererLike;
  tone_pref_store: TonePreferenceStore;
  memory_consolidation: MemoryConsolidationService;
  logger: ReturnType<typeof create_logger>;
}

export interface ChannelWiringResult {
  command_router: ReturnType<typeof create_command_router>;
  channel_manager: ChannelManager;
}

export function create_channel_wiring(deps: ChannelWiringDeps): ChannelWiringResult {
  const {
    workspace, app_config, agent, agent_runtime, agent_backend_registry,
    bus, broadcaster, channels, instance_store,
    dispatch, session_recorder, media_collector, approval,
    active_run_controller, render_profile_store,
    process_tracker, confirmation_guard, orchestration,
    providers, mcp, cron, decisions, sessions,
    persona_renderer, tone_pref_store, memory_consolidation, logger,
  } = deps;

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

  return { command_router, channel_manager };
}
