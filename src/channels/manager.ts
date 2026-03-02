import type { InboundMessage, MediaItem, MessageBusLike } from "../bus/types.js";
import { resolve_provider, type ChannelProvider, type ChannelRegistryLike } from "./types.js";
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
import { resolve_reply_to } from "../orchestration/service.js";
import { get_command_descriptors } from "./commands/registry.js";
import { parse_slash_command_from_message } from "./slash-command.js";
import {
  default_render_profile,
  render_agent_output,
  type RenderProfile,
  type RenderMode,
} from "./rendering.js";
import { sanitize_provider_output, strip_sensitive_command_blocks, strip_secret_reference_tokens } from "./output-sanitizer.js";
import { extract_media_items } from "./media-extractor.js";
import { prune_ttl_map, sleep } from "../utils/common.js";

export type ChannelManagerStatus = {
  enabled_channels: string[];
  mention_loop_running: boolean;
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
  media_collector: MediaCollector;
  process_tracker: ProcessTrackerLike | null;
  providers: ProviderRegistry | null;
  config: AppConfig["channel"];
  workspace_dir: string;
  logger: Logger;
  /** AgentEvent를 대시보드 SSE로 릴레이할 콜백. */
  on_agent_event?: ((event: import("../agent/agent.types.js").AgentEvent) => void) | null;
};

type ActiveRun = { abort: AbortController; provider: ChannelProvider; chat_id: string; alias: string };

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

  private running = false;
  private poll_task: Promise<void> | null = null;
  private consumer_task: Promise<void> | null = null;
  private readonly seen = new Map<string, number>();
  private readonly primed_targets = new Set<string>();
  private readonly active_runs = new Map<string, ActiveRun>();
  private readonly mention_cooldowns = new Map<string, number>();
  private readonly control_reaction_seen = new Map<string, number>();
  private readonly render_profiles = new Map<string, RenderProfile>();
  private readonly inbound_inflight = new Set<Promise<void>>();
  private inbound_active = 0;
  private prune_timer: NodeJS.Timeout | null = null;

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
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.registry.start_all();
    await this.sync_commands_to_channels();
    this.poll_task = this.run_poll_loop();
    this.consumer_task = this.run_inbound_consumer();
    this.prune_timer = setInterval(() => this.prune_seen(), 60_000);
  }

  /** 각 채널 플랫폼에 커맨드 목록을 등록 (best-effort). */
  private async sync_commands_to_channels(): Promise<void> {
    const descriptors = get_command_descriptors();
    for (const entry of this.registry.list_channels()) {
      const ch = this.registry.get_channel(entry.provider);
      if (!ch) continue;
      try {
        await ch.sync_commands(descriptors);
      } catch (error) {
        this.logger.warn("sync_commands failed", { provider: entry.provider, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.prune_timer) { clearInterval(this.prune_timer); this.prune_timer = null; }
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
      details: { seen_cache_size: this.seen.size, active_runs: this.active_runs.size, bus_inbound: this.bus.get_size("inbound") },
    };
  }

  get_status(): ChannelManagerStatus {
    return {
      enabled_channels: this.registry.list_channels().map((ch) => ch.provider),
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
    const lk = key?.toLowerCase();
    const targets = lk
      ? [...this.active_runs.keys()].filter((k) => k === lk || k.startsWith(`${lk}:`))
      : [...this.active_runs.keys()];
    for (const k of targets) {
      const run = this.active_runs.get(k);
      if (run) {
        run.abort.abort();
        const entry = this.tracker?.find_active_by_key(run.provider, run.chat_id, run.alias);
        if (entry) this.tracker!.end(entry.run_id, "cancelled", "stopped_by_request");
      }
      this.active_runs.delete(k);
    }
    return targets.length;
  }

  get_render_profile(provider: ChannelProvider, chat_id: string): RenderProfile {
    return this.render_profiles.get(render_key(provider, chat_id)) || default_render_profile(provider);
  }

  set_render_profile(provider: ChannelProvider, chat_id: string, patch: Partial<RenderProfile>): RenderProfile {
    const prev = this.get_render_profile(provider, chat_id);
    const next: RenderProfile = {
      mode: patch.mode ?? prev.mode,
      blocked_link_policy: patch.blocked_link_policy ?? prev.blocked_link_policy,
      blocked_image_policy: patch.blocked_image_policy ?? prev.blocked_image_policy,
    };
    this.render_profiles.set(render_key(provider, chat_id), next);
    return next;
  }

  reset_render_profile(provider: ChannelProvider, chat_id: string): RenderProfile {
    this.render_profiles.delete(render_key(provider, chat_id));
    return default_render_profile(provider);
  }

  async handle_inbound_message(message: InboundMessage): Promise<void> {
    if (should_ignore(message)) return;
    const provider = resolve_provider(message);
    if (!provider) return;

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
          await this.invoke_and_reply(provider, message, this.config.defaultAlias, approval.task_id);
        }
      } else if (approval.task_id && (approval.approval_status === "denied" || approval.approval_status === "cancelled")) {
        // 거부/취소 → 좀비 방지: Task 즉시 취소
        await this.task_resume.cancel_task(approval.task_id, `approval_${approval.approval_status}`);
        this.logger.info("task cancelled after approval denial", { task_id: approval.task_id, status: approval.approval_status });
      }
      return;
    }

    // HITL: 대기/실패 Task이 있으면 사용자 입력으로 재개
    const resume = await this.task_resume.try_resume(provider, message);
    if (resume?.resumed) {
      this.logger.info("task resumed from user input", { task_id: resume.task_id, previous_status: resume.previous_status });
      await this.invoke_and_reply(provider, message, this.config.defaultAlias, resume.task_id);
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

    await this.try_read_ack(provider, message);
    this.logger.debug("inbound", { provider, sender: message.sender_id, text: String(message.content || "").slice(0, 80) });

    const anchor_ts = String((message.metadata as Record<string, unknown>)?.message_id || message.id || "");
    await this.registry.set_typing(provider, message.chat_id, true, anchor_ts);
    try {
      const mentions = this.extract_mentions(provider, message);
      if (mentions.length > 0) {
        await this.handle_mentions(provider, message, mentions);
        return;
      }

      if (!this.config.autoReply || !this.providers) return;
      const sender = String(message.sender_id || "").toLowerCase();
      if (!sender || sender.startsWith("subagent:") || sender === "approval-bot") return;

      await this.invoke_and_reply(provider, message, this.config.defaultAlias);
    } finally {
      await this.registry.set_typing(provider, message.chat_id, false, anchor_ts);
    }
  }

  private async run_poll_loop(): Promise<void> {
    while (this.running) {
      for (const { provider } of this.registry.list_channels()) {
        if (!this.running) return;
        const target = this.resolve_target(provider);
        if (!target) continue;
        try {
          const rows = await this.registry.read(provider, target, this.config.readLimit);
          if (this.config.approvalReactionEnabled) {
            const rxn_result = await this.approval.try_handle_approval_reactions(provider, rows);
            if (rxn_result.handled && rxn_result.task_id) {
              if (rxn_result.tool_result) {
                const resumed = await this.task_resume.resume_after_approval(rxn_result.task_id, rxn_result.tool_result);
                if (resumed) {
                  const trigger_msg = rows.find((r) => is_reaction_message(r)) || rows[0];
                  if (trigger_msg) {
                    this.logger.info("task resumed after reaction approval", { task_id: rxn_result.task_id });
                    this.invoke_and_reply(provider, trigger_msg, this.config.defaultAlias, rxn_result.task_id).catch((e) =>
                      this.logger.error("reaction resume failed", { error: e instanceof Error ? e.message : String(e) }),
                    );
                  }
                }
              } else if (rxn_result.approval_status === "denied" || rxn_result.approval_status === "cancelled") {
                this.task_resume.cancel_task(rxn_result.task_id, `approval_${rxn_result.approval_status}`).catch((e) =>
                  this.logger.error("reaction denial cancel failed", { error: e instanceof Error ? e.message : String(e) }),
                );
                this.logger.info("task cancelled after reaction denial", { task_id: rxn_result.task_id, status: rxn_result.approval_status });
              }
            }
          }
          if (this.config.controlReactionEnabled) {
            this.handle_control_reactions(provider, rows);
          }

          const target_key = `${provider}:${target}`;
          if (!this.primed_targets.has(target_key)) {
            for (const row of rows) this.mark_seen(row);
            this.primed_targets.add(target_key);
            continue;
          }

          const sorted = [...rows].sort((a, b) => extract_ts(a) - extract_ts(b));
          for (const msg of sorted) {
            if (is_reaction_message(msg)) continue;
            if (this.is_duplicate(msg)) continue;
            this.mark_seen(msg);
            this.bus.publish_inbound(msg).catch((e) =>
              this.logger.debug("publish_inbound failed", { error: e instanceof Error ? e.message : String(e) }),
            );
          }
        } catch (e) {
          this.logger.error("poll failed", { provider, error: e instanceof Error ? e.message : String(e) });
        }
      }
      await sleep(this.config.pollIntervalMs);
    }
  }

  /** bus에서 인바운드 메시지를 소비하여 concurrency 제한 내에서 처리. */
  private async run_inbound_consumer(): Promise<void> {
    while (this.running) {
      const msg = await this.bus.consume_inbound({ timeout_ms: 2000 });
      if (!msg || !this.running) continue;

      this.inbound_active += 1;
      const task = this.handle_inbound_message(msg)
        .catch((e) => this.logger.error("inbound handler failed", { error: e instanceof Error ? e.message : String(e) }))
        .finally(() => {
          this.inbound_active = Math.max(0, this.inbound_active - 1);
          this.inbound_inflight.delete(task);
        });
      this.inbound_inflight.add(task);

      if (this.inbound_active >= this.config.inboundConcurrency && this.inbound_inflight.size > 0) {
        await Promise.race([...this.inbound_inflight].map((p) => p.catch(() => {})));
      }
    }
  }

  private async handle_mentions(provider: ChannelProvider, message: InboundMessage, aliases: string[]): Promise<void> {
    for (const alias of aliases) {
      if (message.sender_id.toLowerCase() === alias.toLowerCase()) continue;
      const cooldown_key = `${provider}:${message.chat_id}:${alias}`;
      const now = Date.now();
      if (now - (this.mention_cooldowns.get(cooldown_key) || 0) < 5_000) continue;
      this.mention_cooldowns.set(cooldown_key, now);
      await this.invoke_and_reply(provider, message, alias);
    }
  }

  private async invoke_and_reply(provider: ChannelProvider, message: InboundMessage, alias: string, resumed_task_id?: string): Promise<void> {
    const run_key = `${provider}:${message.chat_id}:${alias}`.toLowerCase();
    const prev = this.active_runs.get(run_key);
    if (prev && !prev.abort.signal.aborted) prev.abort.abort();

    const abort = new AbortController();
    this.active_runs.set(run_key, { abort, provider, chat_id: message.chat_id, alias });

    const run_id = this.tracker?.start({ provider, chat_id: message.chat_id, alias, sender_id: message.sender_id });

    const meta = (message.metadata && typeof message.metadata === "object") ? message.metadata as Record<string, unknown> : {};
    const anchor_ts = String(meta.message_id || message.id || "");
    const typing_ticker = setInterval(() => {
      this.registry.set_typing(provider, message.chat_id, true, anchor_ts).catch((e) =>
        this.logger.debug("typing_update_failed", { error: e instanceof Error ? e.message : String(e) }),
      );
    }, 4000);

    const stream_state = { message_id: "", last_update: 0, chain: Promise.resolve() };

    try {
      await this.recorder.record_user(provider, message, alias);
      const media_inputs = await this.media.collect(provider, message);
      const history = await this.recorder.get_history(
        provider, message.chat_id, alias, message.thread_id,
        12, this.config.sessionHistoryMaxAgeMs,
      );

      const result = await this.orchestration.execute({
        message, alias, provider, media_inputs,
        session_history: history,
        resumed_task_id,
        run_id,
        on_stream: (chunk) => {
          stream_state.chain = stream_state.chain
            .then(() => this.send_or_edit_stream(provider, message, alias, chunk, stream_state))
            .catch((e) => this.logger.debug("stream_update_failed", { error: e instanceof Error ? e.message : String(e) }));
        },
        on_progress: (event) => {
          this.bus.publish_progress(event).catch((e) =>
            this.logger.debug("progress_publish_failed", { error: e instanceof Error ? e.message : String(e) }),
          );
        },
        on_agent_event: this.on_agent_event || undefined,
        on_tool_block: (block) => {
          stream_state.chain = stream_state.chain
            .then(async () => {
              const profile = this.effective_render_profile(provider, message.chat_id);
              const rendered = render_agent_output(block, profile);
              const text = String(rendered.content || "").trim().slice(0, 700);
              if (!text) return;

              if (stream_state.message_id) {
                // 기존 스트림 메시지(실행 모드 라벨 등)를 툴 블록 내용으로 교체
                await this.registry.edit_message(
                  provider, message.chat_id, stream_state.message_id, text, rendered.parse_mode,
                );
                stream_state.message_id = "";
              } else {
                await this.send_outbound(provider, message, alias, text, {
                  kind: "tool_block", agent_alias: alias,
                  render_parse_mode: rendered.parse_mode || null,
                });
              }
            })
            .catch((e) => this.logger.debug("tool_block_send_failed", { error: e instanceof Error ? e.message : String(e) }));
        },
        signal: abort.signal,
      });

      if (run_id) {
        this.tracker!.set_tool_count(run_id, result.tool_calls_count);
        this.tracker!.end(run_id, result.error ? "failed" : "completed", result.error);
      }

      await stream_state.chain;
      await this.deliver_result(provider, message, alias, result, stream_state.message_id);
    } catch (e) {
      if (run_id) this.tracker!.end(run_id, "failed", e instanceof Error ? e.message : String(e));
      this.logger.error("invoke failed", { alias, error: e instanceof Error ? e.message : String(e) });
      await this.send_error_reply(provider, message, alias, e instanceof Error ? e.message : String(e), run_id);
    } finally {
      clearInterval(typing_ticker);
      const current = this.active_runs.get(run_key);
      if (current?.abort === abort) this.active_runs.delete(run_key);
    }
  }

  private async deliver_result(
    provider: ChannelProvider, message: InboundMessage, alias: string,
    result: OrchestrationResult, stream_message_id?: string,
  ): Promise<void> {
    if (result.suppress_reply) return;
    if (!result.reply) {
      if (result.error) await this.send_error_reply(provider, message, alias, result.error, result.run_id);
      return;
    }

    const rendered = this.render_reply(result.reply, provider, message.chat_id);
    const mention = format_mention(provider, message.sender_id);
    const final_text = `${mention}${rendered.content}`.trim();

    const record_meta = {
      stream_full_content: result.stream_full_content,
      parsed_output: result.parsed_output,
      tool_calls_count: result.tool_calls_count,
      run_id: result.run_id,
      usage: result.usage as Record<string, unknown> | undefined,
    };

    if (result.streamed && stream_message_id) {
      if (!this.config.streaming.suppressFinalAfterStream) {
        try {
          await this.registry.edit_message(provider, message.chat_id, stream_message_id, final_text, rendered.parse_mode);
        } catch (e) {
          this.logger.warn("edit_message_failed, sending as new message", { error: e instanceof Error ? e.message : String(e) });
          await this.send_outbound(provider, message, alias, final_text, { kind: "agent_reply", agent_alias: alias }, rendered.media);
        }
      }
      if (rendered.media.length > 0) {
        await this.send_outbound(provider, message, alias, "첨부 파일을 확인해주세요.", { kind: "agent_media", agent_alias: alias }, rendered.media);
      }
      await this.recorder.record_assistant(provider, message, alias, rendered.content, record_meta);
      return;
    }

    const outbound_meta: Record<string, unknown> = {
      kind: "agent_reply", agent_alias: alias,
      trigger_message_id: String((message.metadata as Record<string, unknown>)?.message_id || message.id || ""),
      render_mode: rendered.render_mode, render_parse_mode: rendered.parse_mode || null,
    };
    if (result.parsed_output !== undefined) outbound_meta.parsed_output = result.parsed_output;
    if (result.run_id) outbound_meta.run_id = result.run_id;
    if (result.usage) outbound_meta.usage = result.usage;

    await this.send_outbound(provider, message, alias, final_text, outbound_meta, rendered.media);
    await this.recorder.record_assistant(provider, message, alias, rendered.content, record_meta);
  }

  private async send_or_edit_stream(
    provider: ChannelProvider, message: InboundMessage, alias: string, content: string,
    state: { message_id: string; last_update: number },
  ): Promise<void> {
    const now = Date.now();
    if (now - state.last_update < 1200) return;
    const clipped = sanitize_provider_output(content).split("\n").slice(-12).join("\n").trim().slice(0, 700);
    if (!clipped) return;
    const profile = this.effective_render_profile(provider, message.chat_id);
    const rendered = render_agent_output(clipped, profile);
    const text = String(rendered.content || "").trim().slice(0, 700);
    if (!text) return;

    if (state.message_id) {
      try {
        await this.registry.edit_message(provider, message.chat_id, state.message_id, text, rendered.parse_mode);
      } catch (e) {
        this.logger.debug("stream_edit_failed", { error: e instanceof Error ? e.message : String(e) });
      }
    } else {
      const result = await this.dispatch.send(provider, {
        id: `stream-${Date.now()}`, provider, channel: provider, sender_id: alias,
        chat_id: message.chat_id, content: text, at: new Date().toISOString(),
        reply_to: resolve_reply_to(provider, message), thread_id: message.thread_id,
        metadata: { kind: "agent_stream", agent_alias: alias, render_mode: profile.mode, render_parse_mode: rendered.parse_mode || null },
      });
      if (result.ok && result.message_id) state.message_id = result.message_id;
    }
    state.last_update = now;
  }

  private render_reply(raw: string, provider: ChannelProvider, chat_id: string): {
    content: string; media: MediaItem[]; parse_mode?: "HTML"; render_mode: RenderMode;
  } {
    const profile = this.effective_render_profile(provider, chat_id);
    const cleaned = strip_sensitive_command_blocks(sanitize_provider_output(raw));
    const { content: text_content, media } = extract_media_items(cleaned, this.workspace_dir);
    const fallback = text_content || (media.length > 0 ? "첨부 파일을 확인해주세요." : "");
    const rendered = render_agent_output(fallback, profile);
    return {
      content: String(rendered.content || "").slice(0, 1600),
      media: media.slice(0, 4),
      parse_mode: rendered.parse_mode,
      render_mode: profile.mode,
    };
  }

  private effective_render_profile(provider: ChannelProvider, chat_id: string): RenderProfile {
    const profile = this.get_render_profile(provider, chat_id);
    if (provider !== "telegram" && profile.mode === "html") return { ...profile, mode: "markdown" };
    return profile;
  }

  private async send_error_reply(provider: ChannelProvider, message: InboundMessage, alias: string, error: string, run_id?: string): Promise<void> {
    const mention = format_mention(provider, message.sender_id);
    const reason = strip_secret_reference_tokens(normalize_error_detail(error));
    const content = `${mention}${alias} 작업 처리에 실패했습니다. (${reason})`.trim();
    await this.send_outbound(provider, message, alias, content, { kind: "agent_error", agent_alias: alias });
    await this.recorder.record_assistant(provider, message, alias, content, { run_id });
  }

  private async send_command_reply(provider: ChannelProvider, message: InboundMessage, content: string): Promise<void> {
    const profile = this.effective_render_profile(provider, message.chat_id);
    const rendered = render_agent_output(content, profile);
    const text = String(rendered.content || "").slice(0, 1600);
    await this.send_outbound(provider, message, this.config.defaultAlias, text, {
      kind: "command_reply", render_parse_mode: rendered.parse_mode || null,
    });
    await this.recorder.record_assistant(provider, message, this.config.defaultAlias, text);
  }

  private async send_outbound(
    provider: ChannelProvider, message: InboundMessage, sender_id: string, content: string,
    metadata: Record<string, unknown>, media?: MediaItem[], id_prefix?: string,
  ): Promise<void> {
    await this.dispatch.send(provider, {
      id: `${id_prefix || provider}-${Date.now()}`, provider, channel: provider, sender_id,
      chat_id: message.chat_id, content, media, at: new Date().toISOString(),
      reply_to: resolve_reply_to(provider, message), thread_id: message.thread_id, metadata,
    });
  }

  private async try_read_ack(provider: ChannelProvider, message: InboundMessage): Promise<void> {
    if (!this.config.readAckEnabled) return;
    const ts = String((message.metadata as Record<string, unknown>)?.message_id || message.id || "").trim();
    if (!ts) return;
    const channel = this.registry.get_channel(provider);
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
    const bot_id = _read_bot_ids().slack;
    for (const alias of raw) {
      const low = alias.toLowerCase();
      if (provider === "slack" && bot_id && low === bot_id) { out.add(this.config.defaultAlias); continue; }
      if (provider === "slack" && ["claude", "claude-worker", "worker"].includes(low)) { out.add(this.config.defaultAlias); continue; }
      out.add(alias);
    }
    return [...out];
  }

  private resolve_target(provider: ChannelProvider): string | null {
    const env_key = provider === "slack" ? "SLACK_DEFAULT_CHANNEL"
      : provider === "discord" ? "DISCORD_DEFAULT_CHANNEL"
      : provider === "telegram" ? "TELEGRAM_DEFAULT_CHAT_ID" : "";
    return String(process.env[env_key] || "").trim() || null;
  }

  private mark_seen(msg: InboundMessage): void {
    const key = seen_key(msg);
    if (key) this.seen.set(key, Date.now());
  }

  private is_duplicate(msg: InboundMessage): boolean {
    const key = seen_key(msg);
    return key ? this.seen.has(key) : false;
  }

  private prune_seen(): void {
    prune_ttl_map(this.seen, (ts) => ts, this.config.seenTtlMs, this.config.seenMaxSize);
    prune_ttl_map(this.control_reaction_seen, (ts) => ts, this.config.reactionActionTtlMs, this.config.seenMaxSize);
    this.approval.prune_seen(this.config.seenTtlMs, this.config.seenMaxSize);
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
          this.logger.error("control reaction cancel failed", { error: e instanceof Error ? e.message : String(e) }),
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
        at: new Date().toISOString(),
        reply_to,
        thread_id: row.thread_id,
        metadata: { kind: "control_reaction", action: "stop" },
      }).catch((e) =>
        this.logger.debug("control reaction reply failed", { error: e instanceof Error ? e.message : String(e) }),
      );
    }
  }
}


function is_reaction_message(message: InboundMessage): boolean {
  const meta = (message.metadata || {}) as Record<string, unknown>;
  return meta.is_reaction === true;
}

/** 환경변수에서 봇 ID를 매번 읽음. 캐싱하면 테스트·런타임 env 변경을 놓침. */
function _read_bot_ids(): Record<string, string> {
  return {
    slack: String(process.env.SLACK_BOT_USER_ID || "").trim().toLowerCase(),
    telegram: String(process.env.TELEGRAM_BOT_USER_ID || process.env.TELEGRAM_BOT_SELF_ID || "").trim().toLowerCase(),
    discord: String(process.env.DISCORD_BOT_USER_ID || process.env.DISCORD_BOT_SELF_ID || "").trim().toLowerCase(),
  };
}

function should_ignore(message: InboundMessage): boolean {
  const sender = String(message.sender_id || "").trim().toLowerCase();
  if (!sender || sender === "unknown" || sender.startsWith("subagent:") || sender === "approval-bot" || sender === "recovery") return true;
  const meta = (message.metadata || {}) as Record<string, unknown>;
  if (String(meta.kind || "").toLowerCase() === "task_recovery") return true;
  if (meta.from_is_bot === true) return true;
  const provider = resolve_provider(message);
  const bot_ids = _read_bot_ids();
  if (provider && bot_ids[provider] && sender === bot_ids[provider]) return true;

  const slack = (meta.slack && typeof meta.slack === "object") ? meta.slack as Record<string, unknown> : null;
  if (slack) {
    const subtype = String(slack.subtype || "").toLowerCase();
    if (typeof slack.bot_id === "string" && slack.bot_id.length > 0) return true;
    if (["bot_message", "message_changed", "message_deleted"].includes(subtype)) return true;
  }
  return false;
}

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

function normalize_error_detail(raw: string): string {
  const text = String(raw || "").replace(/\s+/g, " ").trim();
  if (!text) return "unknown_error";
  if (/unexpected argument/i.test(text)) return "executor_args_invalid";
  const m = text.match(/^Error calling ([A-Za-z0-9_-]+):\s*(.*)$/i);
  if (m) return `${String(m[1]).toLowerCase()}:${String(m[2] || "error").trim()}`.slice(0, 180);
  return text.slice(0, 180);
}

