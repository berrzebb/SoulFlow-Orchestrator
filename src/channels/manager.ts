import type { InboundMessage, MediaItem, MessageBusLike, ReliableMessageBus } from "../bus/types.js";
import { resolve_provider, resolve_reply_to, type ChannelProvider, type ChannelRegistryLike } from "./types.js";
import type { ProviderRegistry } from "../providers/service.js";
import type { ServiceLike } from "../runtime/service.types.js";
import type { AppConfig } from "../config/schema.js";
import type { Logger } from "../logger.js";
import type { CommandRouter } from "./commands/router.js";
import { format_mention, type CommandContext } from "./commands/types.js";
import type { DispatchService } from "./dispatch.service.js";
import type { ApprovalService } from "./approval.service.js";
import { extract_reaction_names, is_control_stop_reaction } from "./approval.service.js";
import type { TaskResumeService } from "./task-resume.service.js";
import type { SessionRecorder } from "./session-recorder.js";
import type { MediaCollector } from "./media-collector.js";
import type { OrchestrationService } from "../orchestration/service.js";
import type { OrchestrationResult } from "../orchestration/types.js";
import type { ProcessTrackerLike } from "../orchestration/process-tracker.js";
import type { ActiveRunControllerLike, ActiveRun } from "./active-run-controller.js";
import { ActiveRunController } from "./active-run-controller.js";
import type { RenderProfileStore } from "./commands/render.handler.js";
import { InMemoryRenderProfileStore } from "./commands/render.handler.js";
import { get_command_descriptors } from "./commands/registry.js";
import { parse_slash_command_from_message, parse_slash_command } from "./slash-command.js";
import {
  render_agent_output,
  split_markdown,
  get_provider_max_length,
  type RenderProfile,
  type RenderMode,
} from "./rendering.js";
import { sanitize_provider_output, strip_secret_reference_tokens, RE_PROVIDER_ERROR } from "./output-sanitizer.js";
import { parse_tone_override, type PersonaMessageIntent, type PersonaMessageRendererLike, type PersonaStyleSnapshot } from "./persona-message-renderer.js";
import { extract_media_items } from "./media-extractor.js";
import { prune_ttl_map, sleep, error_message, now_iso, normalize_text } from "../utils/common.js";
import { t } from "../i18n/index.js";
import { LaneQueue } from "../agent/pty/lane-queue.js";
import { InboundDebouncer } from "./inbound-debouncer.js";
import { agent_event_to_stream } from "./stream-event.js";
import type { ThreadOwnership } from "./thread-ownership.js";
import { create_channel_renderer, type ChannelRendererLike } from "./channel-renderer.js";

/** renderer가 없을 때 사용되는 폴백 메시지. */
const FALLBACK_MESSAGES: Record<string, string> = {
  identity: "무엇을 도와드릴까요?",
  safe_fallback: "다시 한 번 말씀해주시면 바로 이어가겠습니다.",
  error: "처리 중 문제가 발생했습니다.",
  status_started: "분석 중입니다.",
  status_progress: "",
  status_completed: "✓ 완료",
  workflow_resume: "이어서 진행하겠습니다.",
  approval_resumed: "승인이 확인되었습니다. 이어서 진행하겠습니다.",
  approval_resume_failed: "승인 처리 중 문제가 발생했습니다.",
  expired_task: "이전 작업이 만료되었습니다.",
  guard_cancelled: "작업이 취소되었습니다.",
  inquiry_summary: "",
};

export type ChannelManagerStatus = {
  enabled_channels: string[];
  mention_loop_running: boolean;
};

/** 워크플로우 HITL 브리지: 채널 응답 → 워크플로우 pending response. */
export type WorkflowHitlBridge = {
  /** chat_id로 활성 워크플로우 HITL 응답을 시도. 성공 시 true. */
  try_resolve(chat_id: string, content: string): Promise<boolean>;
};

/** 봇 self ID와 기본 채널/chat_id를 제공하는 인터페이스. */
export type BotIdentitySource = {
  get_bot_self_id(provider: string): string;
  get_default_target(provider: string): string;
};

export type ChannelManagerDeps = {
  bus: MessageBusLike;
  registry: ChannelRegistryLike;
  dispatch: DispatchService;
  command_router: CommandRouter;
  orchestration: OrchestrationService;
  approval: ApprovalService;
  task_resume: TaskResumeService;
  session_recorder: SessionRecorder;
  session_store?: import("../session/service.js").SessionStoreLike | null;
  media_collector: MediaCollector;
  process_tracker: ProcessTrackerLike | null;
  providers: ProviderRegistry | null;
  config: AppConfig["channel"];
  workspace_dir: string;
  logger: Logger;
  bot_identity: BotIdentitySource;
  /** AgentEvent를 대시보드 SSE로 릴레이할 콜백. */
  on_agent_event?: ((event: import("../agent/agent.types.js").AgentEvent) => void) | null;
  /** 웹 채팅 스트리밍 텍스트 릴레이 콜백 (chat_id, content, done). */
  on_web_stream?: ((chat_id: string, content: string, done: boolean) => void) | null;
  /** 웹 채널 실행 중 StreamEvent를 세션별 NDJSON 스트림으로 라우팅. */
  on_web_rich_event?: ((chat_id: string, event: import("./stream-event.js").StreamEvent) => void) | null;
  /** 워크플로우 HITL: 채널 응답을 워크플로우 pending_response로 라우팅. */
  workflow_hitl?: WorkflowHitlBridge | null;
  /** 실행 전 확인 가드. */
  confirmation_guard?: import("../orchestration/confirmation-guard.js").ConfirmationGuard | null;
  /** 메모리 압축: turn 시작/종료 콜백. 둘 다 제공해야 long-turn 보호 동작. */
  on_activity_start?: (() => void) | null;
  on_activity_end?: (() => void) | null;
  /** 페르소나 톤·매너를 반영한 메시지 렌더러. */
  renderer?: PersonaMessageRendererLike | null;
  /** 실행 중인 에이전트 런 관리. 미지정 시 내부 생성. */
  active_run_controller?: import("./active-run-controller.js").ActiveRunControllerLike;
  /** 채널별 렌더 프로필 관리. 미지정 시 내부 생성. */
  render_profile_store?: import("./commands/render.handler.js").RenderProfileStore;
  /** 스레드 소유권 관리. 미지정 시 소유권 검사 비활성. */
  thread_ownership?: ThreadOwnership | null;
};

// ActiveRun 타입은 active-run-controller.ts에서 import

/**
 * 인바운드 수신 → 위임 체인(approval → command → orchestration) → 아웃바운드 전송.
 * 실질적인 비즈니스 로직은 주입된 서비스에 위임하고, 이 클래스는 조립만 담당.
 */
export class ChannelManager implements ServiceLike {
  readonly name = "channel-manager";

  private readonly bus: MessageBusLike;
  private readonly registry: ChannelRegistryLike;
  private readonly dispatch: DispatchService;
  private readonly commands: CommandRouter;
  private readonly orchestration: OrchestrationService;
  private readonly approval: ApprovalService;
  private readonly task_resume: TaskResumeService;
  private readonly recorder: SessionRecorder;
  private readonly media: MediaCollector;
  private readonly tracker: ProcessTrackerLike | null;
  private readonly providers: ProviderRegistry | null;
  private readonly config: AppConfig["channel"];
  private readonly workspace_dir: string;
  private readonly logger: Logger;
  private readonly on_agent_event: ((event: import("../agent/agent.types.js").AgentEvent) => void) | null;
  private readonly on_web_stream: ((chat_id: string, content: string, done: boolean) => void) | null;
  private readonly on_web_rich_event: ((chat_id: string, event: import("./stream-event.js").StreamEvent) => void) | null;
  private readonly session_store: import("../session/service.js").SessionStoreLike | null;
  private readonly bot_identity: BotIdentitySource;
  private workflow_hitl: WorkflowHitlBridge | null;
  private readonly confirmation_guard: import("../orchestration/confirmation-guard.js").ConfirmationGuard | null;
  private readonly on_activity_start: (() => void) | null;
  private readonly on_activity_end: (() => void) | null;
  private readonly renderer: PersonaMessageRendererLike | null;
  private readonly thread_ownership: ThreadOwnership | null;

  private _bot_ids_cache: Record<string, string> | null = null;
  private _bot_ids_cache_at = 0;

  private running = false;
  private abort_ctl = new AbortController();
  private poll_task: Promise<void> | null = null;
  private consumer_task: Promise<void> | null = null;
  private readonly seen = new Map<string, number>();
  private readonly primed_targets = new Map<string, number>();
  private readonly active_runs: ActiveRunControllerLike;
  private readonly mention_cooldowns = new Map<string, number>();
  private readonly control_reaction_seen = new Map<string, number>();
  private readonly render_store: RenderProfileStore;
  private readonly render_profile_ts = new Map<string, number>();
  private readonly tone_overrides = new Map<string, Partial<PersonaStyleSnapshot>>();
  private readonly inbound_inflight = new Set<Promise<void>>();
  private readonly inbound_lanes: LaneQueue;
  private readonly inbound_debouncer: InboundDebouncer<InboundMessage>;
  /** run_key → 시작 시각(ms). staleRunTimeoutMs 초과 감지용. */
  private readonly run_start_times = new Map<string, number>();
  private prune_timer: NodeJS.Timeout | null = null;
  private lane_prune_timer: NodeJS.Timeout | null = null;
  private stale_run_timer: NodeJS.Timeout | null = null;

  constructor(deps: ChannelManagerDeps) {
    this.bus = deps.bus;
    this.registry = deps.registry;
    this.dispatch = deps.dispatch;
    this.commands = deps.command_router;
    this.orchestration = deps.orchestration;
    this.approval = deps.approval;
    this.task_resume = deps.task_resume;
    this.recorder = deps.session_recorder;
    this.media = deps.media_collector;
    this.tracker = deps.process_tracker;
    this.providers = deps.providers;
    this.config = deps.config;
    this.workspace_dir = deps.workspace_dir;
    this.logger = deps.logger;
    this.on_agent_event = deps.on_agent_event || null;
    this.on_web_stream = deps.on_web_stream || null;
    this.on_web_rich_event = deps.on_web_rich_event || null;
    this.session_store = deps.session_store ?? null;
    this.bot_identity = deps.bot_identity;
    this.workflow_hitl = deps.workflow_hitl ?? null;
    this.confirmation_guard = deps.confirmation_guard ?? null;
    this.on_activity_start = deps.on_activity_start ?? null;
    this.on_activity_end = deps.on_activity_end ?? null;
    this.renderer = deps.renderer ?? null;
    this.thread_ownership = deps.thread_ownership ?? null;
    this.active_runs = deps.active_run_controller ?? new ActiveRunController();
    this.render_store = deps.render_profile_store ?? new InMemoryRenderProfileStore();
    this.inbound_lanes = new LaneQueue({
      global_concurrency: deps.config.inboundConcurrency,
      lane_max_pending: deps.config.queueCapPerLane,
      lane_drop: deps.config.queueDropPolicy,
    });
    this.inbound_debouncer = new InboundDebouncer({
      window_ms: deps.config.inboundDebounce.windowMs,
      max_messages: deps.config.inboundDebounce.maxMessages,
    });
    this.inbound_debouncer.set_handler((chat_key, items) => {
      const combined = InboundDebouncer.merge(items);
      const task = this.inbound_lanes.execute(chat_key, () => this.handle_inbound_message(combined))
        .catch((e) => {
          if (error_message(e) !== "queue_cap_exceeded") {
            this.logger.error("inbound debounced handler failed", { error: error_message(e) });
          }
        })
        .finally(() => this.inbound_inflight.delete(task));
      this.inbound_inflight.add(task);
    });
  }

  /** 워크플로우 HITL 브리지를 지연 주입 (순환 의존성 회피). */
  set_workflow_hitl(bridge: WorkflowHitlBridge): void {
    this.workflow_hitl = bridge;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.registry.start_all();
    await this.sync_commands_to_channels();
    this.poll_task = this.run_poll_loop();
    this.consumer_task = this.run_inbound_consumer();
    this.prune_timer = setInterval(() => this.prune_seen(), 60_000);
    if (this.config.sessionLanePruneIntervalMs > 0) {
      this.lane_prune_timer = setInterval(
        () => { const pruned = this.inbound_lanes.prune_idle(); if (pruned > 0) this.logger.debug("lane_pruned", { pruned }); },
        this.config.sessionLanePruneIntervalMs,
      );
    }
    if (this.config.staleRunTimeoutMs > 0) {
      // 1분마다 검사. 실제 TTL은 staleRunTimeoutMs.
      this.stale_run_timer = setInterval(() => this.prune_stale_runs(), 60_000);
    }
    this._recover_orphaned_messages().catch((e) =>
      this.logger.warn("orphan recovery failed", { error: error_message(e) }),
    );
  }

  /** 각 채널 플랫폼에 커맨드 목록을 등록 (best-effort). */
  private async sync_commands_to_channels(): Promise<void> {
    const descriptors = get_command_descriptors();
    for (const entry of this.registry.list_channels()) {
      const ch = this.registry.get_channel(entry.instance_id);
      if (!ch) continue;
      try {
        await ch.sync_commands(descriptors);
      } catch (error) {
        this.logger.warn("sync_commands failed", { instance_id: entry.instance_id, error: error_message(error) });
      }
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    this.abort_ctl.abort();
    this.cancel_active_runs();
    if (this.prune_timer) { clearInterval(this.prune_timer); this.prune_timer = null; }
    if (this.lane_prune_timer) { clearInterval(this.lane_prune_timer); this.lane_prune_timer = null; }
    if (this.stale_run_timer) { clearInterval(this.stale_run_timer); this.stale_run_timer = null; }
    this.inbound_debouncer.clear();
    this.thread_ownership?.dispose();
    this.primed_targets.clear();
    this.render_profile_ts.clear();
    this.seen.clear();
    this.mention_cooldowns.clear();
    this.control_reaction_seen.clear();
    this.tone_overrides.clear();
    if (this.inbound_inflight.size > 0) await Promise.allSettled([...this.inbound_inflight]);
    await this.poll_task;
    await this.consumer_task;
    this.poll_task = null;
    this.consumer_task = null;
    await this.registry.stop_all();
  }

  health_check(): { ok: boolean; details?: Record<string, unknown> } {
    return {
      ok: this.running,
      details: { seen_cache_size: this.seen.size, active_runs: this.active_runs.size, inbound_lanes: this.inbound_lanes.session_count, bus_inbound: this.bus.get_size("inbound") },
    };
  }

  get_status(): ChannelManagerStatus {
    return {
      enabled_channels: this.registry.list_channels().map((ch) => ch.instance_id),
      mention_loop_running: this.running,
    };
  }

  /** 채널별 연결 상태 + 에러 정보. 대시보드 build_state()에서 사용. */
  get_channel_health(): import("./types.js").ChannelHealth[] {
    return this.registry.get_health();
  }

  /** 현재 동시 실행 수. */
  get_active_run_count(): number {
    return this.active_runs.size;
  }

  cancel_active_runs(key?: string): number {
    return this.active_runs.cancel(key);
  }

  get_render_profile(provider: ChannelProvider, chat_id: string): RenderProfile {
    return this.render_store.get(provider, chat_id);
  }

  set_render_profile(provider: ChannelProvider, chat_id: string, patch: Partial<RenderProfile>): RenderProfile {
    this.render_profile_ts.set(render_key(provider, chat_id), Date.now());
    return this.render_store.set(provider, chat_id, patch);
  }

  reset_render_profile(provider: ChannelProvider, chat_id: string): RenderProfile {
    this.render_profile_ts.delete(render_key(provider, chat_id));
    return this.render_store.reset(provider, chat_id);
  }

  /** 대시보드 승인 후 task 재개. 비동기 fire-and-forget — 호출자는 await 불필요. */
  async resume_after_dashboard_approval(info: {
    task_id: string; tool_result: string; provider: string; chat_id: string;
  }): Promise<boolean> {
    const resumed = await this.task_resume.resume_after_approval(info.task_id, info.tool_result);
    if (!resumed) {
      this.logger.warn("dashboard_approval_resume_failed", { task_id: info.task_id });
      return false;
    }
    const provider = (info.provider || "web") as ChannelProvider;
    const msg: InboundMessage = {
      id: `approval-resume-${Date.now()}`,
      provider,
      channel: provider,
      sender_id: "dashboard",
      chat_id: info.chat_id,
      content: "",
      at: now_iso(),
    };
    this.logger.info("task resumed after dashboard approval", { task_id: info.task_id });
    await this.invoke_and_reply(provider, msg, this.config.defaultAlias, info.task_id);
    return true;
  }

  async handle_inbound_message(message: InboundMessage): Promise<void> {
    if (this._should_ignore(message)) return;
    const provider = resolve_provider(message);
    if (!provider) return;
    const ck = render_key(provider, message.chat_id);

    this.mark_seen(message);
    this.on_activity_start?.();

    // current-turn tone override 감지
    const tone = parse_tone_override(String(message.content || ""));
    if (tone) this.tone_overrides.set(ck, tone);

    try {
    const approval = await this.approval.try_handle_text_reply(provider, message);
    if (approval.handled) {
      if (approval.task_id && approval.tool_result) {
        // 승인 → 도구 실행 결과를 주입하고 task loop 재개
        const resumed = await this.task_resume.resume_after_approval(
          approval.task_id,
          approval.tool_result,
        );
        if (resumed) {
          this.logger.info("task resumed after approval", { task_id: approval.task_id });
          await this.send_outbound(provider, message, this.config.defaultAlias, this.render_msg({ kind: "approval_resumed" }, ck), { kind: "approval_resume_ack" });
          await this.invoke_and_reply(provider, message, this.config.defaultAlias, approval.task_id);
        } else {
          this.logger.warn("approval_resume_failed", { task_id: approval.task_id });
          await this.send_outbound(provider, message, this.config.defaultAlias, this.render_msg({ kind: "approval_resume_failed" }, ck), { kind: "approval_resume_failed" });
        }
      } else if (approval.task_id && (approval.approval_status === "denied" || approval.approval_status === "cancelled")) {
        // 거부/취소 → 좀비 방지: Task 즉시 취소
        await this.task_resume.cancel_task(approval.task_id, `approval_${approval.approval_status}`);
        this.logger.info("task cancelled after approval denial", { task_id: approval.task_id, status: approval.approval_status });
      }
      return;
    }

    // 워크플로우 HITL: 활성 워크플로우가 사용자 입력을 대기 중이면 라우팅
    if (this.workflow_hitl) {
      const resolved = await this.workflow_hitl.try_resolve(message.chat_id, String(message.content || "").trim());
      if (resolved) {
        this.logger.info("workflow_hitl_resolved", { chat_id: message.chat_id });
        await this.send_outbound(provider, message, this.config.defaultAlias, this.render_msg({ kind: "workflow_resume" }, ck), { kind: "workflow_resume_ack" });
        return;
      }
    }

    // Confirmation Guard: 실행 확인 대기 중인 요청이 있으면 해소
    if (this.confirmation_guard?.has_pending(provider, message.chat_id)) {
      const guard_result = this.confirmation_guard.try_resolve(provider, message.chat_id, String(message.content || "").trim());
      if (guard_result) {
        if (guard_result.action === "cancelled") {
          await this.send_outbound(provider, message, this.config.defaultAlias, this.render_msg({ kind: "guard_cancelled" }, ck), { kind: "guard_cancelled" });
          return;
        }
        this.logger.info("guard_confirmed", { provider, chat_id: message.chat_id });
        const original: InboundMessage = { ...message, content: guard_result.original_text };
        await this.invoke_and_reply(provider, original, this.config.defaultAlias);
        return;
      }
      // null → pending 만료 또는 무관한 텍스트 → 정상 플로우로 계속
    }

    // TTL 만료 태스크 알림
    await this.notify_expired_tasks(provider);

    // HITL: 대기/실패 Task이 있으면 사용자 입력으로 재개
    const resume = await this.task_resume.try_resume(provider, message);
    if (resume?.resumed) {
      this.logger.info("task resumed from referenced message", { task_id: resume.task_id, previous_status: resume.previous_status });
      await this.invoke_and_reply(provider, message, this.config.defaultAlias, resume.task_id);
      return;
    }
    if (resume?.referenced_context) {
      // 완료 작업 컨텍스트 + 사용자의 현재 요청을 합쳐서 새 오케스트레이션 진행
      this.logger.info("enriching request with completed task context", { task_id: resume.task_id });
      const enriched: InboundMessage = {
        ...message,
        content: `${resume.referenced_context}\n\n[현재 요청]\n${String(message.content || "").trim()}`,
      };
      await this.invoke_and_reply(provider, enriched, this.config.defaultAlias);
      return;
    }

    const slash = parse_slash_command_from_message(message);
    const ctx: CommandContext = {
      provider,
      message,
      command: slash,
      text: String(message.content || "").trim(),
      send_reply: (content) => this.send_command_reply(provider, message, content),
    };
    if (await this.commands.try_handle(ctx)) return;

    // 인식되지 않은 슬래시 커맨드 → LLM 없이 안내 후 종료
    if (slash) {
      await ctx.send_reply(t("cmd.unknown", { name: slash.name }));
      return;
    }

    const channel_id = message.instance_id || provider;
    await this.try_read_ack(channel_id, message);
    this.logger.debug("inbound", { provider, instance_id: channel_id, sender: message.sender_id, text: String(message.content || "").slice(0, 80) });

    const anchor_ts = String((message.metadata as Record<string, unknown>)?.message_id || message.id || "");
    await this.registry.set_typing(channel_id, message.chat_id, true, anchor_ts);
    try {
      const mentions = this.extract_mentions(provider, message);
      if (mentions.length > 0) {
        await this.handle_mentions(provider, message, mentions);
        return;
      }

      if (!this.config.autoReply || !this.providers) return;
      const sender = String(message.sender_id || "").toLowerCase();
      if (!sender || sender.startsWith("subagent:") || sender === "approval-bot") return;

      // auto-reply: 다른 에이전트가 소유한 스레드에는 응답하지 않음
      const auto_tid = String(message.thread_id || "").trim();
      if (auto_tid && this.thread_ownership) {
        const owner = this.thread_ownership.owner_of(provider, message.chat_id, auto_tid);
        if (owner && owner.toLowerCase() !== this.config.defaultAlias.toLowerCase()) return;
      }

      await this.invoke_and_reply(provider, message, this.config.defaultAlias);
    } finally {
      await this.registry.set_typing(channel_id, message.chat_id, false, anchor_ts);
    }
    } finally {
      // current-turn override는 이번 턴 응답까지만 적용 — 다음 턴에 누수 방지
      if (tone) this.tone_overrides.delete(ck);
      // 모든 경로(조기 반환/invoke_and_reply)에서 busy_count 감소 보장
      this.on_activity_end?.();
    }
  }

  private async run_poll_loop(): Promise<void> {
    const signal = this.abort_ctl.signal;
    let current_poll_ms = this.config.pollIntervalMs;
    const poll_max_ms = this.config.pollMaxIntervalMs;
    while (this.running && !signal.aborted) {
      let had_new_messages = false;
      for (const { provider, instance_id } of this.registry.list_channels()) {
        if (!this.running || signal.aborted) return;
        const target = this.resolve_target(provider, instance_id);
        if (!target) continue;
        try {
          const rows = await this.registry.read(instance_id, target, this.config.readLimit);
          for (const row of rows) { if (!row.instance_id) row.instance_id = instance_id; }
          if (this.config.approvalReactionEnabled) {
            const rxn_result = await this.approval.try_handle_approval_reactions(provider, rows);
            if (rxn_result.handled && rxn_result.task_id) {
              if (rxn_result.tool_result) {
                const resumed = await this.task_resume.resume_after_approval(rxn_result.task_id, rxn_result.tool_result);
                if (resumed) {
                  const trigger_msg = rows.find((r) => is_reaction_message(r)) || rows[0];
                  if (trigger_msg) {
                    this.logger.info("task resumed after reaction approval", { task_id: rxn_result.task_id });
                    const rkey = `${trigger_msg.instance_id || provider}:${trigger_msg.chat_id}`;
                    this.inbound_lanes.execute(rkey, () =>
                      this.invoke_and_reply(provider, trigger_msg, this.config.defaultAlias, rxn_result.task_id),
                    ).catch((e) => this.logger.error("reaction resume failed", { error: error_message(e) }));
                  }
                } else {
                  this.logger.warn("reaction_approval_resume_failed", { task_id: rxn_result.task_id });
                }
              } else if (rxn_result.approval_status === "denied" || rxn_result.approval_status === "cancelled") {
                this.task_resume.cancel_task(rxn_result.task_id, `approval_${rxn_result.approval_status}`).catch((e) =>
                  this.logger.error("reaction denial cancel failed", { error: error_message(e) }),
                );
                this.logger.info("task cancelled after reaction denial", { task_id: rxn_result.task_id, status: rxn_result.approval_status });
              }
            }
          }
          if (this.config.controlReactionEnabled) {
            this.handle_control_reactions(provider, rows);
          }

          const target_key = `${instance_id}:${target}`;
          if (!this.primed_targets.has(target_key)) {
            for (const row of rows) this.mark_seen(row);
            this.primed_targets.set(target_key, Date.now());
            continue;
          }

          const sorted = [...rows].sort((a, b) => extract_ts(a) - extract_ts(b));
          for (const msg of sorted) {
            if (is_reaction_message(msg)) continue;
            if (this.is_duplicate(msg)) continue;
            this.mark_seen(msg);
            had_new_messages = true;
            this.bus.publish_inbound(msg).catch((e) =>
              this.logger.debug("publish_inbound failed", { error: error_message(e) }),
            );
          }
        } catch (e) {
          this.logger.error("poll failed", { instance_id, error: error_message(e) });
        }
      }
      // 어댑티브 백오프: 메시지 없으면 1.5× 증가, 있으면 기본 간격으로 복귀.
      if (poll_max_ms > 0) {
        current_poll_ms = had_new_messages
          ? this.config.pollIntervalMs
          : Math.min(Math.round(current_poll_ms * 1.5), poll_max_ms);
      }
      await abortable_sleep(current_poll_ms, this.abort_ctl.signal);
    }
  }

  /** bus에서 인바운드 메시지를 소비. 같은 provider:chat_id는 FIFO 직렬, 다른 채팅은 병렬. */
  private async run_inbound_consumer(): Promise<void> {
    const signal = this.abort_ctl.signal;
    const reliable = is_reliable_inbound_bus(this.bus);
    const debounce = this.config.inboundDebounce.enabled;
    while (this.running && !signal.aborted) {
      if (reliable) {
        const lease = await reliable.consume_inbound_lease({ timeout_ms: 2000 });
        if (!lease || !this.running || signal.aborted) continue;
        const msg = lease.value;
        if (this.try_hitl_send_input(msg)) { await lease.ack(); continue; }
        const chat_key = `${msg.instance_id || resolve_provider(msg) || "unknown"}:${msg.chat_id}`;
        // 디바운싱 활성 시: 즉시 ack + 디바운서에 위임 (debouncer handler가 lane 실행)
        if (debounce) {
          await lease.ack();
          this.inbound_debouncer.push(chat_key, msg);
          continue;
        }
        const task = this.inbound_lanes.execute(chat_key, () => this.handle_inbound_message(msg))
          .then(() => lease.ack())
          .catch((e) => {
            if (error_message(e) === "queue_cap_exceeded") {
              this.logger.debug("inbound_cap_dropped", { chat_key });
              return lease.ack();
            }
            this.logger.error("inbound handler failed", { error: error_message(e) });
            return lease.retry();
          })
          .finally(() => this.inbound_inflight.delete(task));
        this.inbound_inflight.add(task);
      } else {
        const msg = await this.bus.consume_inbound({ timeout_ms: 2000 });
        if (!msg || !this.running || signal.aborted) continue;
        if (this.try_hitl_send_input(msg)) continue;
        const chat_key = `${msg.instance_id || resolve_provider(msg) || "unknown"}:${msg.chat_id}`;
        if (debounce) {
          this.inbound_debouncer.push(chat_key, msg);
          continue;
        }
        const task = this.inbound_lanes.execute(chat_key, () => this.handle_inbound_message(msg))
          .catch((e) => {
            if (error_message(e) !== "queue_cap_exceeded") {
              this.logger.error("inbound handler failed", { error: error_message(e) });
            }
          })
          .finally(() => this.inbound_inflight.delete(task));
        this.inbound_inflight.add(task);
      }
    }
  }

  /** HITL: 같은 chat_id의 활성 run에 send_input이 있으면 입력 주입. */
  private try_hitl_send_input(msg: InboundMessage): boolean {
    const content = String(msg.content || "").trim();
    if (!content) return false;
    const run = this.active_runs.find_by_chat_id(msg.chat_id);
    if (run?.send_input) { run.send_input(content); return true; }
    return false;
  }

  private async handle_mentions(provider: ChannelProvider, message: InboundMessage, aliases: string[]): Promise<void> {
    for (const alias of aliases) {
      if (message.sender_id.toLowerCase() === alias.toLowerCase()) continue;
      // 명시적 @멘션 → 소유권 바이패스 (멘션된 에이전트는 항상 응답 허용)
      const cooldown_key = `${provider}:${message.chat_id}:${alias}`;
      const now = Date.now();
      if (now - (this.mention_cooldowns.get(cooldown_key) || 0) < 5_000) continue;
      this.mention_cooldowns.set(cooldown_key, now);
      await this.invoke_and_reply(provider, message, alias);
    }
  }

  private async invoke_and_reply(provider: ChannelProvider, message: InboundMessage, alias: string, resumed_task_id?: string): Promise<void> {
    const tid = String(message.thread_id || "").trim();
    if (tid && this.thread_ownership) {
      this.thread_ownership.claim(provider, message.chat_id, tid, alias);
    }
    const invoke_ck = render_key(provider, message.chat_id);
    const run_key = `${message.instance_id || provider}:${message.chat_id}:${alias}`.toLowerCase();
    const prev = this.active_runs.get(run_key);
    if (prev) {
      if (!prev.abort.signal.aborted) prev.abort.abort();
      await Promise.race([prev.done, sleep(3000)]);
    }

    let resolve_done!: () => void;
    const done = new Promise<void>((r) => { resolve_done = r; });
    const abort = new AbortController();
    const active_run: ActiveRun = { abort, provider, chat_id: message.chat_id, alias, done };
    this.active_runs.register(run_key, active_run);
    if (this.config.staleRunTimeoutMs > 0) this.run_start_times.set(run_key, Date.now());

    const run_id = this.tracker?.start({ provider, chat_id: message.chat_id, alias, sender_id: message.sender_id });

    const meta = (message.metadata && typeof message.metadata === "object") ? message.metadata as Record<string, unknown> : {};
    const anchor_ts = String(meta.message_id || message.id || "");
    const typing_ticker = setInterval(() => {
      this.registry.set_typing(provider, message.chat_id, true, anchor_ts).catch((e) =>
        this.logger.debug("typing_update_failed", { error: error_message(e) }),
      );
    }, 4000);

    // web 채널은 status 메시지 편집 API가 없으므로 항상 live 모드로 강제
    const is_status_mode = provider !== "web" && this.config.streaming.enabled && this.config.streaming.mode === "status";

    const renderer: ChannelRendererLike = create_channel_renderer(provider, {
      chat_id: message.chat_id,
      provider,
      message,
      alias,
      is_status_mode,
      get_render_profile: () => this.effective_render_profile(provider, message.chat_id),
      render_msg: (intent) => this.render_msg(intent, invoke_ck),
      dispatch: this.dispatch,
      registry: this.registry,
      logger: this.logger,
      on_web_stream: this.on_web_stream,
      on_web_rich_event: this.on_web_rich_event,
    });

    try {
      if (!meta.is_recovery) await this.recorder.record_user(provider, message, alias);
      const media_inputs = await this.media.collect(provider, message);
      const history = await this.recorder.get_history(
        provider, message.chat_id, alias, message.thread_id,
        12, this.config.sessionHistoryMaxAgeMs,
      );

      const msg_meta = (message.metadata || {}) as Record<string, unknown>;
      const preferred_provider_id = typeof msg_meta.preferred_provider_id === "string" ? msg_meta.preferred_provider_id : undefined;
      const preferred_model = typeof msg_meta.preferred_model === "string" ? msg_meta.preferred_model : undefined;
      const system_prompt_override = typeof msg_meta.system_prompt_override === "string" ? msg_meta.system_prompt_override : undefined;

      const result = await this.orchestration.execute({
        message, alias, provider, media_inputs,
        session_history: history,
        resumed_task_id,
        run_id,
        preferred_provider_id,
        preferred_model,
        system_prompt_override,
        on_stream: (chunk) => renderer.on_text_chunk(chunk),
        on_progress: (event) => {
          this.bus.publish_progress(event).catch((e) =>
            this.logger.debug("progress_publish_failed", { error: error_message(e) }),
          );
        },
        on_agent_event: (event) => {
          this.on_agent_event?.(event);
          const stream_ev = agent_event_to_stream(event);
          if (stream_ev) renderer.on_stream_event(stream_ev);
        },
        on_stream_event: (event) => renderer.on_stream_event(event),
        on_tool_block: (name) => renderer.on_tool_start(name),
        signal: abort.signal,
        register_send_input: (cb) => { active_run.send_input = cb; },
      });

      if (run_id) {
        this.tracker!.set_tool_count(run_id, result.tool_calls_count);
        this.tracker!.end(run_id, result.error ? "failed" : "completed", result.error);
      }

      // builtin: 분류기가 커맨드 핸들러로 라우팅 → synthetic slash command로 위임
      if (result.builtin_command) {
        const synthetic_text = `/${result.builtin_command}${result.builtin_args ? " " + result.builtin_args : ""}`;
        const synthetic_slash = parse_slash_command(synthetic_text);
        if (synthetic_slash) {
          const cmd_ctx: CommandContext = {
            provider, message,
            command: { ...synthetic_slash, args_lower: synthetic_slash.args.map((a) => a.toLowerCase()) },
            text: synthetic_text,
            send_reply: (content) => this.send_command_reply(provider, message, content),
          };
          if (await this.commands.try_handle(cmd_ctx)) return;
        }
      }

      await renderer.flush(result.stream_full_content ?? "");
      await this.deliver_result(provider, message, alias, result, renderer.stream_message_id, renderer.tool_count, is_status_mode);
    } catch (e) {
      if (run_id) this.tracker!.end(run_id, "failed", error_message(e));
      this.logger.error("invoke failed", { alias, error: error_message(e) });
      await renderer.flush_on_error();
      await this.send_error_reply(provider, message, alias, error_message(e), run_id);
    } finally {
      clearInterval(typing_ticker);
      resolve_done();
      this.active_runs.unregister(run_key, abort);
      this.run_start_times.delete(run_key);
    }
  }

  private async deliver_result(
    provider: ChannelProvider, message: InboundMessage, alias: string,
    result: OrchestrationResult, stream_message_id?: string, tool_count = 0, is_status_mode = false,
  ): Promise<void> {
    // web NDJSON 스트림 종료는 renderer.flush()에서 처리됨 — 여기서는 전송 여부만 결정
    if (result.suppress_reply) { return; }
    if (!result.reply) {
      if (result.error) await this.send_error_reply(provider, message, alias, result.error, result.run_id);
      return;
    }

    const rendered = this.render_reply(result.reply, provider, message.chat_id);
    const mention = format_mention(provider, message.sender_id);
    const max_len = get_provider_max_length(provider);

    const record_meta = {
      stream_full_content: result.stream_full_content,
      parsed_output: result.parsed_output,
      tool_calls_count: result.tool_calls_count,
      run_id: result.run_id,
      usage: result.usage as Record<string, unknown> | undefined,
      tools_used: result.tools_used,
    };

    const build_meta = (): Record<string, unknown> => {
      const m: Record<string, unknown> = {
        kind: "agent_reply", agent_alias: alias,
        trigger_message_id: String((message.metadata as Record<string, unknown>)?.message_id || message.id || ""),
        render_mode: rendered.render_mode, render_parse_mode: rendered.parse_mode || null,
      };
      if (result.parsed_output !== undefined) m.parsed_output = result.parsed_output;
      if (result.run_id) m.run_id = result.run_id;
      if (result.usage) m.usage = result.usage;
      return m;
    };

    // status mode 또는 도구 사용: 상태 메시지 → "✓ 완료" + 최종 답변 새 메시지 (web은 제외)
    if ((is_status_mode || (provider !== "web" && tool_count > 0)) && stream_message_id) {
      try {
        await this.registry.edit_message(provider, message.chat_id, stream_message_id, this.render_msg({ kind: "status_completed" }, render_key(provider, message.chat_id)));
      } catch { /* 상태 메시지 마무리 실패는 무시 */ }
      await this.send_chunked(provider, message, alias, mention, rendered.content, max_len, build_meta(), rendered.media);
      void this.recorder.record_assistant(provider, message, alias, rendered.markdown, record_meta).catch((e) => this.logger.warn("record_assistant_failed", { error: error_message(e) }));
      return;
    }

    if (result.streamed && stream_message_id) {
      if (!this.config.streaming.suppressFinalAfterStream) {
        const first_chunk_text = `${mention}${rendered.content}`.trim();
        try {
          await this.registry.edit_message(provider, message.chat_id, stream_message_id, first_chunk_text.slice(0, max_len), rendered.parse_mode);
        } catch (e) {
          this.logger.warn("edit_message_failed, sending as new message", { error: error_message(e) });
          await this.send_chunked(provider, message, alias, mention, rendered.content, max_len, { kind: "agent_reply", agent_alias: alias }, rendered.media);
        }
      }
      if (rendered.media.length > 0) {
        await this.send_outbound(provider, message, alias, "첨부 파일을 확인해주세요.", { kind: "agent_media", agent_alias: alias }, rendered.media);
      }
      void this.recorder.record_assistant(provider, message, alias, rendered.markdown, record_meta).catch((e) => this.logger.warn("record_assistant_failed", { error: error_message(e) }));
      return;
    }

    await this.send_chunked(provider, message, alias, mention, rendered.content, max_len, build_meta(), rendered.media);
    void this.recorder.record_assistant(provider, message, alias, rendered.markdown, record_meta).catch((e) => this.logger.warn("record_assistant_failed", { error: error_message(e) }));
  }

  private render_reply(raw: string, provider: ChannelProvider, chat_id: string): {
    content: string; markdown: string; media: MediaItem[]; parse_mode?: "HTML"; render_mode: RenderMode;
  } {
    const profile = this.effective_render_profile(provider, chat_id);
    const cleaned = sanitize_provider_output(raw);
    const { content: text_content, media } = extract_media_items(cleaned, this.workspace_dir);
    const fallback = text_content || (media.length > 0 ? "첨부 파일을 확인해주세요." : "");
    const rendered = render_agent_output(fallback, profile);
    return {
      content: String(rendered.content || ""),
      markdown: String(rendered.markdown || ""),
      media: media.slice(0, 4),
      parse_mode: rendered.parse_mode,
      render_mode: profile.mode,
    };
  }

  /** renderer가 있으면 동적 톤·매너 메시지, 없으면 기본 텍스트 폴백. */
  private render_msg(intent: PersonaMessageIntent, chat_key?: string): string {
    const session = chat_key ? this.tone_overrides.get(chat_key) : undefined;
    if (this.renderer) return this.renderer.render(intent, session || chat_key ? { session, chat_key } : undefined);
    if (intent.kind === "error") return `처리 중 문제가 발생했습니다. 사유: ${intent.reason}`;
    if (intent.kind === "status_progress") {
      const tc = intent.tool_count ? ` (도구 ${intent.tool_count}회)` : "";
      return `${intent.label}${tc}`;
    }
    if (intent.kind === "expired_task" && intent.objective) return `이전 작업 (${intent.objective})이 만료되었습니다.`;
    if (intent.kind === "command_reply") return intent.body;
    return FALLBACK_MESSAGES[intent.kind] ?? "";
  }

  private effective_render_profile(provider: ChannelProvider, chat_id: string): RenderProfile {
    const profile = this.get_render_profile(provider, chat_id);
    if (provider !== "telegram" && profile.mode === "html") return { ...profile, mode: "markdown" };
    return profile;
  }

  private async send_error_reply(provider: ChannelProvider, message: InboundMessage, alias: string, error: string, run_id?: string): Promise<void> {
    const mention = format_mention(provider, message.sender_id);
    const reason = strip_secret_reference_tokens(normalize_error_detail(error));
    const error_text = this.render_msg({ kind: "error", reason }, render_key(provider, message.chat_id));
    const content = [
      `${mention}❌ **작업 실패**`,
      "",
      error_text,
      "",
      "_이 메시지에 답장하면 추가 정보를 포함하여 재시도합니다._",
    ].join("\n").trim();
    await this.send_outbound(provider, message, alias, content, { kind: "agent_error", agent_alias: alias });
    void this.recorder.record_assistant(provider, message, alias, content, { run_id }).catch((e) => this.logger.warn("record_assistant_failed", { error: error_message(e) }));
  }

  private async send_command_reply(provider: ChannelProvider, message: InboundMessage, content: string): Promise<void> {
    const persona_content = this.render_msg({ kind: "command_reply", body: content }, render_key(provider, message.chat_id));
    const profile = this.effective_render_profile(provider, message.chat_id);
    const rendered = render_agent_output(persona_content, profile);
    const max_len = get_provider_max_length(provider);
    const meta = { kind: "command_reply", render_parse_mode: rendered.parse_mode || null };
    await this.send_chunked(provider, message, this.config.defaultAlias, "", rendered.content, max_len, meta);
    void this.recorder.record_assistant(provider, message, this.config.defaultAlias, rendered.markdown).catch((e) => this.logger.warn("record_assistant_failed", { error: error_message(e) }));
  }

  /** TTL 만료로 취소된 태스크에 대해 해당 채널에 알림 발송. */
  private async notify_expired_tasks(provider: ChannelProvider): Promise<void> {
    const expired = this.task_resume.expire_stale();
    for (const task of expired) {
      const objective = String(task.memory?.objective || task.title || "").slice(0, 200);
      const expired_text = this.render_msg({ kind: "expired_task", objective: objective || undefined });
      const content = [
        `⏰ ${expired_text}`,
        "",
        "_같은 요청을 다시 보내면 새로운 작업이 시작됩니다._",
      ].join("\n");
      const outbound = {
        id: `expired-${Date.now()}-${task.taskId.slice(0, 8)}`,
        provider,
        instance_id: task.channel || provider,
        channel: task.channel || provider,
        sender_id: this.config.defaultAlias,
        chat_id: task.chatId,
        content,
        at: now_iso(),
        metadata: { kind: "task_expired", task_id: task.taskId },
      };
      this.dispatch.send(provider, outbound).catch((e) =>
        this.logger.error("expired task notification failed", { task_id: task.taskId, error: error_message(e) }),
      );
    }
  }

  private async send_outbound(
    provider: ChannelProvider, message: InboundMessage, sender_id: string, content: string,
    metadata: Record<string, unknown>, media?: MediaItem[], id_prefix?: string,
  ): Promise<string | undefined> {
    const outbound = {
      id: `${id_prefix || provider}-${Date.now()}`, provider, instance_id: message.instance_id || provider, channel: provider, sender_id,
      chat_id: message.chat_id, content, media, at: now_iso(),
      reply_to: resolve_reply_to(provider, message), thread_id: message.thread_id, metadata,
    };
    if (provider === "web") {
      await this.bus.publish_outbound(outbound);
      return undefined;
    }
    const result = await this.dispatch.send(provider, outbound);
    return result.message_id;
  }

  /** 긴 메시지를 채널 한도에 맞게 분할 전송. 첫 청크에만 멘션 + 미디어 포함. */
  private async send_chunked(
    provider: ChannelProvider, message: InboundMessage, alias: string,
    mention: string, content: string, max_len: number,
    metadata: Record<string, unknown>, media?: MediaItem[],
  ): Promise<void> {
    const mention_len = mention.length;
    const chunks = split_markdown(content, max_len - mention_len);
    for (let i = 0; i < chunks.length; i++) {
      const prefix = i === 0 ? mention : "";
      const text = `${prefix}${chunks[i]}`.trim();
      const chunk_media = i === 0 ? media : undefined;
      const chunk_meta = i === 0 ? metadata : { ...metadata, kind: "agent_reply_cont", chunk_index: i };
      await this.send_outbound(provider, message, alias, text, chunk_meta, chunk_media);
    }
  }

  private async try_read_ack(channel_id: string, message: InboundMessage): Promise<void> {
    if (!this.config.readAckEnabled) return;
    const ts = String((message.metadata as Record<string, unknown>)?.message_id || message.id || "").trim();
    if (!ts) return;
    const channel = this.registry.get_channel(channel_id);
    if (!channel) return;
    await channel.add_reaction(message.chat_id, ts, this.config.readAckReaction);
  }

  private extract_mentions(provider: ChannelProvider, message: InboundMessage): string[] {
    const meta = (message.metadata || {}) as Record<string, unknown>;
    const meta_mentions = Array.isArray(meta.mentions)
      ? (meta.mentions as Array<Record<string, unknown>>).map((m) => String(m.alias || "").trim()).filter(Boolean)
      : [];

    const channel = this.registry.get_channel(provider);
    const raw = meta_mentions.length > 0
      ? meta_mentions
      : (channel?.parse_agent_mentions(String(message.content || "")) || []).map((m) => m.alias).filter(Boolean);

    const out = new Set<string>();
    const bot_id = this._read_bot_ids().slack;
    for (const alias of raw) {
      const low = alias.toLowerCase();
      if (provider === "slack" && bot_id && low === bot_id) { out.add(this.config.defaultAlias); continue; }
      if (provider === "slack" && ["claude", "claude-worker", "worker"].includes(low)) { out.add(this.config.defaultAlias); continue; }
      out.add(alias);
    }
    return [...out];
  }

  private resolve_target(provider: ChannelProvider, instance_id?: string): string | null {
    if (instance_id) {
      const target = this.bot_identity.get_default_target(instance_id);
      if (target) return target;
    }
    return this.bot_identity.get_default_target(provider) || null;
  }

  private mark_seen(msg: InboundMessage): void {
    const key = seen_key(msg);
    if (key) this.seen.set(key, Date.now());
  }

  private is_duplicate(msg: InboundMessage): boolean {
    const key = seen_key(msg);
    return key ? this.seen.has(key) : false;
  }

  /** staleRunTimeoutMs 초과 run 자동 중단. run_start_times 맵으로 경과 시간 추적. */
  private prune_stale_runs(): void {
    if (this.config.staleRunTimeoutMs <= 0 || this.run_start_times.size === 0) return;
    const now = Date.now();
    let aborted = 0;
    for (const [run_key, started_at] of this.run_start_times) {
      if (now - started_at <= this.config.staleRunTimeoutMs) continue;
      const run = this.active_runs.get(run_key);
      if (!run || run.abort.signal.aborted) { this.run_start_times.delete(run_key); continue; }
      this.logger.warn("stale_run_aborted", { run_key, elapsed_ms: now - started_at });
      run.abort.abort();
      aborted++;
    }
    if (aborted > 0) this.logger.info("prune_stale_runs", { aborted });
  }

  private prune_seen(): void {
    prune_ttl_map(this.seen, (ts) => ts, this.config.seenTtlMs, this.config.seenMaxSize);
    prune_ttl_map(this.control_reaction_seen, (ts) => ts, this.config.reactionActionTtlMs, this.config.seenMaxSize);
    prune_ttl_map(this.mention_cooldowns, (ts) => ts, 30_000, this.config.seenMaxSize);
    prune_ttl_map(this.primed_targets, (ts) => ts, this.config.seenTtlMs, this.config.seenMaxSize);
    this.prune_render_profiles();
    this.approval.prune_seen(this.config.seenTtlMs, this.config.seenMaxSize);
  }

  /** render_profiles를 병렬 타임스탬프 맵 기준으로 TTL 프루닝. */
  private prune_render_profiles(): void {
    if (this.render_profile_ts.size === 0) return;
    const now = Date.now();
    for (const [key, ts] of this.render_profile_ts) {
      if (now - ts > this.config.seenTtlMs) {
        const sep = key.indexOf(":");
        if (sep > 0) this.render_store.reset(key.slice(0, sep), key.slice(sep + 1));
        this.render_profile_ts.delete(key);
      }
    }
  }

  /** 프로세스 재시작 후 응답 없이 남은 사용자 메시지를 재처리. */
  private async _recover_orphaned_messages(): Promise<void> {
    const store = this.session_store;
    if (!store?.list_by_prefix) return;

    const RECOVERY_WINDOW_MS = 30 * 60 * 1000;
    const now = Date.now();
    const providers = ["telegram", "slack", "discord"];
    let recovered = 0;

    for (const provider of providers) {
      try {
        const entries = await store.list_by_prefix(`${provider}:`, 50);
        for (const entry of entries) {
          if (entry.message_count === 0) continue;
          const updated = Date.parse(entry.updated_at);
          if (!Number.isFinite(updated) || now - updated > RECOVERY_WINDOW_MS) continue;

          const session = await store.get_or_create(entry.key);
          const last = session.messages[session.messages.length - 1];
          if (!last || last.role !== "user") continue;

          const parts = entry.key.split(":");
          if (parts.length < 4) continue;
          const [, chat_id, , thread] = parts;
          if (!chat_id) continue;

          const sender_id = String((last as Record<string, unknown>).sender_id || "").trim();
          if (!sender_id || sender_id === "unknown") continue;
          const content = String(last.content || "").trim();
          if (!content) continue;

          // 세션에 이미 후속 메시지가 있으면 orphan이 아님 (사용자가 다른 요청으로 넘어감)
          const msg_count = session.messages.length;
          if (msg_count >= 3) {
            const prev = session.messages[msg_count - 2];
            if (prev && prev.role === "assistant") continue;
          }

          // 결정적 ID 사용: seen cache에서 원본 메시지와 매칭되도록
          const last_meta = (last as Record<string, unknown>).metadata as Record<string, unknown> | undefined;
          const original_id = String(last_meta?.message_id || last_meta?.telegram_message_id || "");
          const recovery_id = original_id || `recovery:${chat_id}:${session.messages.length}`;
          const recovery_seen_key = `${provider}:${chat_id}:${recovery_id}`;
          if (this.seen.has(recovery_seen_key)) continue;

          this.logger.info("recovering orphaned message", { provider, chat_id, sender_id, recovery_id });
          const recovery_msg: InboundMessage = {
            id: recovery_id,
            provider,
            channel: provider,
            sender_id,
            chat_id,
            content,
            at: String(last.timestamp || now_iso()),
            thread_id: thread === "main" ? undefined : thread,
            metadata: { kind: "orphan_recovery", is_recovery: true, message_id: recovery_id },
          };
          this.mark_seen(recovery_msg);
          await this.bus.publish_inbound(recovery_msg);
          recovered++;
        }
      } catch (e) {
        this.logger.warn("orphan recovery scan failed", { provider, error: error_message(e) });
      }
    }
    if (recovered > 0) this.logger.info(`recovered ${recovered} orphaned message(s)`);
  }

  /** 🛑 등 컨트롤 리액션으로 활성 실행을 취소. */
  private handle_control_reactions(provider: ChannelProvider, rows: InboundMessage[]): void {
    for (const row of rows) {
      if (!is_reaction_message(row)) continue;
      const names = extract_reaction_names(row);
      if (names.length === 0 || !is_control_stop_reaction(names)) continue;

      const sig = `${provider}:${row.chat_id}:${names.sort().join(",")}`;
      if (this.control_reaction_seen.has(sig)) continue;
      this.control_reaction_seen.set(sig, Date.now());

      if (!this.tracker) continue;
      const active = this.tracker.list_active().filter(
        (e) => e.provider === provider && e.chat_id === row.chat_id,
      );
      if (active.length === 0) continue;

      for (const entry of active) {
        this.tracker.cancel(entry.run_id).then((r) => {
          if (r.cancelled) {
            this.logger.info("control reaction cancelled run", { run_id: entry.run_id, details: r.details });
          }
        }).catch((e) =>
          this.logger.error("control reaction cancel failed", { error: error_message(e) }),
        );
      }

      const reply_to = resolve_reply_to(provider, row);
      this.dispatch.send(provider, {
        id: `${provider}-ctrl-${Date.now()}`,
        provider,
        channel: provider,
        sender_id: "system",
        chat_id: row.chat_id,
        content: `\u{1F6D1} 실행이 중지되었습니다. (${active.length}건)`,
        at: now_iso(),
        reply_to,
        thread_id: row.thread_id,
        metadata: { kind: "control_reaction", action: "stop" },
      }).catch((e) =>
        this.logger.debug("control reaction reply failed", { error: error_message(e) }),
      );
    }
  }

  private _read_bot_ids(): Record<string, string> {
    const now = Date.now();
    if (this._bot_ids_cache && now - this._bot_ids_cache_at < BOT_IDS_TTL_MS) return this._bot_ids_cache;
    this._bot_ids_cache = {
      slack: this.bot_identity.get_bot_self_id("slack").toLowerCase(),
      telegram: this.bot_identity.get_bot_self_id("telegram").toLowerCase(),
      discord: this.bot_identity.get_bot_self_id("discord").toLowerCase(),
    };
    this._bot_ids_cache_at = now;
    return this._bot_ids_cache;
  }

  private _should_ignore(message: InboundMessage): boolean {
    const sender = String(message.sender_id || "").trim().toLowerCase();
    if (!sender || sender === "unknown" || sender.startsWith("subagent:") || sender === "approval-bot" || sender === "recovery") return true;
    const meta = (message.metadata || {}) as Record<string, unknown>;
    if (String(meta.kind || "").toLowerCase() === "task_recovery") return true;
    if (meta.from_is_bot === true) return true;
    const provider = resolve_provider(message);
    const bot_ids = this._read_bot_ids();
    if (provider && bot_ids[provider] && sender === bot_ids[provider]) return true;

    const slack = (meta.slack && typeof meta.slack === "object") ? meta.slack as Record<string, unknown> : null;
    if (slack) {
      const subtype = String(slack.subtype || "").toLowerCase();
      if (typeof slack.bot_id === "string" && slack.bot_id.length > 0) return true;
      if (["bot_message", "message_changed", "message_deleted"].includes(subtype)) return true;
    }
    return false;
  }
}


function is_reaction_message(message: InboundMessage): boolean {
  const meta = (message.metadata || {}) as Record<string, unknown>;
  return meta.is_reaction === true;
}

const BOT_IDS_TTL_MS = 60_000;

function seen_key(msg: InboundMessage): string | null {
  const meta = (msg.metadata || {}) as Record<string, unknown>;
  const id = String(meta.message_id || msg.id || "").trim();
  if (!id) return null;
  return `${String(msg.provider || msg.channel || "").toLowerCase()}:${msg.chat_id}:${id}`;
}

function extract_ts(msg: InboundMessage): number {
  const meta = (msg.metadata || {}) as Record<string, unknown>;
  const raw = String(meta.ts || meta.message_id || msg.id || "").trim();
  const n = Number(raw);
  if (Number.isFinite(n) && n > 1_000_000_000) return n > 1e12 ? n : n * 1000;
  const d = Date.parse(String(msg.at || ""));
  return Number.isFinite(d) ? d : 0;
}

function render_key(provider: ChannelProvider, chat_id: string): string {
  return `${provider}:${String(chat_id || "").trim()}`.toLowerCase();
}

const RE_UNEXPECTED_ARG = /unexpected argument/i;

function normalize_error_detail(raw: string): string {
  const text = normalize_text(raw);
  if (!text) return "unknown_error";
  if (RE_UNEXPECTED_ARG.test(text)) return "executor_args_invalid";
  const m = RE_PROVIDER_ERROR.exec(text);
  if (m) return `${String(m[1]).toLowerCase()}:${String(m[2] || "error").trim()}`.slice(0, 180);
  return text.slice(0, 180);
}

/** AbortSignal로 즉시 중단 가능한 sleep. abort 시 조용히 resolve. */
function abortable_sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, Math.max(0, ms));
    const on_abort = () => { clearTimeout(timer); resolve(); };
    signal.addEventListener("abort", on_abort, { once: true });
  });
}

function is_reliable_inbound_bus(bus: MessageBusLike): ReliableMessageBus | null {
  const rb = bus as Partial<ReliableMessageBus>;
  if (typeof rb.consume_inbound_lease === "function") return rb as ReliableMessageBus;
  return null;
}

