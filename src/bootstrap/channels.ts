/** Channel infrastructure bundle: 인스턴스 스토어, 디스패치, 세션 레코더, 미디어, 승인, 프로세스 트래커. */

import { join } from "node:path";
import type { AppConfig } from "../config/schema.js";
import type { SecretVaultLike } from "../security/secret-vault.js";
import type { MessageBusRuntime } from "../bus/types.js";
import type { MutableBroadcaster } from "../dashboard/broadcaster.js";
import type { AgentDomain } from "../agent/index.js";
import type { create_agent_runtime } from "../agent/runtime.service.js";
import type { SessionStore } from "../session/index.js";
import {
  ChannelInstanceStore,
  SqliteDispatchDlqStore,
  create_channels_from_store,
  type ChannelRegistryLike,
} from "../channels/index.js";
import { ActiveRunController } from "../channels/active-run-controller.js";
import { InMemoryRenderProfileStore } from "../channels/commands/render.handler.js";
import { ApprovalService } from "../channels/approval.service.js";
import { DispatchService } from "../channels/dispatch.service.js";
import { MediaCollector } from "../channels/media-collector.js";
import { DefaultOutboundDedupePolicy } from "../channels/outbound-dedupe.js";
import { sanitize_provider_output } from "../channels/output-sanitizer.js";
import { SessionRecorder } from "../channels/session-recorder.js";
import { ProcessTracker } from "../orchestration/process-tracker.js";
import { ConfirmationGuard } from "../orchestration/confirmation-guard.js";
import { HitlPendingStore } from "../orchestration/hitl-pending-store.js";
import { resolve_reply_to } from "../channels/types.js";
import type { TeamWorkspace } from "../workspace/workspace-context.js";
import { create_logger } from "../logger.js";

export interface ChannelBundleDeps {
  ctx: TeamWorkspace;
  workspace: string;
  /** 개인 콘텐츠 루트 (미디어 다운로드, 채널 workspace_dir). */
  user_dir: string;
  data_dir: string;
  app_config: AppConfig;
  shared_vault: SecretVaultLike;
  bus: MessageBusRuntime;
  broadcaster: MutableBroadcaster;
  agent: AgentDomain;
  agent_runtime: ReturnType<typeof create_agent_runtime>;
  sessions: SessionStore;
  logger: ReturnType<typeof create_logger>;
}

export interface ChannelBundleResult {
  instance_store: ChannelInstanceStore;
  channels: ChannelRegistryLike;
  primary_provider: string;
  default_chat_id: string;
  dlq_store: InstanceType<typeof SqliteDispatchDlqStore> | null;
  dispatch: DispatchService;
  session_recorder: SessionRecorder;
  media_collector: MediaCollector;
  approval: ApprovalService;
  active_run_controller: ActiveRunController;
  render_profile_store: InMemoryRenderProfileStore;
  process_tracker: ProcessTracker;
  confirmation_guard: ConfirmationGuard;
  hitl_pending_store: HitlPendingStore;
}

export async function create_channel_bundle(deps: ChannelBundleDeps): Promise<ChannelBundleResult> {
  const {
    ctx, workspace: _workspace, user_dir, data_dir: _data_dir, app_config, shared_vault,
    bus, broadcaster, agent, agent_runtime, sessions, logger,
  } = deps;

  // 팀 스코프: 채널 인스턴스는 팀 멤버 간 공유
  const instance_store = new ChannelInstanceStore(join(ctx.team_runtime, "channels", "instances.db"), shared_vault);
  const channels = await create_channels_from_store(instance_store, user_dir);

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

  // 팀 스코프: DLQ도 팀 단위
  const dlq_store = app_config.channel.dispatch.dlqEnabled
    ? new SqliteDispatchDlqStore(join(ctx.team_runtime, "dlq", "dlq.db"))
    : null;
  const dispatch = new DispatchService({
    bus,
    registry: channels,
    retry_config: app_config.channel.dispatch,
    dedupe_config: app_config.channel.outboundDedupe,
    grouping_config: app_config.channel.grouping,
    dlq_store,
    dedupe_policy: new DefaultOutboundDedupePolicy(),
    logger: logger.child("dispatch"),
    on_direct_send: (msg) => broadcaster.broadcast_message_event("outbound", msg.sender_id, msg.content, msg.chat_id, ctx.team_id),
  });

  const session_recorder = new SessionRecorder({
    sessions,
    daily_memory: agent_runtime,
    sanitize_for_storage: sanitize_provider_output,
    logger: logger.child("session"),
    on_mirror_message: (event) => broadcaster.broadcast_mirror_message(event, ctx.team_id),
  });

  const slack_token = await instance_store.get_token("slack") || "";
  const telegram_token = await instance_store.get_token("telegram") || "";
  const telegram_settings = (instance_store.get("telegram")?.settings as Record<string, unknown>) || {};
  const media_collector = new MediaCollector({
    workspace_dir: user_dir,
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

  return {
    instance_store, channels, primary_provider, default_chat_id,
    dlq_store, dispatch, session_recorder, media_collector, approval,
    active_run_controller, render_profile_store,
    process_tracker, confirmation_guard, hitl_pending_store,
  };
}
