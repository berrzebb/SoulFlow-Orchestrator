import type { MessageBus } from "../bus/index.js";
import type { InboundMessage, OutboundMessage, MediaItem } from "../bus/types.js";
import type { ProviderRegistry } from "../providers/index.js";
import type { AgentDomain } from "../agent/index.js";
import type { CronService } from "../cron/index.js";
import type { CronSchedule } from "../cron/types.js";
import type { SessionStore } from "../session/index.js";
import { parse_executor_preference, resolve_executor_provider } from "../providers/executor.js";
import { create_default_channels, type ChannelProvider, type ChannelRegistry } from "./index.js";
import { parse_slash_command_from_message, slash_name_in, slash_token_in, type ParsedSlashCommand } from "./slash-command.js";
import {
  default_render_profile,
  normalize_block_policy,
  normalize_render_mode,
  render_agent_output,
  type BlockPolicy,
  type RenderMode,
  type RenderProfile,
} from "./rendering.js";
import { existsSync, statSync } from "node:fs";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import type { TaskNode } from "../agent/loop.js";
import { redact_sensitive_text } from "../security/sensitive.js";
import { SecretVaultService } from "../security/secret-vault.js";
import { seal_inbound_sensitive_text } from "../security/inbound-seal.js";

export type ChannelManagerStatus = {
  running: boolean;
  dispatch_running: boolean;
  mention_loop_running: boolean;
  enabled_channels: ChannelProvider[];
};

type AgentRunResult = {
  reply: string | null;
  error?: string;
  stream_emitted_count?: number;
  stream_last_content?: string;
  stream_full_content?: string;
};

type StreamEmitState = {
  buffer: string;
  last_emit_at: number;
  emitted_count: number;
  last_content: string;
  full_content: string;
  last_sent_key: string;
  last_sent_at: number;
  last_source_chunk: string;
};

type CronQuickAction = "status" | "list" | "add" | "remove";

const STOP_COMMAND_ALIASES = ["stop", "cancel", "중지"] as const;
const HELP_COMMAND_ALIASES = ["help", "commands", "cmd", "도움말", "명령어"] as const;
const RENDER_ROOT_COMMAND_ALIASES = ["render", "format", "fmt", "렌더", "포맷"] as const;
const RENDER_STATUS_ARG_ALIASES = ["status", "show", "상태"] as const;
const RENDER_RESET_ARG_ALIASES = ["reset", "기본", "초기화"] as const;
const RENDER_LINK_ARG_ALIASES = ["link", "links", "링크"] as const;
const RENDER_IMAGE_ARG_ALIASES = ["image", "images", "img", "이미지"] as const;
const SECRET_ROOT_COMMAND_ALIASES = ["secret", "secrets", "vault", "비밀"] as const;
const SECRET_LIST_ARG_ALIASES = ["list", "ls", "목록"] as const;
const SECRET_STATUS_ARG_ALIASES = ["status", "show", "상태"] as const;
const SECRET_SET_ARG_ALIASES = ["set", "put", "저장"] as const;
const SECRET_GET_ARG_ALIASES = ["get", "cipher", "암호문"] as const;
const SECRET_REVEAL_ARG_ALIASES = ["reveal", "decrypt-name", "평문", "복호화"] as const;
const SECRET_REMOVE_ARG_ALIASES = ["remove", "rm", "delete", "삭제"] as const;
const SECRET_ENCRYPT_ARG_ALIASES = ["encrypt", "enc", "암호화"] as const;
const SECRET_DECRYPT_ARG_ALIASES = ["decrypt", "dec", "복호화문"] as const;
const CRON_ROOT_COMMAND_ALIASES = ["cron", "크론"] as const;
const CRON_STATUS_COMMAND_ALIASES = ["cron-status", "cron_status", "크론상태", "크론-상태"] as const;
const CRON_LIST_COMMAND_ALIASES = ["cron-list", "cron_list", "크론목록", "크론-목록"] as const;
const CRON_ADD_COMMAND_ALIASES = ["cron-add", "cron_add", "크론추가", "크론-추가"] as const;
const CRON_REMOVE_COMMAND_ALIASES = ["cron-remove", "cron_remove", "cron-delete", "cron_delete", "크론삭제", "크론-삭제"] as const;
const CRON_STATUS_ARG_ALIASES = ["status", "상태", "확인", "조회"] as const;
const CRON_LIST_ARG_ALIASES = ["jobs", "list", "목록", "리스트"] as const;
const CRON_ADD_ARG_ALIASES = ["add", "추가", "등록", "create"] as const;
const CRON_REMOVE_ARG_ALIASES = ["remove", "delete", "삭제", "제거"] as const;

export class ChannelManager {
  readonly bus: MessageBus;
  readonly registry: ChannelRegistry;
  readonly providers: ProviderRegistry | null;
  readonly agent: AgentDomain | null;
  readonly cron: CronService | null;
  readonly sessions: SessionStore | null;

  private running = false;
  private dispatch_abort: AbortController | null = null;
  private dispatch_task: Promise<void> | null = null;
  private mention_abort: AbortController | null = null;
  private mention_task: Promise<void> | null = null;
  private readonly mention_cooldowns = new Map<string, number>();
  private readonly auto_reply_on_plain_message: boolean;
  private readonly default_agent_alias: string;
  private readonly debug = String(process.env.CHANNEL_DEBUG || "").trim() === "1";
  private readonly read_ack_enabled = String(process.env.READ_ACK_ENABLED || "1").trim() !== "0";
  private readonly read_ack_reaction = String(process.env.READ_ACK_REACTION || "eyes").trim() || "eyes";
  private readonly poll_interval_ms: number;
  private readonly read_limit: number;
  private readonly targets: Partial<Record<ChannelProvider, string>>;
  private readonly seen = new Map<string, number>();
  private readonly primed_targets = new Set<string>();
  private readonly active_runs = new Map<string, { abort: AbortController; provider: ChannelProvider; chat_id: string; alias: string }>();
  private readonly progress_pulse_enabled: boolean;
  private readonly stream_emit_enabled: boolean;
  private readonly stream_emit_interval_ms: number;
  private readonly stream_emit_min_chars: number;
  private readonly status_notice_enabled: boolean;
  private readonly grouping_enabled: boolean;
  private readonly grouping_window_ms: number;
  private readonly grouping_max_messages: number;
  private readonly seen_ttl_ms: number;
  private readonly seen_max_size: number;
  private readonly workspace_dir: string;
  private readonly send_inline_retries: number;
  private readonly dispatch_retry_max: number;
  private readonly dispatch_retry_base_ms: number;
  private readonly dispatch_retry_max_ms: number;
  private readonly dispatch_retry_jitter_ms: number;
  private readonly dispatch_dlq_enabled: boolean;
  private readonly dispatch_dlq_path: string;
  private dlq_write_queue: Promise<void> = Promise.resolve();
  private readonly approval_reaction_enabled: boolean;
  private readonly control_reaction_enabled: boolean;
  private readonly reaction_action_ttl_ms: number;
  private readonly reaction_actions_seen = new Map<string, number>();
  private readonly session_history_max_age_ms: number;
  private readonly suppress_final_after_stream: boolean;
  private readonly render_profiles = new Map<string, RenderProfile>();
  private readonly secret_vault: SecretVaultService;

  constructor(args: {
    bus: MessageBus;
    registry?: ChannelRegistry;
    provider_hint?: string;
    providers?: ProviderRegistry | null;
    agent?: AgentDomain | null;
    cron?: CronService | null;
    sessions?: SessionStore | null;
    auto_reply_on_plain_message?: boolean;
    default_agent_alias?: string;
    poll_interval_ms?: number;
    read_limit?: number;
    targets?: Partial<Record<ChannelProvider, string>>;
  }) {
    this.bus = args.bus;
    this.registry = args.registry || create_default_channels(args.provider_hint);
    this.providers = args.providers || null;
    this.agent = args.agent || null;
    this.cron = args.cron || null;
    this.sessions = args.sessions || null;
    this.auto_reply_on_plain_message = args.auto_reply_on_plain_message ?? (String(process.env.CHANNEL_AUTO_REPLY || "1") !== "0");
    this.default_agent_alias = args.default_agent_alias || String(process.env.DEFAULT_AGENT_ALIAS || "assistant");
    this.poll_interval_ms = Math.max(500, Number(args.poll_interval_ms || 2000));
    this.read_limit = Math.max(1, Math.min(100, Number(args.read_limit || 30)));
    this.targets = args.targets || {};
    this.workspace_dir = resolve(String(process.env.WORKSPACE_DIR || process.cwd()));
    this.progress_pulse_enabled = String(process.env.CHANNEL_PROGRESS_PULSE || "0").trim() === "1";
    this.stream_emit_enabled = String(process.env.CHANNEL_STREAMING_ENABLED || "1").trim() !== "0";
    this.stream_emit_interval_ms = Math.max(500, Number(process.env.CHANNEL_STREAMING_INTERVAL_MS || 1400));
    this.stream_emit_min_chars = Math.max(16, Number(process.env.CHANNEL_STREAMING_MIN_CHARS || 48));
    this.status_notice_enabled = String(process.env.CHANNEL_STATUS_NOTICE || "0").trim() === "1";
    this.grouping_enabled = String(process.env.CHANNEL_GROUPING_ENABLED || "0").trim() !== "0";
    this.grouping_window_ms = Math.max(500, Number(process.env.CHANNEL_GROUPING_WINDOW_MS || 3500));
    this.grouping_max_messages = Math.max(2, Number(process.env.CHANNEL_GROUPING_MAX_MESSAGES || 8));
    this.seen_ttl_ms = Math.max(60_000, Number(process.env.CHANNEL_SEEN_TTL_MS || 86_400_000));
    this.seen_max_size = Math.max(2_000, Number(process.env.CHANNEL_SEEN_MAX_SIZE || 50_000));
    this.send_inline_retries = Math.max(0, Number(process.env.CHANNEL_MANAGER_INLINE_RETRIES || 0));
    this.dispatch_retry_max = Math.max(0, Number(process.env.CHANNEL_DISPATCH_RETRY_MAX || 3));
    this.dispatch_retry_base_ms = Math.max(100, Number(process.env.CHANNEL_DISPATCH_RETRY_BASE_MS || 700));
    this.dispatch_retry_max_ms = Math.max(this.dispatch_retry_base_ms, Number(process.env.CHANNEL_DISPATCH_RETRY_MAX_MS || 25_000));
    this.dispatch_retry_jitter_ms = Math.max(0, Number(process.env.CHANNEL_DISPATCH_RETRY_JITTER_MS || 250));
    this.dispatch_dlq_enabled = String(process.env.CHANNEL_DISPATCH_DLQ_ENABLED || "1").trim() !== "0";
    this.dispatch_dlq_path = resolve(
      String(
        process.env.CHANNEL_DISPATCH_DLQ_PATH
        || join(this.workspace_dir, "runtime", "dlq", "outbound.jsonl"),
      ),
    );
    this.approval_reaction_enabled = String(process.env.APPROVAL_REACTION_ENABLED || "1").trim() !== "0";
    this.control_reaction_enabled = String(process.env.CONTROL_REACTION_ENABLED || "1").trim() !== "0";
    this.reaction_action_ttl_ms = Math.max(60_000, Number(process.env.REACTION_ACTION_TTL_MS || 86_400_000));
    this.session_history_max_age_ms = Math.max(0, Number(process.env.CHANNEL_SESSION_HISTORY_MAX_AGE_MS || 1_800_000));
    this.suppress_final_after_stream = String(process.env.CHANNEL_SUPPRESS_FINAL_AFTER_STREAM || "1").trim() !== "0";
    this.secret_vault = new SecretVaultService(this.workspace_dir);
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.registry.start_all();
    await this.start_dispatch_loop();
    await this.start_mention_loop();
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.stop_dispatch_loop();
    await this.stop_mention_loop();
    await this.registry.stop_all();
  }

  async start_dispatch_loop(): Promise<void> {
    if (this.dispatch_task) return;
    const controller = new AbortController();
    this.dispatch_abort = controller;
    this.dispatch_task = this.run_dispatch_loop(controller.signal);
  }

  async stop_dispatch_loop(): Promise<void> {
    this.dispatch_abort?.abort();
    this.dispatch_abort = null;
    if (this.dispatch_task) {
      try {
        await this.dispatch_task;
      } catch {
        // ignore cancellation
      }
    }
    this.dispatch_task = null;
  }

  async start_mention_loop(): Promise<void> {
    if (this.mention_task) return;
    const controller = new AbortController();
    this.mention_abort = controller;
    this.mention_task = this.run_mention_loop(controller.signal);
  }

  async stop_mention_loop(): Promise<void> {
    this.mention_abort?.abort();
    this.mention_abort = null;
    if (this.mention_task) {
      try {
        await this.mention_task;
      } catch {
        // ignore cancellation
      }
    }
    this.mention_task = null;
  }

  private async run_dispatch_loop(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      const outbound = await this.bus.consume_outbound({ timeout_ms: 1000 });
      if (!outbound) continue;
      if (signal.aborted) return;
      await this.dispatch_outbound(outbound);
    }
  }

  private async run_mention_loop(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      const providers = this.registry.list_channels().map((c) => c.provider);
      for (const provider of providers) {
        if (signal.aborted) return;
        this.prune_seen_cache(false);
        this.prune_reaction_actions_seen(false);
        const target = this.resolve_target(provider);
        if (!target) continue;
        try {
          const rows = await this.registry.read(provider, target, this.read_limit);
          await this.try_handle_reaction_controls(provider, rows);
          const target_key = `${provider}:${target}`;
          if (!this.primed_targets.has(target_key)) {
            for (const row of rows) this.mark_seen(row);
            this.primed_targets.add(target_key);
            continue;
          }
          const sorted = [...rows].sort((a, b) => this.extract_timestamp_ms(a) - this.extract_timestamp_ms(b));
          const fresh: InboundMessage[] = [];
          for (const inbound of sorted) {
            if (this.is_duplicate(inbound)) continue;
            this.mark_seen(inbound);
            fresh.push(inbound);
          }
          const grouped = this.grouping_enabled
            ? this.group_inbound_messages(fresh)
            : fresh;
          for (const inbound of grouped) {
            queueMicrotask(() => {
              void this.handle_inbound_message(inbound).catch((error) => {
                // eslint-disable-next-line no-console
                console.error(`[channel-manager] inbound handler failed: ${error instanceof Error ? error.message : String(error)}`);
              });
            });
          }
        } catch (error) {
          // eslint-disable-next-line no-console
          console.error(`[channel-manager] poll failed provider=${provider} err=${error instanceof Error ? error.message : String(error)}`);
        }
      }
      await new Promise<void>((resolve) => setTimeout(resolve, this.poll_interval_ms));
    }
  }

  async dispatch_outbound(message: OutboundMessage): Promise<void> {
    const provider = this.resolve_provider(message);
    if (!provider) return;
    const sent = await this.send_with_retry(provider, message, {
      allow_requeue: true,
      source: "dispatch",
    });
    if (!sent.ok && this.debug) {
      // eslint-disable-next-line no-console
      console.log(`[channel-manager] dispatch send failed provider=${provider} err=${sent.error || "unknown_error"}`);
    }
  }

  async read_channel(provider: ChannelProvider, chat_id: string, limit?: number): Promise<InboundMessage[]> {
    return this.registry.read(provider, chat_id, limit);
  }

  async route_agent_reply(args: {
    provider: ChannelProvider;
    chat_id: string;
    agent_alias: string;
    content: string;
    media?: OutboundMessage["media"];
    mention_sender?: boolean;
    sender_alias?: string;
    limit?: number;
    metadata?: Record<string, unknown>;
  }): Promise<{ ok: boolean; message_id?: string; error?: string }> {
    return this.registry.reply_as_agent(
      args.provider,
      args.chat_id,
      args.agent_alias,
      args.content,
      {
        mention_sender: args.mention_sender,
        sender_alias: args.sender_alias,
        limit: args.limit,
        media: args.media,
        metadata: args.metadata,
      },
    );
  }

  async handle_inbound_message(message: InboundMessage): Promise<void> {
    const ignore = this.should_ignore_inbound(message);
    if (ignore) {
      if (this.debug) {
        // eslint-disable-next-line no-console
        console.log(`[channel-manager] ignore sender=${message.sender_id} provider=${message.provider} id=${String(message.metadata?.message_id || message.id || "")}`);
      }
      return;
    }
    const provider = this.resolve_channel_provider(message);
    if (!provider) return;
    const approval_handled = await this.try_handle_approval_reply(provider, message);
    if (approval_handled) return;
    const slash_command = parse_slash_command_from_message(message);
    const slash_handled = await this.try_handle_common_slash_command(provider, message, slash_command);
    if (slash_handled) return;
    await this.try_read_ack(provider, message);
    if (this.debug) {
      // eslint-disable-next-line no-console
      console.log(`[channel-manager] inbound provider=${provider} sender=${message.sender_id} id=${String(message.metadata?.message_id || message.id || "")} text=${String(message.content || "").slice(0, 80)}`);
    }
    await this.registry.set_typing(provider, message.chat_id, true);
    try {
      const mentionsHandled = await this.handle_agent_mentions(message);
      if (mentionsHandled > 0) return;
      if (!this.auto_reply_on_plain_message) return;
      if (!this.providers) return;
      const sender = String(message.sender_id || "").toLowerCase();
      if (!sender || sender.startsWith("subagent:") || sender === "approval-bot") return;
      await this.record_user_message(provider, message, this.default_agent_alias);

      await this.send_status_notice(provider, message, "start", this.default_agent_alias);
      const result = await this.invoke_headless_agent(message, this.default_agent_alias);
      if (!result.reply) {
        await this.send_status_notice(provider, message, "failed", this.default_agent_alias, result.error);
        return;
      }
      const rendered = this.build_user_render_payload(result.reply, provider, message.chat_id);
      if (this.should_suppress_final_after_stream_send(provider, result)) {
        await this.record_assistant_message(
          provider,
          message,
          this.default_agent_alias,
          rendered.content || String(result.reply || ""),
        );
        await this.send_status_notice(provider, message, "done", this.default_agent_alias);
        return;
      }
      const plainContent = provider === "telegram"
        ? rendered.content
        : `@${message.sender_id} ${rendered.content}`.trim();
      const sent = await this.registry.send(provider, {
        id: `${provider}-${Date.now()}`,
        provider,
        channel: provider,
        sender_id: this.default_agent_alias,
        chat_id: message.chat_id,
        content: plainContent,
        media: rendered.media,
        at: new Date().toISOString(),
        reply_to: this.resolve_reply_to(provider, message),
        thread_id: message.thread_id,
        metadata: {
          kind: "agent_reply",
          agent_alias: this.default_agent_alias,
          trigger_message_id: String(message.metadata?.message_id || message.id || ""),
          render_mode: rendered.render_mode,
          render_parse_mode: rendered.parse_mode || null,
        },
      });
      if (!sent.ok) {
        // eslint-disable-next-line no-console
        console.error(`[channel-manager] plain auto reply failed: ${sent.error || "unknown_error"}`);
        await this.send_status_notice(provider, message, "failed", this.default_agent_alias);
      } else if (this.debug) {
        // eslint-disable-next-line no-console
        console.log(`[channel-manager] plain auto reply sent message_id=${sent.message_id || ""}`);
      }
      if (sent.ok) {
        await this.record_assistant_message(provider, message, this.default_agent_alias, rendered.content);
        await this.send_status_notice(provider, message, "done", this.default_agent_alias);
      }
    } finally {
      await this.registry.set_typing(provider, message.chat_id, false);
    }
  }

  async handle_agent_mentions(message: InboundMessage): Promise<number> {
    if (this.should_ignore_inbound(message)) return 0;
    if (!this.providers) return 0;
    const provider = this.resolve_channel_provider(message);
    if (!provider) return 0;
    const channel = this.registry.get_channel(provider);
    if (!channel) return 0;
    const mentions = this.extract_mentions(channel, message);
    if (this.debug) {
      // eslint-disable-next-line no-console
      console.log(`[channel-manager] mentions parsed=${mentions.join(",") || "(none)"} sender=${message.sender_id}`);
    }
    if (mentions.length === 0) return 0;

    let handled = 0;

    for (const alias of mentions) {
      if (!alias) continue;
      if (message.sender_id.toLowerCase() === alias.toLowerCase()) continue;
      const cooldown_key = `${provider}:${message.chat_id}:${alias}`;
      const now = Date.now();
      const previous = this.mention_cooldowns.get(cooldown_key) || 0;
      if (now - previous < 5_000) continue;
      this.mention_cooldowns.set(cooldown_key, now);
      await this.send_status_notice(provider, message, "start", alias);
      const result = await this.invoke_headless_agent(message, alias);
      if (!result.reply) {
        await this.send_status_notice(provider, message, "failed", alias, result.error);
        continue;
      }
      const rendered = this.build_user_render_payload(result.reply, provider, message.chat_id);
      if (this.should_suppress_final_after_stream_send(provider, result)) {
        await this.record_assistant_message(
          provider,
          message,
          alias,
          rendered.content || String(result.reply || ""),
        );
        await this.send_status_notice(provider, message, "done", alias);
        handled += 1;
        continue;
      }
      const routed = await this.route_agent_reply({
        provider,
        chat_id: message.chat_id,
        agent_alias: alias,
        content: rendered.content,
        media: rendered.media,
        mention_sender: true,
        sender_alias: message.sender_id,
        limit: 50,
        metadata: {
          render_mode: rendered.render_mode,
          render_parse_mode: rendered.parse_mode || null,
        },
      });
      if (!routed.ok) {
        // eslint-disable-next-line no-console
        console.error(`[channel-manager] mention reply failed alias=${alias} err=${routed.error || "unknown_error"}`);
        await this.send_status_notice(provider, message, "failed", alias);
        continue;
      }
      await this.record_assistant_message(provider, message, alias, rendered.content);
      if (this.debug) {
        // eslint-disable-next-line no-console
        console.log(`[channel-manager] mention reply sent alias=${alias} message_id=${routed.message_id || ""}`);
      }
      await this.send_status_notice(provider, message, "done", alias);
      handled += 1;
    }
    return handled;
  }

  get_status(): ChannelManagerStatus {
    return {
      running: this.running,
      dispatch_running: Boolean(this.dispatch_task),
      mention_loop_running: Boolean(this.mention_task),
      enabled_channels: this.registry.list_channels().map((c) => c.provider),
    };
  }

  private async sleep(ms: number): Promise<void> {
    const delay = Math.max(0, Number(ms || 0));
    if (delay <= 0) return;
    await new Promise<void>((resolve) => setTimeout(resolve, delay));
  }

  private compute_retry_delay_ms(retry_count: number): number {
    const count = Math.max(1, Number(retry_count || 1));
    const exp = this.dispatch_retry_base_ms * (2 ** (count - 1));
    const capped = Math.min(this.dispatch_retry_max_ms, exp);
    const jitter = this.dispatch_retry_jitter_ms > 0
      ? Math.floor(Math.random() * this.dispatch_retry_jitter_ms)
      : 0;
    return capped + jitter;
  }

  private is_retryable_send_error(error: string): boolean {
    const raw = String(error || "").trim().toLowerCase();
    if (!raw) return true;
    if (raw.includes("invalid_auth")) return false;
    if (raw.includes("not_authed")) return false;
    if (raw.includes("channel_not_found")) return false;
    if (raw.includes("chat_id_required")) return false;
    if (raw.includes("bot_token_missing")) return false;
    if (raw.includes("permission_denied")) return false;
    if (raw.includes("invalid_arguments")) return false;
    return true;
  }

  private get_dispatch_retry_count(message: OutboundMessage): number {
    const meta = (message.metadata || {}) as Record<string, unknown>;
    return Math.max(0, Number(meta.dispatch_retry || 0));
  }

  private clone_outbound_message(message: OutboundMessage): OutboundMessage {
    return {
      ...message,
      media: Array.isArray(message.media) ? [...message.media] : [],
      metadata: { ...(message.metadata || {}) },
    };
  }

  private async schedule_dispatch_retry(
    provider: ChannelProvider,
    message: OutboundMessage,
    retry_count: number,
    error: string,
  ): Promise<void> {
    const delay_ms = this.compute_retry_delay_ms(retry_count);
    const retry_message = this.clone_outbound_message(message);
    retry_message.metadata = {
      ...(retry_message.metadata || {}),
      dispatch_retry: retry_count,
      dispatch_error: error,
      dispatch_retry_at: new Date(Date.now() + delay_ms).toISOString(),
    };
    setTimeout(() => {
      void this.bus.publish_outbound(retry_message);
    }, delay_ms);
    if (this.debug) {
      // eslint-disable-next-line no-console
      console.log(
        `[channel-manager] dispatch requeue provider=${provider} retry=${retry_count}/${this.dispatch_retry_max} delay_ms=${delay_ms} err=${error || "unknown_error"}`,
      );
    }
  }

  private async append_dispatch_dlq(
    provider: ChannelProvider,
    message: OutboundMessage,
    error: string,
    retry_count: number,
  ): Promise<void> {
    if (!this.dispatch_dlq_enabled) return;
    const record = {
      at: new Date().toISOString(),
      provider,
      chat_id: String(message.chat_id || ""),
      message_id: String(message.id || ""),
      sender_id: String(message.sender_id || ""),
      reply_to: String(message.reply_to || ""),
      thread_id: String(message.thread_id || ""),
      retry_count,
      error: String(error || "unknown_error"),
      content: String(message.content || "").slice(0, 4000),
      metadata: message.metadata || {},
    };
    const path = this.dispatch_dlq_path;
    const write_job = this.dlq_write_queue.then(async () => {
      await mkdir(dirname(path), { recursive: true });
      await appendFile(path, `${JSON.stringify(record)}\n`, "utf-8");
    });
    this.dlq_write_queue = write_job.then(() => undefined, () => undefined);
    try {
      await write_job;
    } catch (error2) {
      // eslint-disable-next-line no-console
      console.error(`[channel-manager] dlq append failed path=${path} err=${error2 instanceof Error ? error2.message : String(error2)}`);
    }
  }

  private async send_with_retry(
    provider: ChannelProvider,
    message: OutboundMessage,
    options?: { allow_requeue?: boolean; source?: string },
  ): Promise<{ ok: boolean; message_id?: string; error?: string }> {
    const inline_attempts = Math.max(1, this.send_inline_retries + 1);
    let last_error = "";
    for (let attempt = 1; attempt <= inline_attempts; attempt += 1) {
      const sent = await this.registry.send(provider, message);
      if (sent.ok) return sent;
      last_error = String(sent.error || "unknown_error");
      if (!this.is_retryable_send_error(last_error)) break;
      if (attempt < inline_attempts) {
        await this.sleep(this.compute_retry_delay_ms(attempt));
      }
    }

    const dispatch_retry = this.get_dispatch_retry_count(message);
    if (options?.allow_requeue && dispatch_retry < this.dispatch_retry_max && this.is_retryable_send_error(last_error)) {
      await this.schedule_dispatch_retry(provider, message, dispatch_retry + 1, last_error);
      return { ok: false, error: `requeued_retry_${dispatch_retry + 1}:${last_error}` };
    }

    if (options?.allow_requeue && dispatch_retry >= this.dispatch_retry_max) {
      await this.append_dispatch_dlq(provider, message, last_error || "send_failed", dispatch_retry);
    }
    return { ok: false, error: last_error || "send_failed" };
  }

  private extract_mentions(channel: { parse_agent_mentions: (content: string) => Array<{ alias: string }> }, message: InboundMessage): string[] {
    const meta_mentions = Array.isArray((message.metadata as Record<string, unknown> | undefined)?.mentions)
      ? ((message.metadata as Record<string, unknown>).mentions as Array<Record<string, unknown>>)
          .map((m) => String(m.alias || "").trim())
          .filter(Boolean)
      : [];
    if (meta_mentions.length > 0) return this.normalize_mentions(meta_mentions, message);
    const parsed = channel.parse_agent_mentions(String(message.content || ""));
    return this.normalize_mentions(parsed.map((m) => m.alias).filter(Boolean), message);
  }

  private resolve_channel_provider(message: InboundMessage): ChannelProvider | null {
    const raw = String(message.provider || message.channel || "").toLowerCase();
    if (raw === "slack" || raw === "discord" || raw === "telegram") return raw;
    return null;
  }

  private normalize_mentions(aliases: string[], message: InboundMessage): string[] {
    const provider = this.resolve_channel_provider(message);
    const slack_bot_user_id = String(process.env.SLACK_BOT_USER_ID || "").trim().toLowerCase();
    const out = new Set<string>();
    for (const raw of aliases) {
      const alias = String(raw || "").trim();
      if (!alias) continue;
      const low = alias.toLowerCase();
      if (provider === "slack") {
        if (slack_bot_user_id && low === slack_bot_user_id) {
          out.add(this.default_agent_alias);
          continue;
        }
        if (low === "claude" || low === "claude-worker" || low === "worker") {
          out.add(this.default_agent_alias);
          continue;
        }
      }
      out.add(alias);
    }
    return [...out];
  }

  private async try_read_ack(provider: ChannelProvider, message: InboundMessage): Promise<void> {
    if (!this.read_ack_enabled) return;
    if (provider !== "slack") return;
    const timestamps = new Set<string>();
    const ts = String(message.metadata?.message_id || message.id || "").trim();
    if (ts) timestamps.add(ts);
    const grouped = Array.isArray(message.metadata?.grouped_message_ids)
      ? (message.metadata?.grouped_message_ids as unknown[])
      : [];
    for (const row of grouped) {
      const v = String(row || "").trim();
      if (v) timestamps.add(v);
    }
    if (timestamps.size === 0) return;
    const channel = this.registry.get_channel("slack") as unknown as {
      add_reaction?: (chat_id: string, timestamp: string, reaction: string) => Promise<{ ok: boolean; error?: string }>;
    } | null;
    if (!channel?.add_reaction) return;
    for (const timestamp of timestamps) {
      const result = await channel.add_reaction(message.chat_id, timestamp, this.read_ack_reaction);
      if (!result.ok && this.debug) {
        // eslint-disable-next-line no-console
        console.log(`[channel-manager] read-ack failed ts=${timestamp} err=${result.error || "unknown_error"}`);
      }
    }
  }

  private group_inbound_messages(messages: InboundMessage[]): InboundMessage[] {
    if (!this.grouping_enabled) return messages;
    if (messages.length <= 1) return messages;
    const out: InboundMessage[] = [];
    let current: InboundMessage[] = [];
    const flush = (): void => {
      if (current.length === 0) return;
      out.push(this.merge_inbound_group(current));
      current = [];
    };

    for (const message of messages) {
      if (current.length === 0) {
        current.push(message);
        continue;
      }
      const prev = current[current.length - 1];
      if (this.can_group_messages(prev, message, current.length)) {
        current.push(message);
        continue;
      }
      flush();
      current.push(message);
    }
    flush();
    return out;
  }

  private can_group_messages(prev: InboundMessage, next: InboundMessage, current_group_size: number): boolean {
    if (current_group_size >= this.grouping_max_messages) return false;
    if (String(prev.provider || "") !== String(next.provider || "")) return false;
    if (String(prev.chat_id || "") !== String(next.chat_id || "")) return false;
    if (String(prev.sender_id || "") !== String(next.sender_id || "")) return false;
    if (String(prev.thread_id || "") !== String(next.thread_id || "")) return false;
    if (this.is_grouping_boundary_message(prev) || this.is_grouping_boundary_message(next)) return false;

    const prev_ms = this.extract_timestamp_ms(prev) || Date.parse(String(prev.at || "")) || 0;
    const next_ms = this.extract_timestamp_ms(next) || Date.parse(String(next.at || "")) || 0;
    if (prev_ms <= 0 || next_ms <= 0) return false;
    return (next_ms - prev_ms) <= this.grouping_window_ms;
  }

  private is_grouping_boundary_message(message: InboundMessage): boolean {
    if (parse_slash_command_from_message(message)) return true;
    const text = String(message.content || "").trim();
    if (!text) return false;
    // Treat normal sentences as standalone requests to prevent accidental multi-task merges.
    if (/\s/.test(text)) return true;
    if (/^\//.test(text)) return true;
    if (/^(?:✅|❌|👍|👎|⏸️)\s*$/.test(text)) return true;
    if (/^(yes|no|승인|거절|보류|later|stop)$/i.test(text)) return true;
    return false;
  }

  private merge_inbound_group(group: InboundMessage[]): InboundMessage {
    if (group.length <= 1) return group[0];
    const last = group[group.length - 1];
    const grouped_ids = group
      .map((m) => String(m.metadata?.message_id || m.id || "").trim())
      .filter(Boolean);
    const merged_content = group
      .map((m) => String(m.content || "").trim())
      .filter(Boolean)
      .join("\n");
    const merged_media = group
      .flatMap((m) => Array.isArray(m.media) ? m.media : [])
      .slice(0, 16);

    return {
      ...last,
      content: merged_content || String(last.content || ""),
      media: merged_media,
      metadata: {
        ...(last.metadata || {}),
        grouped: true,
        grouped_count: group.length,
        grouped_message_ids: grouped_ids,
      },
    };
  }

  private should_ignore_inbound(message: InboundMessage): boolean {
    const provider = this.resolve_channel_provider(message);
    const sender = String(message.sender_id || "").trim().toLowerCase();
    if (!sender || sender === "unknown" || sender.startsWith("subagent:") || sender === "approval-bot") return true;

    const meta = (message.metadata || {}) as Record<string, unknown>;
    if (meta.from_is_bot === true) return true;

    const slack_bot_user_id = String(process.env.SLACK_BOT_USER_ID || "").trim().toLowerCase();
    const telegram_bot_user_id = String(
      process.env.TELEGRAM_BOT_USER_ID
      || process.env.TELEGRAM_BOT_SELF_ID
      || "",
    ).trim().toLowerCase();
    const discord_bot_user_id = String(
      process.env.DISCORD_BOT_USER_ID
      || process.env.DISCORD_BOT_SELF_ID
      || "",
    ).trim().toLowerCase();
    if (provider === "slack" && slack_bot_user_id && sender === slack_bot_user_id) return true;
    if (provider === "telegram" && telegram_bot_user_id && sender === telegram_bot_user_id) return true;
    if (provider === "discord" && discord_bot_user_id && sender === discord_bot_user_id) return true;

    const slack = (meta.slack && typeof meta.slack === "object") ? (meta.slack as Record<string, unknown>) : null;
    if (!slack) return false;

    const subtype = String(slack.subtype || "").toLowerCase();
    const has_bot_id = typeof slack.bot_id === "string" && slack.bot_id.length > 0;
    if (has_bot_id) return true;
    if (subtype === "bot_message" || subtype === "message_changed" || subtype === "message_deleted") return true;
    return false;
  }

  private create_stream_emit_state(): StreamEmitState {
    return {
      buffer: "",
      last_emit_at: 0,
      emitted_count: 0,
      last_content: "",
      full_content: "",
      last_sent_key: "",
      last_sent_at: 0,
      last_source_chunk: "",
    };
  }

  private overlap_suffix_prefix(a: string, b: string, max_scan = 280): number {
    const left = String(a || "");
    const right = String(b || "");
    if (!left || !right) return 0;
    const limit = Math.max(1, Math.min(max_scan, left.length, right.length));
    for (let n = limit; n >= 1; n -= 1) {
      if (left.slice(left.length - n) === right.slice(0, n)) return n;
    }
    return 0;
  }

  private normalize_stream_delta(state: StreamEmitState, raw: string): string {
    const incoming = String(raw || "").trim();
    if (!incoming) return "";
    const prev = String(state.last_source_chunk || "");
    const remember = (v: string): void => {
      state.last_source_chunk = String(v || "").slice(-4000);
    };
    if (!prev) {
      remember(incoming);
      return incoming;
    }
    if (incoming === prev) return "";
    if (incoming.startsWith(prev)) {
      remember(incoming);
      return incoming.slice(prev.length).trimStart();
    }
    if (prev.startsWith(incoming)) return "";
    const overlap = this.overlap_suffix_prefix(prev, incoming);
    remember(incoming);
    if (overlap > 0) return incoming.slice(overlap).trimStart();
    return incoming;
  }

  private append_stream_history(base: string, chunk: string): string {
    const merged = `${String(base || "")}\n${String(chunk || "")}`.trim();
    return merged.slice(Math.max(0, merged.length - 8000));
  }

  private should_skip_stream_emit(state: StreamEmitState, content: string): boolean {
    const key = String(content || "").replace(/\s+/g, " ").trim().toLowerCase();
    if (!key) return true;
    const now = Date.now();
    if (key === state.last_sent_key && now - state.last_sent_at < 30_000) return true;
    state.last_sent_key = key;
    state.last_sent_at = now;
    return false;
  }

  private mark_stream_emitted(state: StreamEmitState, content: string): void {
    state.emitted_count += 1;
    state.last_content = content;
    state.full_content = this.append_stream_history(state.full_content, content);
  }

  private async send_stream_content(
    provider: ChannelProvider,
    message: InboundMessage,
    alias: string,
    rendered: { content: string; parse_mode?: "HTML"; render_mode: RenderMode },
    log_tag: string,
  ): Promise<void> {
    const sent = await this.registry.send(provider, {
      id: `stream-${Date.now()}`,
      provider,
      channel: provider,
      sender_id: alias,
      chat_id: message.chat_id,
      content: rendered.content,
      at: new Date().toISOString(),
      reply_to: this.resolve_reply_to(provider, message),
      thread_id: message.thread_id,
      metadata: {
        kind: "agent_stream",
        agent_alias: alias,
        render_mode: rendered.render_mode,
        render_parse_mode: rendered.parse_mode || null,
      },
    });
    if (!sent.ok && this.debug) {
      // eslint-disable-next-line no-console
      console.log(`[channel-manager] ${log_tag} provider=${provider} alias=${alias} err=${sent.error || "unknown_error"}`);
    }
  }

  private stream_result(state: StreamEmitState): Pick<AgentRunResult, "stream_emitted_count" | "stream_last_content" | "stream_full_content"> {
    return {
      stream_emitted_count: state.emitted_count,
      stream_last_content: state.last_content,
      stream_full_content: state.full_content,
    };
  }

  private async invoke_headless_agent(
    message: InboundMessage,
    alias: string,
  ): Promise<AgentRunResult> {
    const channel_provider = this.resolve_channel_provider(message);
    if (!channel_provider) return { reply: null, error: "unknown_channel_provider" };
    const orchestrator = this.providers!;
    const agent_domain = this.agent;
    if (!agent_domain) {
      // eslint-disable-next-line no-console
      console.error("[channel-manager] invoke failed: agent_domain_not_configured");
      return { reply: null, error: "agent_domain_not_configured" };
    }
    const preferred_executor = (
      parse_executor_preference(String(process.env.ORCH_EXECUTOR_PROVIDER || "chatgpt"))
    );
    const default_executor = resolve_executor_provider(preferred_executor);
    const run_key = `${channel_provider}:${message.chat_id}:${alias}`.toLowerCase();
    const abort = new AbortController();
    this.active_runs.set(run_key, { abort, provider: channel_provider, chat_id: message.chat_id, alias });
    let live_preview = "";
    const stream_state = this.create_stream_emit_state();
    const started_at_ms = Date.now();
    const typingTicker = setInterval(() => {
      void this.registry.set_typing(channel_provider, message.chat_id, true);
    }, 4000);
    const pulse_enabled = this.progress_pulse_enabled;
    const pulseTicker = pulse_enabled
      ? setInterval(() => {
          const elapsed_sec = Math.max(1, Math.floor((Date.now() - started_at_ms) / 1000));
          const preview = live_preview ? ` | ${live_preview}` : "";
          const fallback = !preview && stream_state.emitted_count === 0
            ? ` | 응답 생성 중 ${elapsed_sec}s`
            : "";
          void this.registry.send(channel_provider, {
            id: `pulse-${Date.now()}`,
            provider: channel_provider,
            channel: channel_provider,
            sender_id: alias,
            chat_id: message.chat_id,
            content: `… ${alias} 실행중${preview || fallback}`.slice(0, 420),
            at: new Date().toISOString(),
            reply_to: this.resolve_reply_to(channel_provider, message),
            thread_id: message.thread_id,
            metadata: { kind: "agent_progress", agent_alias: alias },
          });
        }, 8000)
      : null;
    try {
      const task_raw = String(message.content || "").trim();
      const task = await this.seal_sensitive_text_for_agent(channel_provider, message.chat_id, task_raw);
      const media_inputs_raw = await this.collect_inbound_media_inputs(channel_provider, message);
      const media_inputs = await this.seal_sensitive_list_for_agent(channel_provider, message.chat_id, media_inputs_raw);
      const task_with_media = this.compose_task_with_media(task, media_inputs);
      const always_skills = agent_domain.context.skills_loader.get_always_skills();
      const context_skills = this.resolve_context_skills(task_with_media, always_skills);
      const provider_hint = default_executor;
      const session_history = await this.get_session_history(
        channel_provider,
        message.chat_id,
        alias,
        message.thread_id,
        12,
      );
      const thread_nearby = await this.get_thread_nearby_context(channel_provider, message, 12);
      const sealed_thread_nearby = await this.seal_thread_context_for_agent(channel_provider, message.chat_id, thread_nearby);
      const thread_nearby_block = this.format_thread_nearby_block(sealed_thread_nearby);
      const secret_guard = await this.inspect_secret_references_for_orchestration([
        task_with_media,
        thread_nearby_block,
        ...media_inputs,
      ]);
      if (!secret_guard.ok) {
        return {
          reply: this.format_secret_resolution_notice(secret_guard),
          error: "secret_resolution_required",
        };
      }
      const mode = this.pick_loop_mode(task_with_media);
      this.apply_tool_runtime_context(agent_domain, channel_provider, message);
      const tool_definitions = agent_domain.tools.get_definitions();

      const recent_history_lines = session_history
        .slice(-8)
        .map((r) => `[${r.role}] ${r.content}`);

      const run_once = async (
        provider_id: "claude_code" | "chatgpt" | "openrouter",
      ): Promise<AgentRunResult> => {
        if (mode === "task") {
          return this.run_task_loop_for_message({
            agent_domain,
            provider_id,
            alias,
            channel_provider,
            message,
            task_with_media,
            media_inputs,
            session_history,
            thread_nearby_block,
            skill_names: context_skills,
            abort,
          });
        }

        const response = await agent_domain.loop.run_agent_loop({
          loop_id: `loop-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          agent_id: alias,
          objective: task_with_media || task || "handle inbound request",
          context_builder: agent_domain.context,
          providers: orchestrator,
          tools: tool_definitions,
          provider_id,
          current_message: [
            `[CURRENT_REQUEST]\n${task_with_media}`,
            recent_history_lines.length > 0
              ? ["[REFERENCE_RECENT_CONTEXT]", ...recent_history_lines].join("\n")
              : "",
            thread_nearby_block,
            "중요: 실행 대상은 CURRENT_REQUEST 하나입니다. REFERENCE 문맥은 참고용이며 재실행 지시가 아닙니다.",
          ].filter(Boolean).join("\n\n"),
          history_days: [],
          skill_names: context_skills,
          media: media_inputs,
          channel: channel_provider,
          chat_id: message.chat_id,
          max_turns: Math.max(1, Number(process.env.AGENT_LOOP_MAX_TURNS || 8)),
          model: undefined,
          max_tokens: 1800,
          temperature: 0.3,
          abort_signal: abort.signal,
          on_stream: async (chunk) => {
            const raw_part = this.sanitize_stream_chunk(String(chunk || ""));
            if (!raw_part) return;
            const part = this.normalize_stream_delta(stream_state, raw_part);
            if (!part) return;
            live_preview = this.squash_for_preview(`${live_preview} ${part}`);
            if (!this.stream_emit_enabled) return;
            stream_state.buffer += stream_state.buffer ? `\n${part}` : part;
            const now = Date.now();
            const due_by_size = stream_state.buffer.length >= this.stream_emit_min_chars;
            const due_by_time = stream_state.buffer.length > 0 && (now - stream_state.last_emit_at >= this.stream_emit_interval_ms);
            if (!due_by_size && !due_by_time) return;
            const rendered = this.format_stream_content(channel_provider, message.chat_id, stream_state.buffer);
            stream_state.buffer = "";
            stream_state.last_emit_at = now;
            if (!rendered.content) return;
            if (this.should_skip_stream_emit(stream_state, rendered.content)) return;
            this.mark_stream_emitted(stream_state, rendered.content);
            await this.send_stream_content(channel_provider, message, alias, rendered, "stream send failed");
          },
          check_should_continue: async () => false,
          on_tool_calls: async ({ tool_calls }) => {
            const outputs: string[] = [];
            for (const tool_call of tool_calls) {
                const result = await agent_domain.tools.execute(
                tool_call.name,
                tool_call.arguments || {},
                {
                  task_id: `adhoc:${channel_provider}:${message.chat_id}:${alias}`,
                  signal: abort.signal,
                  channel: channel_provider,
                  chat_id: message.chat_id,
                  sender_id: message.sender_id,
                },
              );
              outputs.push(`[tool:${tool_call.name}] ${result}`);
            }
            return outputs.join("\n");
          },
        });
        if (this.stream_emit_enabled && stream_state.buffer.trim()) {
          const tail = this.format_stream_content(channel_provider, message.chat_id, stream_state.buffer);
          stream_state.buffer = "";
          if (tail.content) {
            if (!this.should_skip_stream_emit(stream_state, tail.content)) {
              this.mark_stream_emitted(stream_state, tail.content);
              await this.send_stream_content(channel_provider, message, alias, tail, "stream tail send failed");
            }
          }
        }
        const content = this.sanitize_provider_output(String(response.final_content || ""));
        if (!content) return { reply: null, error: "empty_provider_response" };
        const providerError = this.extract_provider_error(content);
        if (providerError) return { reply: null, error: providerError };
        return {
          reply: this.normalize_agent_reply(content, alias, message.sender_id),
          ...this.stream_result(stream_state),
        };
      };

      const primary_provider = resolve_executor_provider(provider_hint);
      const first = await run_once(primary_provider);
      if (first.reply) return first;

      // One-shot fallback for CLI executor startup failures.
      if (primary_provider === "claude_code") {
        const fallback_provider = resolve_executor_provider("chatgpt");
        if (fallback_provider !== primary_provider) {
          // eslint-disable-next-line no-console
          console.error(
            `[channel-manager] primary executor failed alias=${alias} provider=${primary_provider} err=${first.error || "unknown"} fallback=${fallback_provider}`,
          );
          const second = await run_once(fallback_provider);
          if (second.reply) return second;
          return { reply: null, error: second.error || first.error };
        }
      }
      return first;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`[channel-manager] headless invoke failed alias=${alias} err=${error instanceof Error ? error.message : String(error)}`);
      return { reply: null, error: error instanceof Error ? error.message : String(error) };
    } finally {
      clearInterval(typingTicker);
      if (pulseTicker) clearInterval(pulseTicker);
      this.active_runs.delete(run_key);
    }
  }

  private pick_loop_mode(task: string): "agent" | "task" {
    const text = String(task || "").toLowerCase();
    if (!text) return "agent";
    if (/(승인|approve|approval|대기|wait|재개|resume|workflow|워크플로우|순차|단계|step)/i.test(text)) return "task";
    const numbered = (text.match(/\n\s*\d+\./g) || []).length;
    const bullets = (text.match(/\n\s*[-*]\s+/g) || []).length;
    if (numbered + bullets >= 3) return "task";
    return "agent";
  }

  private resolve_context_skills(task: string, base_skills: string[]): string[] {
    const out = new Set<string>((base_skills || []).map((v) => String(v || "").trim()).filter(Boolean));
    const text = String(task || "").toLowerCase();
    if (!text) return [...out];
    if (
      /(cron|크론|스케줄|예약|알림|리마인드|notify|remind|every\s+\d+|at\s+\d{4}-\d{2}-\d{2})/i.test(text)
    ) {
      out.add("cron");
    }
    return [...out];
  }

  private async run_task_loop_for_message(args: {
    agent_domain: AgentDomain;
    provider_id: "claude_code" | "chatgpt" | "openrouter";
    alias: string;
    channel_provider: ChannelProvider;
    message: InboundMessage;
    task_with_media: string;
    media_inputs: string[];
    session_history: Array<{ role: "system" | "user" | "assistant" | "tool"; content: string }>;
    thread_nearby_block: string;
    skill_names: string[];
    abort: AbortController;
  }): Promise<AgentRunResult> {
    const task_id = `task:${args.channel_provider}:${args.message.chat_id}:${args.alias}`.toLowerCase();
    const task_stream_state = this.create_stream_emit_state();
    const tool_definitions = args.agent_domain.tools.get_definitions();
    const recent_history_lines = args.session_history
      .slice(-8)
      .map((r) => `[${r.role}] ${r.content}`);
    const seed = [
      `[CURRENT_REQUEST]\n${args.task_with_media}`,
      recent_history_lines.length > 0
        ? ["[REFERENCE_RECENT_CONTEXT]", ...recent_history_lines].join("\n")
        : "",
      args.thread_nearby_block,
      "중요: 실행 대상은 CURRENT_REQUEST 하나입니다. REFERENCE 문맥은 참고용이며 재실행 지시가 아닙니다.",
    ].filter(Boolean).join("\n\n");
    const prev = args.agent_domain.loop.get_task(task_id);
    if (prev && prev.status !== "running") {
      await args.agent_domain.loop.resume_task(task_id, "channel_reentry");
    }
    this.apply_tool_runtime_context(args.agent_domain, args.channel_provider, args.message);
    const nodes: TaskNode[] = [
      {
        id: "plan",
        run: async ({ memory }) => ({
          memory_patch: {
            ...memory,
            objective: args.task_with_media,
            seed_prompt: seed,
            mode: "task_loop",
          },
          next_step_index: 1,
          current_step: "plan",
        }),
      },
      {
        id: "execute",
        run: async ({ memory }) => {
          const response = await args.agent_domain.loop.run_agent_loop({
            loop_id: `nested-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            agent_id: args.alias,
            objective: String(memory.objective || args.task_with_media),
            context_builder: args.agent_domain.context,
            providers: this.providers!,
            tools: tool_definitions,
            provider_id: args.provider_id,
            current_message: String(memory.seed_prompt || seed),
            history_days: [],
            skill_names: args.skill_names,
            media: args.media_inputs,
            channel: args.channel_provider,
            chat_id: args.message.chat_id,
            max_turns: Math.max(1, Number(process.env.AGENT_LOOP_MAX_TURNS || 6)),
            model: undefined,
            max_tokens: 1800,
            temperature: 0.3,
            abort_signal: args.abort.signal,
            on_stream: async (chunk) => {
              if (!this.stream_emit_enabled) return;
              const raw_part = this.sanitize_stream_chunk(String(chunk || ""));
              if (!raw_part) return;
              const part = this.normalize_stream_delta(task_stream_state, raw_part);
              if (!part) return;
              task_stream_state.buffer += task_stream_state.buffer ? `\n${part}` : part;
              const now = Date.now();
              const due_by_size = task_stream_state.buffer.length >= this.stream_emit_min_chars;
              const due_by_time = task_stream_state.buffer.length > 0 && (now - task_stream_state.last_emit_at >= this.stream_emit_interval_ms);
              if (!due_by_size && !due_by_time) return;
              const rendered = this.format_stream_content(args.channel_provider, args.message.chat_id, task_stream_state.buffer);
              task_stream_state.buffer = "";
              task_stream_state.last_emit_at = now;
              if (!rendered.content) return;
              if (this.should_skip_stream_emit(task_stream_state, rendered.content)) return;
              this.mark_stream_emitted(task_stream_state, rendered.content);
              await this.send_stream_content(args.channel_provider, args.message, args.alias, rendered, "task stream send failed");
            },
            check_should_continue: async () => false,
            on_tool_calls: async ({ tool_calls }) => {
              const outputs: string[] = [];
              for (const tool_call of tool_calls) {
                    const result = await args.agent_domain.tools.execute(
                    tool_call.name,
                    tool_call.arguments || {},
                    {
                      task_id,
                      signal: args.abort.signal,
                      channel: args.channel_provider,
                      chat_id: args.message.chat_id,
                    sender_id: args.message.sender_id,
                  },
                );
                outputs.push(`[tool:${tool_call.name}] ${result}`);
              }
              return outputs.join("\n");
            },
          });
          if (this.stream_emit_enabled && task_stream_state.buffer.trim()) {
            const tail = this.format_stream_content(args.channel_provider, args.message.chat_id, task_stream_state.buffer);
            task_stream_state.buffer = "";
            if (tail.content && !this.should_skip_stream_emit(task_stream_state, tail.content)) {
              this.mark_stream_emitted(task_stream_state, tail.content);
              await this.send_stream_content(args.channel_provider, args.message, args.alias, tail, "task stream tail send failed");
            }
          }
          const final = String(response.final_content || "").trim();
          if (final.includes("approval_required")) {
            return {
              status: "waiting_approval",
              memory_patch: { ...memory, last_output: final },
              current_step: "execute",
              exit_reason: "waiting_approval",
            };
          }
          return {
            memory_patch: { ...memory, last_output: final },
            next_step_index: 2,
            current_step: "execute",
          };
        },
      },
      {
        id: "finalize",
        run: async ({ memory }) => ({
          status: "completed",
          memory_patch: memory,
          current_step: "finalize",
          exit_reason: "workflow_completed",
        }),
      },
    ];

    const task_result = await args.agent_domain.loop.run_task_loop({
      task_id,
      title: `ChannelTask:${args.alias}`,
      nodes,
      max_turns: Math.max(1, Number(process.env.TASK_LOOP_MAX_TURNS || 12)),
      initial_memory: {
        alias: args.alias,
        channel: args.channel_provider,
        chat_id: args.message.chat_id,
      },
    });

    const output = String(task_result.state.memory?.last_output || "").trim();
    if (task_result.state.status === "waiting_approval") {
      return {
        reply: "승인 대기 상태입니다. 승인 응답 후 같은 작업을 재개합니다.",
        ...this.stream_result(task_stream_state),
      };
    }
    if (!output) {
      return {
        reply: null,
        error: `task_loop_no_output:${task_result.state.status}`,
        ...this.stream_result(task_stream_state),
      };
    }
    const providerError = this.extract_provider_error(output);
    if (providerError) {
      return {
        reply: null,
        error: providerError,
        ...this.stream_result(task_stream_state),
      };
    }
    return {
      reply: this.normalize_agent_reply(output, args.alias, args.message.sender_id),
      ...this.stream_result(task_stream_state),
    };
  }

  private apply_tool_runtime_context(agent_domain: AgentDomain, provider: ChannelProvider, message: InboundMessage): void {
    const channel = provider;
    const chat_id = String(message.chat_id || "");
    const reply_to = this.resolve_reply_to(provider, message);
    if (!chat_id) return;
    const message_tool = agent_domain.tools.get("message") as { set_context?: (c: string, id: string, reply?: string | null) => void } | null;
    message_tool?.set_context?.(channel, chat_id, reply_to);
    const spawn_tool = agent_domain.tools.get("spawn") as { set_context?: (c: string, id: string) => void } | null;
    spawn_tool?.set_context?.(channel, chat_id);
    const file_request_tool = agent_domain.tools.get("request_file") as { set_context?: (c: string, id: string) => void } | null;
    file_request_tool?.set_context?.(channel, chat_id);
    const cron_tool = agent_domain.tools.get("cron") as { set_context?: (c: string, id: string) => void } | null;
    cron_tool?.set_context?.(channel, chat_id);
  }

  private format_stream_content(
    provider: ChannelProvider,
    chat_id: string,
    raw: string,
  ): { content: string; parse_mode?: "HTML"; render_mode: RenderMode } {
    const cleaned = this.sanitize_provider_output(String(raw || "")).trim();
    if (!cleaned) return { content: "", render_mode: "markdown" };
    const clipped = cleaned
      .split("\n")
      .slice(-12)
      .join("\n")
      .trim()
      .slice(0, 700);
    if (!clipped) return { content: "", render_mode: "markdown" };
    const profile = this.effective_render_profile(provider, chat_id);
    const source = provider === "telegram" && profile.mode === "html"
      ? clipped
      : this.apply_channel_codeblock_format(provider, clipped);
    const rendered = render_agent_output(source, profile);
    return {
      content: String(rendered.content || "").trim().slice(0, 700),
      parse_mode: rendered.parse_mode,
      render_mode: profile.mode,
    };
  }

  private should_suppress_final_after_stream_send(
    provider: ChannelProvider,
    result: { reply: string | null; stream_emitted_count?: number; stream_last_content?: string; stream_full_content?: string },
  ): boolean {
    void provider;
    if (!this.suppress_final_after_stream) return false;
    if (!result.reply) return false;
    return Number(result.stream_emitted_count || 0) > 0;
  }

  private session_key(provider: ChannelProvider, chat_id: string, alias: string, thread_id?: string): string {
    const thread_scope = this.session_thread_scope(provider, thread_id);
    return `${provider}:${chat_id}:${thread_scope}:${alias}`.toLowerCase();
  }

  private session_thread_scope(provider: ChannelProvider, thread_id?: string): string {
    const t = String(thread_id || "").trim();
    if (t) return `thread:${t}`;
    if (provider === "slack") return "thread:root";
    return "thread:default";
  }

  private async get_session_history(
    provider: ChannelProvider,
    chat_id: string,
    alias: string,
    thread_id: string | undefined,
    max_messages: number,
  ): Promise<Array<{ role: "system" | "user" | "assistant" | "tool"; content: string }>> {
    if (!this.sessions) return [];
    try {
      const key = this.session_key(provider, chat_id, alias, thread_id);
      const session = await this.sessions.get_or_create(key);
      const now = Date.now();
      const rows = session.messages
        .filter((row) => {
          if (this.session_history_max_age_ms <= 0) return true;
          if (!row || typeof row !== "object") return true;
          const rec = row as Record<string, unknown>;
          const ts_raw = String(rec.timestamp || rec.at || "").trim();
          if (!ts_raw) return true;
          const ts = Date.parse(ts_raw);
          if (!Number.isFinite(ts)) return true;
          return now - ts <= this.session_history_max_age_ms;
        })
        .slice(-Math.max(1, Number(max_messages || 1)));
      return rows
        .map((r) => ({
          role: String(r.role || "user") as "system" | "user" | "assistant" | "tool",
          content: String(r.content || ""),
        }))
        .filter((r) => Boolean(r.content));
    } catch {
      return [];
    }
  }

  private async get_thread_nearby_context(
    provider: ChannelProvider,
    message: InboundMessage,
    limit: number,
  ): Promise<Array<{ sender_id: string; content: string; at: string }>> {
    const meta = (message.metadata || {}) as Record<string, unknown>;
    const thread_key = String(message.thread_id || "").trim();
    const current_message_id = String(meta.message_id || message.id || "").trim();
    if (!thread_key && provider !== "slack") return [];
    const key = thread_key || current_message_id;
    if (!key) return [];
    try {
      const rows = await this.registry.read(provider, message.chat_id, Math.max(this.read_limit, 80));
      const scoped = rows
        .filter((row) => {
          const row_meta = (row.metadata || {}) as Record<string, unknown>;
          const row_id = String(row_meta.message_id || row.id || "").trim();
          const row_thread = String(row.thread_id || "").trim();
          if (!row_id && !row_thread) return false;
          return row_thread === key || row_id === key;
        })
        .sort((a, b) => this.extract_timestamp_ms(a) - this.extract_timestamp_ms(b))
        .map((row) => {
          const text = this.sanitize_provider_output(String(row.content || "")).trim();
          return {
            sender_id: String(row.sender_id || "unknown"),
            content: text.slice(0, 260),
            at: String(row.at || ""),
          };
        })
        .filter((row) => Boolean(row.content));
      if (scoped.length <= 0) return [];
      const n = Math.max(1, Math.min(24, Number(limit || 12)));
      return scoped.slice(-n);
    } catch {
      return [];
    }
  }

  private format_thread_nearby_block(rows: Array<{ sender_id: string; content: string; at: string }>): string {
    if (!Array.isArray(rows) || rows.length === 0) return "";
    const lines = rows.map((row) => `- [${row.sender_id}] ${row.content}`);
    return ["[THREAD_NEARBY_CONTEXT]", ...lines].join("\n");
  }

  private async record_user_message(provider: ChannelProvider, message: InboundMessage, alias: string): Promise<void> {
    if (!this.sessions) return;
    try {
      const key = this.session_key(provider, message.chat_id, alias, message.thread_id);
      const session = await this.sessions.get_or_create(key);
      const safe_content = this.sanitize_sensitive_text_for_storage(String(message.content || ""));
      session.add_message("user", safe_content, {
        sender_id: message.sender_id,
        at: message.at,
        thread_id: message.thread_id,
      });
      await this.sessions.save(session);
      await this.append_daily_memory_line(
        "user",
        provider,
        message.chat_id,
        message.thread_id,
        message.sender_id,
        safe_content,
      );
    } catch {
      // no-op
    }
  }

  private async record_assistant_message(
    provider: ChannelProvider,
    message: InboundMessage,
    alias: string,
    content: string,
  ): Promise<void> {
    if (!this.sessions) return;
    try {
      const key = this.session_key(provider, message.chat_id, alias, message.thread_id);
      const session = await this.sessions.get_or_create(key);
      const safe_content = this.sanitize_sensitive_text_for_storage(String(content || ""));
      session.add_message("assistant", safe_content, {
        sender_id: alias,
        at: new Date().toISOString(),
        thread_id: message.thread_id,
      });
      await this.sessions.save(session);
      await this.append_daily_memory_line(
        "assistant",
        provider,
        message.chat_id,
        message.thread_id,
        alias,
        safe_content,
      );
    } catch {
      // no-op
    }
  }

  private async append_daily_memory_line(
    role: "user" | "assistant",
    provider: ChannelProvider,
    chat_id: string,
    thread_id: string | undefined,
    sender_id: string,
    content: string,
  ): Promise<void> {
    const store = this.agent?.context.memory_store;
    if (!store) return;
    const text = this
      .sanitize_sensitive_text_for_storage(String(content || ""))
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 1600);
    if (!text) return;
    const thread = String(thread_id || "").trim() || "-";
    const sender = String(sender_id || "unknown").trim() || "unknown";
    const line = `- [${new Date().toISOString()}] [${provider}:${chat_id}:${thread}] ${role.toUpperCase()}(${sender}): ${text}\n`;
    try {
      await store.append_daily(line);
    } catch {
      // no-op
    }
  }

  private sanitize_sensitive_text_for_storage(raw: string): string {
    const redacted = redact_sensitive_text(String(raw || ""));
    return this.strip_secret_reference_tokens(String(redacted.text || ""));
  }

  private async seal_sensitive_text_for_agent(provider: ChannelProvider, chat_id: string, raw: string): Promise<string> {
    const text = String(raw || "");
    if (!text.trim()) return "";
    try {
      const sealed = await seal_inbound_sensitive_text(text, {
        provider,
        chat_id,
        vault: this.secret_vault,
      });
      return sealed.text;
    } catch {
      return redact_sensitive_text(text).text;
    }
  }

  private async seal_sensitive_list_for_agent(provider: ChannelProvider, chat_id: string, values: string[]): Promise<string[]> {
    const out: string[] = [];
    for (const row of values || []) {
      const raw = String(row || "").trim();
      if (!raw) continue;
      if (this.is_local_media_reference(raw)) {
        out.push(raw);
        continue;
      }
      const sealed = await this.seal_sensitive_text_for_agent(provider, chat_id, raw);
      if (!sealed.trim()) continue;
      out.push(sealed);
    }
    return out;
  }

  private async seal_thread_context_for_agent(
    provider: ChannelProvider,
    chat_id: string,
    rows: Array<{ sender_id: string; content: string; at: string }>,
  ): Promise<Array<{ sender_id: string; content: string; at: string }>> {
    const out: Array<{ sender_id: string; content: string; at: string }> = [];
    for (const row of rows || []) {
      const sealed_content = await this.seal_sensitive_text_for_agent(provider, chat_id, String(row.content || ""));
      out.push({
        sender_id: String(row.sender_id || "unknown"),
        at: String(row.at || ""),
        content: sealed_content,
      });
    }
    return out;
  }

  private strip_secret_reference_tokens(raw: string): string {
    return String(raw || "")
      .replace(/\{\{\s*secret:[^}]+\}\}/gi, "[REDACTED:SECRET_REF]")
      .replace(/\bsv1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED:CIPHERTEXT]");
  }

  private async inspect_secret_references_for_orchestration(inputs: string[]): Promise<{
    ok: boolean;
    missing_keys: string[];
    invalid_ciphertexts: string[];
  }> {
    const missing = new Set<string>();
    const invalid = new Set<string>();
    for (const row of inputs || []) {
      const text = String(row || "");
      if (!text.trim()) continue;
      const report = await this.secret_vault.inspect_secret_references(text);
      for (const key of report.missing_keys || []) {
        const name = String(key || "").trim();
        if (name) missing.add(name);
      }
      for (const token of report.invalid_ciphertexts || []) {
        const value = String(token || "").trim();
        if (value) invalid.add(value);
      }
    }
    return {
      ok: missing.size === 0 && invalid.size === 0,
      missing_keys: [...missing.values()],
      invalid_ciphertexts: [...invalid.values()],
    };
  }

  private format_secret_resolution_notice(args: { missing_keys: string[]; invalid_ciphertexts: string[] }): string {
    const missing = (args.missing_keys || []).filter(Boolean).slice(0, 8);
    const invalid = (args.invalid_ciphertexts || []).filter(Boolean).slice(0, 4);
    return [
      "## 요약",
      "민감정보 보안 규칙에 따라 복호화를 중단했습니다. (오케스트레이터 선차단)",
      "",
      "## 핵심",
      "- 상태: secret_resolution_required",
      missing.length > 0 ? `- 누락 키: ${missing.join(", ")}` : "- 누락 키: (없음)",
      invalid.length > 0 ? `- 무효 암호문: ${invalid.join(", ")}` : "- 무효 암호문: (없음)",
      "- 보안 규칙은 모든 다른 규칙보다 우선 적용됩니다.",
      "",
      "## 코드/명령",
      "- /secret list",
      "- /secret set <name> <value>",
      "- 요청 본문에는 {{secret:<name>}} 형태로만 전달",
      "",
      "## 미디어",
      "(없음)",
    ].join("\n");
  }

  private normalize_agent_reply(raw: string, alias: string, sender_id: string): string | null {
    const text = String(raw || "").trim();
    if (!text) return null;
    if (this.is_provider_error_reply(text)) return null;

    let cleaned = text;
    const sender = String(sender_id || "").trim();
    const alias_escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const sender_escaped = sender.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // Remove leading mention chains such as "@user @user2 ..."
    cleaned = cleaned.replace(/^(\s*@[A-Za-z0-9._-]+\s*)+/g, "").trim();
    // Remove common self-intro patterns
    cleaned = cleaned.replace(new RegExp(`^안녕하세요[,!\\s]*@?${alias_escaped}[^\\n]*`, "i"), "").trim();
    cleaned = cleaned.replace(new RegExp(`^(hello|hi)[,!\\s]*i\\s*(am|\\'m)\\s*@?${alias_escaped}[^\\n]*`, "i"), "").trim();
    // Remove sender-mention echo at head
    if (sender_escaped) {
      cleaned = cleaned.replace(new RegExp(`^@${sender_escaped}\\s+`, "i"), "").trim();
    }

    if (cleaned) return cleaned;
    if (this.is_provider_error_reply(text)) return null;
    return text || null;
  }

  private extract_provider_error(text: string): string | null {
    const raw = String(text || "").trim();
    if (!raw) return null;
    const match = raw.match(/^Error calling ([A-Za-z0-9_-]+):\s*(.*)$/i);
    if (!match) return null;
    const body = String(match[2] || "").trim();
    if (!body) return `provider_error:${String(match[1] || "unknown").toLowerCase()}`;
    const compact = body.replace(/\s+/g, " ").slice(0, 180);
    return compact;
  }

  private sanitize_stream_chunk(raw: string): string {
    const clean = this.strip_secret_reference_tokens(
      this.strip_ansi(String(raw || ""))
    )
      .replace(/\r/g, "")
      .replace(/<<ORCH_FINAL>>/g, "")
      .replace(/<<ORCH_FINAL_END>>/g, "");
    if (!clean) return "";
    const lines = clean
      .split("\n")
      .map((l) => l.trimEnd())
      .filter((l) => !this.is_provider_noise_line(l))
      .filter((l) => !this.is_persona_leak_line(l))
      .filter((l) => !/^\s*(?:\$\s*env:|export\s+[A-Za-z_]|set\s+[A-Za-z_])/i.test(l));
    return lines.join("\n").slice(0, 800).trim();
  }

  private squash_for_preview(raw: string): string {
    const one = String(raw || "").replace(/\s+/g, " ").trim();
    if (!one) return "";
    return one.slice(-280);
  }

  private compose_task_with_media(task: string, media_inputs: string[]): string {
    const base = String(task || "").trim();
    if (!media_inputs || media_inputs.length === 0) return base;
    const lines = media_inputs.map((m, i) => `${i + 1}. ${m}`);
    return [
      base || "첨부 파일을 분석하세요.",
      "",
      "[ATTACHED_FILES]",
      ...lines,
      "",
      "요구사항:",
      "- 첨부 파일을 우선 분석하고 핵심 결과를 요약할 것",
      "- 표/코드/로그가 포함되면 핵심만 구조화해 보고할 것",
    ].join("\n");
  }

  private async collect_inbound_media_inputs(provider: ChannelProvider, message: InboundMessage): Promise<string[]> {
    const out: string[] = [];
    const seen = new Set<string>();
    const push = (v: string): void => {
      const s = String(v || "").trim();
      if (!s || seen.has(s)) return;
      seen.add(s);
      out.push(s);
    };
    for (const m of Array.isArray(message.media) ? message.media : []) {
      if (!m?.url) continue;
      const url = String(m.url || "").trim();
      if (!url) continue;
      if (this.is_local_media_reference(url)) push(url);
    }
    if (provider === "slack") {
      const files = this.extract_slack_files(message);
      for (const f of files) {
        const saved = await this.download_slack_file(f.url, f.name);
        if (saved) push(saved);
      }
    }
    if (provider === "telegram") {
      const ids = this.extract_telegram_file_ids(message);
      for (const id of ids) {
        const saved = await this.download_telegram_file(id);
        if (saved) push(saved);
      }
    }
    if (provider === "discord") {
      const files = this.extract_discord_files(message);
      for (const f of files) {
        const saved = await this.download_discord_file(f.url, f.name);
        if (saved) push(saved);
      }
    }
    const linked_files = this.extract_file_links_from_text(String(message.content || ""));
    for (const url of linked_files) {
      const saved = await this.download_remote_file(provider, url);
      if (saved) push(saved);
    }
    return out.slice(0, 8);
  }

  private extract_slack_files(message: InboundMessage): Array<{ url: string; name?: string }> {
    const meta = (message.metadata || {}) as Record<string, unknown>;
    const slack = (meta.slack && typeof meta.slack === "object") ? (meta.slack as Record<string, unknown>) : null;
    if (!slack) return [];
    const files = Array.isArray(slack.files) ? (slack.files as Array<Record<string, unknown>>) : [];
    return files
      .map((f) => ({
        url: String(f.url_private_download || f.url_private || "").trim(),
        name: String(f.name || "").trim() || undefined,
      }))
      .filter((f) => Boolean(f.url));
  }

  private extract_telegram_file_ids(message: InboundMessage): string[] {
    const meta = (message.metadata || {}) as Record<string, unknown>;
    const tg = (meta.telegram && typeof meta.telegram === "object") ? (meta.telegram as Record<string, unknown>) : null;
    if (!tg) return [];
    const out: string[] = [];
    const push = (v: unknown): void => {
      const id = String(v || "").trim();
      if (!id) return;
      out.push(id);
    };
    const document = (tg.document && typeof tg.document === "object") ? (tg.document as Record<string, unknown>) : null;
    const video = (tg.video && typeof tg.video === "object") ? (tg.video as Record<string, unknown>) : null;
    const audio = (tg.audio && typeof tg.audio === "object") ? (tg.audio as Record<string, unknown>) : null;
    const photo = Array.isArray(tg.photo) ? (tg.photo as Array<Record<string, unknown>>) : [];
    push(document?.file_id);
    push(video?.file_id);
    push(audio?.file_id);
    if (photo.length > 0) push(photo[photo.length - 1]?.file_id);
    return [...new Set(out)];
  }

  private extract_discord_files(message: InboundMessage): Array<{ url: string; name?: string }> {
    const meta = (message.metadata || {}) as Record<string, unknown>;
    const discord = (meta.discord && typeof meta.discord === "object") ? (meta.discord as Record<string, unknown>) : null;
    if (!discord) return [];
    const attachments = Array.isArray(discord.attachments) ? (discord.attachments as Array<Record<string, unknown>>) : [];
    return attachments
      .map((a) => ({
        url: String(a.url || a.proxy_url || "").trim(),
        name: String(a.filename || "").trim() || undefined,
      }))
      .filter((f) => Boolean(f.url));
  }

  private async download_slack_file(url: string, hint_name?: string): Promise<string | null> {
    const token = String(process.env.SLACK_BOT_TOKEN || "").trim();
    const target = String(url || "").trim();
    if (!token || !target) return null;
    try {
      const res = await fetch(target, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!res.ok) return null;
      const bytes = new Uint8Array(await res.arrayBuffer());
      const ext = extname(new URL(target).pathname || "");
      const safeName = this.make_safe_filename(hint_name || basename(new URL(target).pathname) || `slack-file${ext || ""}`);
      const dir = await this.ensure_inbound_files_dir("slack");
      const path = join(dir, `${Date.now()}-${safeName}`);
      await writeFile(path, bytes);
      return path;
    } catch {
      return null;
    }
  }

  private async download_telegram_file(file_id: string): Promise<string | null> {
    const token = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
    const apiBase = String(process.env.TELEGRAM_API_BASE || "https://api.telegram.org").trim();
    const id = String(file_id || "").trim();
    if (!token || !id) return null;
    try {
      const getFileResp = await fetch(`${apiBase}/bot${token}/getFile?file_id=${encodeURIComponent(id)}`);
      const getFileJson = (await getFileResp.json().catch(() => ({}))) as Record<string, unknown>;
      if (!getFileResp.ok || getFileJson.ok !== true) return null;
      const result = (getFileJson.result && typeof getFileJson.result === "object")
        ? (getFileJson.result as Record<string, unknown>)
        : null;
      const filePath = String(result?.file_path || "").trim();
      if (!filePath) return null;
      const fileResp = await fetch(`${apiBase}/file/bot${token}/${filePath}`);
      if (!fileResp.ok) return null;
      const bytes = new Uint8Array(await fileResp.arrayBuffer());
      const safeName = this.make_safe_filename(basename(filePath) || `${id}.bin`);
      const dir = await this.ensure_inbound_files_dir("telegram");
      const path = join(dir, `${Date.now()}-${safeName}`);
      await writeFile(path, bytes);
      return path;
    } catch {
      return null;
    }
  }

  private async download_discord_file(url: string, hint_name?: string): Promise<string | null> {
    const target = String(url || "").trim();
    if (!target) return null;
    try {
      const res = await fetch(target);
      if (!res.ok) return null;
      const bytes = new Uint8Array(await res.arrayBuffer());
      const safeName = this.make_safe_filename(hint_name || basename(new URL(target).pathname) || "discord-file.bin");
      const dir = await this.ensure_inbound_files_dir("discord");
      const path = join(dir, `${Date.now()}-${safeName}`);
      await writeFile(path, bytes);
      return path;
    } catch {
      return null;
    }
  }

  private extract_file_links_from_text(text: string): string[] {
    const source = String(text || "");
    if (!source) return [];
    const matches = source.match(/https?:\/\/[^\s<>()]+/gi) || [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const raw of matches) {
      const url = String(raw || "").trim();
      if (!url || seen.has(url)) continue;
      let pathname = "";
      try {
        pathname = new URL(url).pathname.toLowerCase();
      } catch {
        continue;
      }
      if (!/\.(txt|md|csv|json|xml|yaml|yml|pdf|log|zip|tar|gz|png|jpg|jpeg|webp|gif|mp3|wav|ogg|mp4|mov|webm)(?:$|\?)/i.test(pathname)) continue;
      seen.add(url);
      out.push(url);
      if (out.length >= 6) break;
    }
    return out;
  }

  private async download_remote_file(provider: ChannelProvider, url: string): Promise<string | null> {
    const target = String(url || "").trim();
    if (!target) return null;
    try {
      const res = await fetch(target);
      if (!res.ok) return null;
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength <= 0 || bytes.byteLength > 20 * 1024 * 1024) return null;
      const pathname = new URL(target).pathname || "";
      const guessed = basename(pathname) || `remote-${Date.now()}.bin`;
      const safeName = this.make_safe_filename(guessed);
      const dir = await this.ensure_inbound_files_dir(provider);
      const path = join(dir, `${Date.now()}-${safeName}`);
      await writeFile(path, bytes);
      return path;
    } catch {
      return null;
    }
  }

  private make_safe_filename(name: string): string {
    const raw = String(name || "").trim() || "file.bin";
    return raw.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").slice(0, 120);
  }

  private async ensure_inbound_files_dir(provider: ChannelProvider): Promise<string> {
    const dir = join(this.workspace_dir, "runtime", "inbound-files", provider);
    await mkdir(dir, { recursive: true });
    return dir;
  }

  private build_user_render_payload(
    raw: string,
    provider: ChannelProvider,
    chat_id: string,
  ): { content: string; media: MediaItem[]; parse_mode?: "HTML"; render_mode: RenderMode } {
    const profile = this.effective_render_profile(provider, chat_id);
    const pretty = this.prettify_user_output(raw, provider, profile.mode);
    const sanitized = render_agent_output(pretty, profile).markdown;
    const extracted = this.extract_media_items(sanitized);
    const fallback = extracted.content || (extracted.media.length > 0 ? "첨부 파일을 확인해주세요." : "");
    const rendered = render_agent_output(fallback, profile);
    return {
      content: String(rendered.content || "").slice(0, 1600),
      media: extracted.media.slice(0, 4),
      parse_mode: rendered.parse_mode,
      render_mode: profile.mode,
    };
  }

  private prettify_user_output(raw: string, provider: ChannelProvider, render_mode: RenderMode): string {
    const format_for_channel = (text: string): string => {
      if (provider === "telegram" && render_mode === "html") return text;
      return this.apply_channel_codeblock_format(provider, text);
    };
    const clean = this.strip_sensitive_command_blocks(this.sanitize_provider_output(raw));
    if (!clean) return "";

    const jsonPretty = this.try_prettify_json(clean);
    if (jsonPretty) return jsonPretty;

    const lines = clean
      .split("\n")
      .map((l) => l.trimEnd())
      .filter((l, i, arr) => !(l === "" && arr[i - 1] === ""))
      .slice(0, 120);

    if (this.has_markdown_table(lines)) {
      return format_for_channel(lines.join("\n")).slice(0, 1600);
    }

    const hasBullet = lines.some((l) => /^(\-|\*|\d+\.)\s+/.test(l.trim()));
    if (hasBullet) {
      return format_for_channel(lines.join("\n")).slice(0, 1600);
    }

    const one = lines.join(" ").replace(/\s+/g, " ").trim();
    const chunks = one
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (chunks.length >= 2) {
      const head = chunks[0];
      const tail = chunks.slice(1, 5).map((s) => `- ${s}`);
      return format_for_channel([`${head}`, ...tail].join("\n")).slice(0, 1600);
    }
    return format_for_channel(one).slice(0, 1600);
  }

  private try_prettify_json(raw: string): string | null {
    const text = String(raw || "").trim();
    if (!text.startsWith("{") && !text.startsWith("[")) return null;
    try {
      const parsed = JSON.parse(text) as unknown;
      if (Array.isArray(parsed)) {
        const preview = parsed.slice(0, 8).map((v) => `- ${typeof v === "string" ? v : JSON.stringify(v)}`);
        return ["결과 요약", ...preview].join("\n").slice(0, 1600);
      }
      if (parsed && typeof parsed === "object") {
        const obj = parsed as Record<string, unknown>;
        const keys = Object.keys(obj).slice(0, 12);
        const rows = keys.map((k) => `- ${k}: ${this.to_compact_value(obj[k])}`);
        return ["결과 요약", ...rows].join("\n").slice(0, 1600);
      }
      return null;
    } catch {
      return null;
    }
  }

  private apply_channel_codeblock_format(provider: ChannelProvider, text: string): string {
    const input = String(text || "");
    if (!input.includes("```")) return input;
    if (provider === "slack" || provider === "discord") return input;
    if (provider !== "telegram") return input;

    // Telegram 기본 sendMessage(parse_mode 없음)에서 fenced block 가독성이 떨어져
    // 채널 친화적인 plain block 형태로 치환한다.
    return input.replace(/```([a-zA-Z0-9_-]+)?\n([\s\S]*?)```/g, (_m, lang, code) => {
      const language = String(lang || "").trim().toLowerCase();
      const body = String(code || "")
        .replace(/\r/g, "")
        .split("\n")
        .map((line) => `  ${line}`)
        .join("\n")
        .trimEnd();
      const label = language ? `코드 (${language})` : "코드";
      return [`${label}:`, body || "  (empty)", "코드 끝."].join("\n");
    });
  }

  private to_compact_value(v: unknown): string {
    if (v === null || v === undefined) return "null";
    if (typeof v === "string") return v.length > 120 ? `${v.slice(0, 120)}...` : v;
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    if (Array.isArray(v)) return `[${v.length} items]`;
    if (typeof v === "object") return "{...}";
    return String(v);
  }

  private sanitize_provider_output(raw: string): string {
    const text = this.strip_secret_reference_tokens(
      this.strip_ansi(String(raw || "")).replace(/\r/g, ""),
    );
    if (!text) return "";
    const lines = text
      .split("\n")
      .map((l) => l.trimEnd())
      .filter((l) => !this.is_provider_noise_line(l))
      .filter((l) => !this.is_persona_leak_line(l))
      .filter((l) => !this.is_sensitive_command_line(l));
    return this.strip_persona_leak_blocks(lines.join("\n").trim());
  }

  private strip_sensitive_command_blocks(raw: string): string {
    let out = String(raw || "");
    out = out.replace(/```(?:bash|sh|zsh|powershell|pwsh|cmd|shell)[\s\S]*?```/gi, "");
    out = out.replace(/```(?:ps1|bat)[\s\S]*?```/gi, "");
    return this.strip_persona_leak_blocks(out).trim();
  }

  private strip_persona_leak_blocks(raw: string): string {
    let out = String(raw || "");
    out = out.replace(/```[\s\S]*?(?:AGENTS\.md|SOUL\.md|HEART\.md|TOOLS\.md|USER\.md)[\s\S]*?```/gi, "");
    out = out.replace(/```[\s\S]*?\bYou are Codex\b[\s\S]*?```/gi, "");
    return out.trim();
  }

  private strip_ansi(v: string): string {
    return String(v || "").replace(/\x1B\[[0-9;]*[A-Za-z]/g, "");
  }

  private is_provider_noise_line(line: string): boolean {
    const l = String(line || "").trim();
    if (!l) return true;
    if (/^OpenAI Codex v/i.test(l)) return true;
    if (/^WARNING: proceeding, even though we could not update PATH:/i.test(l)) return true;
    if (/^workdir:\s*/i.test(l)) return true;
    if (/^model:\s*/i.test(l)) return true;
    if (/^provider:\s*/i.test(l)) return true;
    if (/^approval:\s*/i.test(l)) return true;
    if (/^sandbox:\s*/i.test(l)) return true;
    if (/^reasoning /i.test(l)) return true;
    if (/^session id:\s*/i.test(l)) return true;
    if (/^mcp startup:\s*/i.test(l)) return true;
    if (/^Reconnecting\.\.\./i.test(l)) return true;
    if (/^\d{4}-\d{2}-\d{2}T.*codex_core::/i.test(l)) return true;
    if (/^<<ORCH_TOOL_CALLS>>$/i.test(l)) return true;
    if (/^<<ORCH_TOOL_CALLS_END>>$/i.test(l)) return true;
    if (/unexpected argument ['"]-a['"] found/i.test(l)) return true;
    if (/^error:\s+unexpected argument ['"][^'"]+['"] found$/i.test(l)) return true;
    if (/^tip:\s+to pass ['"][^'"]+['"] as a value, use ['"]--\s+[^'"]+['"]$/i.test(l)) return true;
    if (/^for more information, try ['"]--help['"]\.?$/i.test(l)) return true;
    if (/^usage:\s+codex\b/i.test(l)) return true;
    if (/^-{3,}$/.test(l)) return true;
    if (/^user$/i.test(l)) return true;
    return false;
  }

  private is_sensitive_command_line(line: string): boolean {
    const l = String(line || "").trim();
    if (!l) return false;
    if (/^Bash command\b/i.test(l)) return true;
    if (/^PowerShell command\b/i.test(l)) return true;
    if (/^Do you want to proceed\?/i.test(l)) return true;
    if (/^(?:yes|no),?\s*allow\b/i.test(l)) return true;
    if (/^PS [A-Za-z]:\\.*>/.test(l)) return true;
    if (/^[A-Za-z]:\\.*>/.test(l)) return true;
    if (/^(?:\$|#|PS>)\s+/.test(l)) return true;
    if (/^\$env:[A-Za-z_][A-Za-z0-9_]*\s*=/.test(l)) return true;
    if (/^(?:export|set)\s+[A-Za-z_][A-Za-z0-9_]*=/.test(l)) return true;
    if (/^(?:bash|sh|zsh|powershell|pwsh|cmd(?:\.exe)?)\b/i.test(l)) return true;
    if (/^(?:cd|ls|dir|cat|grep|awk|sed|find|rg|npm|node|python|pip|cargo|git|dotnet|msbuild|chmod|chown|cp|mv|rm|mkdir|touch|echo)\b/i.test(l)) return true;
    if (/^\s*dotnet\s+build\b/i.test(l)) return true;
    if (/^\s*npm\s+run\s+\S+/i.test(l)) return true;
    if (/^\s*cargo\s+(build|test|check|run)\b/i.test(l)) return true;
    if (/^```(?:bash|sh|zsh|powershell|pwsh|cmd|shell|ps1|bat)?$/i.test(l)) return true;
    return false;
  }

  private is_persona_leak_line(line: string): boolean {
    const l = String(line || "").trim();
    if (!l) return false;
    if (/^<\s*\/?\s*instructions?\s*>$/i.test(l)) return true;
    if (/^you are (?:codex|chatgpt|an ai assistant|a coding agent)\b/i.test(l)) return true;
    if (/^(?:developer|system)\s+(?:message|instruction|instructions)\b/i.test(l)) return true;
    if (/\b(?:agents|soul|heart|tools|user)\.md\b/i.test(l)) return true;
    if (/^(?:#\s*)?role:\s*/i.test(l)) return true;
    if (/^(?:#\s*)?(?:identity|mission|responsibilities|constraints|execution ethos|communication rules)\b/i.test(l)) return true;
    if (/\b(?:collaboration mode|approved command prefixes|sandbox_permissions)\b/i.test(l)) return true;
    return false;
  }

  private has_markdown_table(lines: string[]): boolean {
    const body = lines.filter((l) => /\|/.test(l));
    if (body.length < 2) return false;
    return body.some((l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(l));
  }

  private extract_media_items(text: string): { content: string; media: MediaItem[] } {
    let content = String(text || "");
    const media: MediaItem[] = [];
    const seen = new Set<string>();
    const push_media = (urlRaw: string, alt?: string): boolean => {
      const url = String(urlRaw || "").trim();
      if (!url || seen.has(url)) return false;
      if (!this.is_local_media_reference(url)) return false;
      if (!this.is_existing_local_file_reference(url)) return false;
      const type = this.detect_media_type(url);
      if (!type) return false;
      seen.add(url);
      media.push({
        type,
        url,
        name: alt ? alt.slice(0, 120) : undefined,
      });
      return true;
    };

    content = content.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (m, alt, url) => {
      const pushed = push_media(String(url || ""), String(alt || ""));
      return pushed ? "" : m;
    });
    content = content.replace(/<(?:img|video)[^>]*src=["']([^"']+)["'][^>]*>/gi, (m, url) => {
      const pushed = push_media(String(url || ""));
      return pushed ? "" : m;
    });
    content = content.replace(/\[(IMAGE|VIDEO|FILE)\s*:\s*([^\]]+)\]/gi, (m, _kind, url) => {
      const pushed = push_media(String(url || ""));
      return pushed ? "" : m;
    });

    const plain_urls = content.match(/https?:\/\/[^\s)]+/gi) || [];
    for (const url of plain_urls) {
      const type = this.detect_media_type(url);
      if (!type) continue;
      if (push_media(url)) {
        content = content.replace(url, "");
      }
    }
    const local_paths = this.extract_local_file_paths_from_text(content);
    for (const path of local_paths) {
      const type = this.detect_media_type(path);
      if (!type) continue;
      if (push_media(path)) {
        content = content.replace(path, "");
      }
    }

    content = content
      .split("\n")
      .map((l, i, arr) => {
        const t = l.trimEnd();
        if (!t && !arr[i - 1]?.trim()) return "";
        return t;
      })
      .join("\n")
      .trim();

    return { content, media };
  }

  private detect_media_type(url: string): MediaItem["type"] | null {
    const lower = String(url || "").toLowerCase();
    if (!lower) return null;
    if (/\.(png|jpg|jpeg|gif|webp|svg)(\?.*)?$/.test(lower)) return "image";
    if (/\.(mp4|mov|webm|mkv|avi)(\?.*)?$/.test(lower)) return "video";
    if (/\.(mp3|wav|ogg|m4a)(\?.*)?$/.test(lower)) return "audio";
    if (/\.(pdf|txt|md|csv|json|zip|tar|gz)(\?.*)?$/.test(lower)) return "file";
    return null;
  }

  private extract_local_file_paths_from_text(text: string): string[] {
    const source = String(text || "");
    if (!source) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    const push = (raw: string): void => {
      const candidate = String(raw || "")
        .trim()
        .replace(/^[("'`]+/, "")
        .replace(/[)"'`,.;:!?]+$/, "");
      if (!candidate) return;
      if (!this.is_local_media_reference(candidate)) return;
      if (seen.has(candidate)) return;
      seen.add(candidate);
      out.push(candidate);
    };

    const win = source.match(/[A-Za-z]:\\[^\s"'`<>|]+/g) || [];
    for (const row of win) push(row);

    const unc = source.match(/\\\\[^\s"'`<>|]+/g) || [];
    for (const row of unc) push(row);

    const rel = source.match(/(?:^|[\s(])(?:\.{1,2}[\\/][^\s"'`<>|]+)/g) || [];
    for (const row of rel) push(row.replace(/^(?:\s|\()+/, ""));

    const abs = source.match(/(?:^|[\s(])(\/[^\s"'`<>|]+)/g) || [];
    for (const row of abs) push(row.replace(/^(?:\s|\()+/, ""));

    return out.slice(0, 12);
  }

  private is_existing_local_file_reference(path_value: string): boolean {
    const value = String(path_value || "").trim();
    if (!value) return false;
    try {
      if (!existsSync(value)) return false;
      return statSync(value).isFile();
    } catch {
      return false;
    }
  }

  private is_local_media_reference(url: string): boolean {
    const value = String(url || "").trim();
    if (!value) return false;
    if (/^https?:\/\//i.test(value)) return false;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return false;
    if (/^[A-Za-z]:\\/.test(value)) return true;
    if (/^\\\\/.test(value)) return true;
    if (value.startsWith("/") || value.startsWith("./") || value.startsWith("../")) return true;
    return false;
  }

  private is_provider_error_reply(text: string): boolean {
    const t = String(text || "").trim().toLowerCase();
    if (!t) return false;
    if (t.startsWith("error calling claude:")) return true;
    if (t.startsWith("error calling claude_code:")) return true;
    if (t.startsWith("error calling chatgpt:")) return true;
    if (t.startsWith("error calling openrouter:")) return true;
    if (t.startsWith("error calling phi4_local:")) return true;
    if (t.includes("\"type\":\"authentication_error\"")) return true;
    if (t.includes("invalid x-api-key")) return true;
    if (t.includes("not logged in")) return true;
    if (t.includes("please run /login")) return true;
    if (t.includes("stream disconnected before completion")) return true;
    return false;
  }

  private resolve_reply_to(provider: ChannelProvider, message: InboundMessage): string {
    const meta = (message.metadata || {}) as Record<string, unknown>;
    if (provider === "slack") {
      const thread_ts = String(message.thread_id || "").trim();
      if (thread_ts) return thread_ts;
      return String(meta.message_id || message.id || "").trim();
    }
    if (provider === "telegram") {
      // Telegram reply_to_message_id mismatches can drop sends; prefer plain send for reliability.
      return "";
    }
    return String(meta.message_id || message.id || "").trim();
  }

  private async send_status_notice(
    provider: ChannelProvider,
    message: InboundMessage,
    kind: "start" | "failed" | "done",
    alias: string,
    detail?: string,
  ): Promise<void> {
    if (!this.status_notice_enabled) return;
    const content = this.format_status_message(provider, message.sender_id, kind, alias, detail);
    if (!content) return;
    const sent = await this.send_with_retry(provider, {
      id: `${provider}-${Date.now()}`,
      provider,
      channel: provider,
      sender_id: alias,
      chat_id: message.chat_id,
      content,
      at: new Date().toISOString(),
      reply_to: this.resolve_reply_to(provider, message),
      thread_id: message.thread_id,
      metadata: {
        kind: "agent_status",
        phase: kind,
        agent_alias: alias,
      },
    }, { source: "status_notice" });
    if (!sent.ok) {
      // eslint-disable-next-line no-console
      console.error(`[channel-manager] status notice failed phase=${kind} alias=${alias} err=${sent.error || "unknown_error"}`);
    }
  }

  private format_status_message(
    provider: ChannelProvider,
    sender_id: string,
    kind: "start" | "failed" | "done",
    alias: string,
    detail?: string,
  ): string {
    const mention = provider === "telegram" ? "" : `@${sender_id} `;
    if (kind === "start") {
      return "";
    }
    if (kind === "done") {
      return "";
    }
    const reason = String(detail || "").trim();
    if (reason) {
      const compact = this.normalize_error_detail(reason);
      return `${mention}🔴 ${alias} 실행 실패 [${compact}]`.trim();
    }
    return `${mention}🔴 ${alias} 실행이 실패했습니다. 잠시 후 다시 시도해주세요.`.trim();
  }

  private normalize_error_detail(raw: string): string {
    const text = String(raw || "").replace(/\s+/g, " ").trim();
    if (!text) return "unknown_error";
    if (/unexpected argument ['"]-a['"] found/i.test(text)) return "executor_args_invalid";
    if (/unexpected argument ['"][^'"]+['"] found/i.test(text)) return "executor_args_invalid";
    const m = text.match(/^Error calling ([A-Za-z0-9_-]+):\s*(.*)$/i);
    if (m) {
      const provider = String(m[1] || "provider").toLowerCase();
      const body = String(m[2] || "").trim() || "error";
      return `${provider}:${body}`.slice(0, 180);
    }
    return text.slice(0, 180);
  }

  private render_profile_key(provider: ChannelProvider, chat_id: string): string {
    return `${provider}:${String(chat_id || "").trim()}`.toLowerCase();
  }

  private get_render_profile(provider: ChannelProvider, chat_id: string): RenderProfile {
    const key = this.render_profile_key(provider, chat_id);
    const saved = this.render_profiles.get(key);
    if (saved) return { ...saved };
    return default_render_profile(provider);
  }

  private effective_render_profile(provider: ChannelProvider, chat_id: string): RenderProfile {
    const profile = this.get_render_profile(provider, chat_id);
    if (provider !== "telegram" && profile.mode === "html") {
      return { ...profile, mode: "markdown" };
    }
    return profile;
  }

  private set_render_profile(
    provider: ChannelProvider,
    chat_id: string,
    patch: Partial<RenderProfile>,
  ): RenderProfile {
    const key = this.render_profile_key(provider, chat_id);
    const prev = this.get_render_profile(provider, chat_id);
    const next: RenderProfile = {
      mode: patch.mode || prev.mode,
      blocked_link_policy: patch.blocked_link_policy || prev.blocked_link_policy,
      blocked_image_policy: patch.blocked_image_policy || prev.blocked_image_policy,
    };
    this.render_profiles.set(key, next);
    return next;
  }

  private reset_render_profile(provider: ChannelProvider, chat_id: string): RenderProfile {
    const key = this.render_profile_key(provider, chat_id);
    this.render_profiles.delete(key);
    return this.get_render_profile(provider, chat_id);
  }

  private format_render_profile_status(
    provider: ChannelProvider,
    sender_id: string,
    profile: RenderProfile,
  ): string {
    const mention = provider === "telegram" ? "" : `@${sender_id} `;
    const effective = provider !== "telegram" && profile.mode === "html" ? "markdown" : profile.mode;
    return [
      `${mention}render 설정`,
      `- mode: ${profile.mode}`,
      `- effective_mode: ${effective}`,
      `- blocked_link_policy: ${profile.blocked_link_policy}`,
      `- blocked_image_policy: ${profile.blocked_image_policy}`,
      "- usage: /render <markdown|html|plain|status|reset>",
      "- usage: /render link <indicator|text|remove>",
      "- usage: /render image <indicator|text|remove>",
    ].join("\n").trim();
  }

  private format_common_help(provider: ChannelProvider, sender_id: string): string {
    const mention = provider === "telegram" ? "" : `@${sender_id} `;
    return [
      `${mention}사용 가능한 공통 명령`,
      "- /help",
      "- /stop | /cancel | /중지",
      "- /render <markdown|html|plain|status|reset>",
      "- /render link <indicator|text|remove>",
      "- /render image <indicator|text|remove>",
      "- /secret status|list|set|get|reveal|remove",
      "- /secret encrypt <text> | /secret decrypt <cipher>",
      "- /cron status | /cron list",
      "- /cron add every <duration> <message>",
      "- /cron add at <iso-time> <message>",
      "- /cron remove <job_id>",
    ].join("\n").trim();
  }

  private async send_command_reply(
    provider: ChannelProvider,
    message: InboundMessage,
    content: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    const profile = this.effective_render_profile(provider, message.chat_id);
    const rendered = render_agent_output(content, profile);
    const sent = await this.registry.send(provider, {
      id: `${provider}-${Date.now()}`,
      provider,
      channel: provider,
      sender_id: this.default_agent_alias,
      chat_id: message.chat_id,
      content: String(rendered.content || "").slice(0, 1600),
      at: new Date().toISOString(),
      reply_to: this.resolve_reply_to(provider, message),
      thread_id: message.thread_id,
      metadata: {
        ...metadata,
        render_mode: profile.mode,
        render_parse_mode: rendered.parse_mode || null,
      },
    });
    if (!sent.ok) {
      // eslint-disable-next-line no-console
      console.error(`[channel-manager] command reply failed provider=${provider} err=${sent.error || "unknown_error"}`);
    }
  }

  private async try_handle_help_command(
    provider: ChannelProvider,
    message: InboundMessage,
    command: ParsedSlashCommand | null,
  ): Promise<boolean> {
    if (!slash_name_in(command?.name || "", HELP_COMMAND_ALIASES)) return false;
    await this.send_command_reply(
      provider,
      message,
      this.format_common_help(provider, message.sender_id),
      { kind: "command_help" },
    );
    return true;
  }

  private async try_handle_render_command(
    provider: ChannelProvider,
    message: InboundMessage,
    command: ParsedSlashCommand | null,
  ): Promise<boolean> {
    if (!slash_name_in(command?.name || "", RENDER_ROOT_COMMAND_ALIASES)) return false;
    const args = command?.args_lower || [];
    const arg0 = String(args[0] || "");
    const arg1 = String(args[1] || "");
    const mention = provider === "telegram" ? "" : `@${message.sender_id} `;

    if (!arg0 || slash_token_in(arg0, RENDER_STATUS_ARG_ALIASES)) {
      const profile = this.get_render_profile(provider, message.chat_id);
      await this.send_command_reply(
        provider,
        message,
        this.format_render_profile_status(provider, message.sender_id, profile),
        { kind: "command_render", action: "status" },
      );
      return true;
    }

    if (slash_token_in(arg0, RENDER_RESET_ARG_ALIASES)) {
      const profile = this.reset_render_profile(provider, message.chat_id);
      await this.send_command_reply(
        provider,
        message,
        [
          `${mention}render 설정을 기본값으로 초기화했습니다.`,
          this.format_render_profile_status(provider, message.sender_id, profile),
        ].join("\n"),
        { kind: "command_render", action: "reset" },
      );
      return true;
    }

    const mode = normalize_render_mode(arg0);
    if (mode) {
      const profile = this.set_render_profile(provider, message.chat_id, { mode });
      await this.send_command_reply(
        provider,
        message,
        [
          `${mention}render mode를 '${profile.mode}'로 설정했습니다.`,
          this.format_render_profile_status(provider, message.sender_id, profile),
        ].join("\n"),
        { kind: "command_render", action: "set_mode" },
      );
      return true;
    }

    const target: "link" | "image" | null = slash_token_in(arg0, RENDER_LINK_ARG_ALIASES)
      ? "link"
      : (slash_token_in(arg0, RENDER_IMAGE_ARG_ALIASES) ? "image" : null);
    if (!target) {
      await this.send_command_reply(
        provider,
        message,
        `${mention}render 명령을 이해하지 못했습니다. /render status 로 현재 설정을 확인하세요.`,
        { kind: "command_render", action: "invalid" },
      );
      return true;
    }

    const policy = normalize_block_policy(arg1);
    if (!policy) {
      await this.send_command_reply(
        provider,
        message,
        `${mention}policy 값이 필요합니다. indicator | text | remove 중 하나를 입력하세요.`,
        { kind: "command_render", action: "invalid_policy", target },
      );
      return true;
    }

    const patch: Partial<RenderProfile> = target === "link"
      ? { blocked_link_policy: policy as BlockPolicy }
      : { blocked_image_policy: policy as BlockPolicy };
    const profile = this.set_render_profile(provider, message.chat_id, patch);
    await this.send_command_reply(
      provider,
      message,
      [
        `${mention}${target} blocked policy를 '${policy}'로 설정했습니다.`,
        this.format_render_profile_status(provider, message.sender_id, profile),
      ].join("\n"),
      { kind: "command_render", action: "set_policy", target },
    );
    return true;
  }

  private format_secret_usage(provider: ChannelProvider, sender_id: string): string {
    const mention = provider === "telegram" ? "" : `@${sender_id} `;
    return [
      `${mention}secret 명령 사용법`,
      "- /secret status",
      "- /secret list",
      "- /secret set <name> <value>",
      "- /secret get <name>",
      "- /secret reveal <name>",
      "- /secret remove <name>",
      "- /secret encrypt <plaintext>",
      "- /secret decrypt <ciphertext>",
      "- exec/dynamic command에서 {{secret:name}} 형태로 참조 가능",
      "- 자동 키 규칙: inbound.<provider>.c<chatHash>.<type>.v<valueHash>",
    ].join("\n").trim();
  }

  private async try_handle_secret_command(
    provider: ChannelProvider,
    message: InboundMessage,
    command: ParsedSlashCommand | null,
  ): Promise<boolean> {
    if (!slash_name_in(command?.name || "", SECRET_ROOT_COMMAND_ALIASES)) return false;
    const args = (command?.args || []).map((v) => String(v || "").trim()).filter(Boolean);
    const args_lower = args.map((v) => v.toLowerCase());
    const mention = provider === "telegram" ? "" : `@${message.sender_id} `;

    if (args.length === 0 || slash_token_in(args_lower[0], SECRET_STATUS_ARG_ALIASES)) {
      await this.secret_vault.ensure_ready();
      const names = await this.secret_vault.list_names();
      const paths = this.secret_vault.get_paths();
      await this.send_command_reply(
        provider,
        message,
        [
          `${mention}secret vault 상태`,
          `- names: ${names.length}`,
          `- key_path: ${paths.key_path}`,
          `- store_path: ${paths.store_path}`,
        ].join("\n"),
        { kind: "command_secret", action: "status" },
      );
      return true;
    }

    if (slash_token_in(args_lower[0], SECRET_LIST_ARG_ALIASES)) {
      await this.secret_vault.ensure_ready();
      const names = await this.secret_vault.list_names();
      await this.send_command_reply(
        provider,
        message,
        names.length > 0
          ? `${mention}secret 목록\n${names.map((v, i) => `${i + 1}. ${v}`).join("\n")}`.trim()
          : `${mention}등록된 secret이 없습니다.`.trim(),
        { kind: "command_secret", action: "list" },
      );
      return true;
    }

    if (slash_token_in(args_lower[0], SECRET_SET_ARG_ALIASES)) {
      const name = String(args[1] || "").trim();
      const value = String(args.slice(2).join(" ") || "").trim();
      if (!name || !value) {
        await this.send_command_reply(provider, message, this.format_secret_usage(provider, message.sender_id), {
          kind: "command_secret",
          action: "usage_set",
        });
        return true;
      }
      const saved = await this.secret_vault.put_secret(name, value);
      if (!saved.ok) {
        await this.send_command_reply(
          provider,
          message,
          `${mention}secret 저장 실패: 유효한 name이 필요합니다.`,
          { kind: "command_secret", action: "set_failed" },
        );
        return true;
      }
      await this.send_command_reply(
        provider,
        message,
        `${mention}secret 저장 완료: ${saved.name} (AES-256-GCM)`,
        { kind: "command_secret", action: "set", name: saved.name },
      );
      return true;
    }

    if (slash_token_in(args_lower[0], SECRET_GET_ARG_ALIASES)) {
      const name = String(args[1] || "").trim();
      if (!name) {
        await this.send_command_reply(provider, message, this.format_secret_usage(provider, message.sender_id), {
          kind: "command_secret",
          action: "usage_get",
        });
        return true;
      }
      const cipher = await this.secret_vault.get_secret_cipher(name);
      await this.send_command_reply(
        provider,
        message,
        cipher
          ? `${mention}${name} ciphertext\n${cipher}`.trim()
          : `${mention}secret을 찾지 못했습니다: ${name}`.trim(),
        { kind: "command_secret", action: "get_cipher", name },
      );
      return true;
    }

    if (slash_token_in(args_lower[0], SECRET_REVEAL_ARG_ALIASES)) {
      const name = String(args[1] || "").trim();
      if (!name) {
        await this.send_command_reply(provider, message, this.format_secret_usage(provider, message.sender_id), {
          kind: "command_secret",
          action: "usage_reveal",
        });
        return true;
      }
      const plain = await this.secret_vault.reveal_secret(name);
      await this.send_command_reply(
        provider,
        message,
        plain !== null
          ? `${mention}${name} plaintext\n${plain}`.trim()
          : `${mention}secret을 찾지 못했습니다: ${name}`.trim(),
        { kind: "command_secret", action: "reveal", name },
      );
      return true;
    }

    if (slash_token_in(args_lower[0], SECRET_REMOVE_ARG_ALIASES)) {
      const name = String(args[1] || "").trim();
      if (!name) {
        await this.send_command_reply(provider, message, this.format_secret_usage(provider, message.sender_id), {
          kind: "command_secret",
          action: "usage_remove",
        });
        return true;
      }
      const removed = await this.secret_vault.remove_secret(name);
      await this.send_command_reply(
        provider,
        message,
        removed
          ? `${mention}secret 삭제 완료: ${name}`.trim()
          : `${mention}secret을 찾지 못했습니다: ${name}`.trim(),
        { kind: "command_secret", action: "remove", name },
      );
      return true;
    }

    if (slash_token_in(args_lower[0], SECRET_ENCRYPT_ARG_ALIASES)) {
      const plain = String(args.slice(1).join(" ") || "").trim();
      if (!plain) {
        await this.send_command_reply(provider, message, this.format_secret_usage(provider, message.sender_id), {
          kind: "command_secret",
          action: "usage_encrypt",
        });
        return true;
      }
      const cipher = await this.secret_vault.encrypt_text(plain, "adhoc:secret");
      await this.send_command_reply(
        provider,
        message,
        `${mention}encrypt 완료\n${cipher}`.trim(),
        { kind: "command_secret", action: "encrypt" },
      );
      return true;
    }

    if (slash_token_in(args_lower[0], SECRET_DECRYPT_ARG_ALIASES)) {
      const cipher = String(args.slice(1).join(" ") || "").trim();
      if (!cipher) {
        await this.send_command_reply(provider, message, this.format_secret_usage(provider, message.sender_id), {
          kind: "command_secret",
          action: "usage_decrypt",
        });
        return true;
      }
      try {
        const plain = await this.secret_vault.decrypt_text(cipher, "adhoc:secret");
        await this.send_command_reply(
          provider,
          message,
          `${mention}decrypt 결과\n${plain}`.trim(),
          { kind: "command_secret", action: "decrypt" },
        );
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        await this.send_command_reply(
          provider,
          message,
          `${mention}decrypt 실패: ${reason}`.trim(),
          { kind: "command_secret", action: "decrypt_failed" },
        );
      }
      return true;
    }

    await this.send_command_reply(provider, message, this.format_secret_usage(provider, message.sender_id), {
      kind: "command_secret",
      action: "usage",
    });
    return true;
  }

  private async try_handle_common_slash_command(
    provider: ChannelProvider,
    message: InboundMessage,
    command: ParsedSlashCommand | null,
  ): Promise<boolean> {
    if (await this.try_handle_help_command(provider, message, command)) return true;
    if (await this.try_handle_render_command(provider, message, command)) return true;
    if (await this.try_handle_secret_command(provider, message, command)) return true;
    if (await this.try_handle_stop_command(provider, message, command)) return true;
    if (await this.try_handle_cron_quick_command(provider, message, command)) return true;
    return false;
  }

  private async try_handle_stop_command(
    provider: ChannelProvider,
    message: InboundMessage,
    command: ParsedSlashCommand | null,
  ): Promise<boolean> {
    if (!slash_name_in(command?.name || "", STOP_COMMAND_ALIASES)) return false;
    const cancelled = await this.cancel_active_runs(provider, message.chat_id);
    const mention = provider === "telegram" ? "" : `@${message.sender_id} `;
    await this.send_command_reply(
      provider,
      message,
      cancelled > 0
        ? `${mention}⛔ 실행 중 작업 ${cancelled}건을 중지했습니다.`.trim()
        : `${mention}중지할 실행 작업이 없습니다.`.trim(),
      { kind: "command_stop" },
    );
    return true;
  }

  private parse_cron_quick_action(message: InboundMessage, command: ParsedSlashCommand | null): CronQuickAction | null {
    const command_name = String(command?.name || "").trim();
    const args = command?.args_lower || [];
    const arg0 = String(args[0] || "");
    if (slash_name_in(command_name, CRON_ROOT_COMMAND_ALIASES)) {
      if (slash_token_in(arg0, CRON_LIST_ARG_ALIASES)) return "list";
      if (!arg0 || slash_token_in(arg0, CRON_STATUS_ARG_ALIASES)) return "status";
      if (slash_token_in(arg0, CRON_ADD_ARG_ALIASES)) return "add";
      if (slash_token_in(arg0, CRON_REMOVE_ARG_ALIASES)) return "remove";
    }
    if (slash_name_in(command_name, CRON_STATUS_COMMAND_ALIASES)) return "status";
    if (slash_name_in(command_name, CRON_LIST_COMMAND_ALIASES)) return "list";
    if (slash_name_in(command_name, CRON_ADD_COMMAND_ALIASES)) return "add";
    if (slash_name_in(command_name, CRON_REMOVE_COMMAND_ALIASES)) return "remove";

    const text = String(message.content || "").trim().toLowerCase();
    if (!text) return null;
    if (/^(?:cron|크론)\s*(?:status|상태|확인|조회)$/.test(text)) return "status";
    if (/^(?:cron|크론)\s*(?:jobs|list|목록|리스트)$/.test(text)) return "list";
    if (/^(?:cron|크론)\s*(?:add|추가|등록)\b/.test(text)) return "add";
    if (/^(?:cron|크론)\s*(?:remove|delete|삭제|제거)\b/.test(text)) return "remove";
    if (/^크론\s*작업\s*(?:확인|조회|상태)$/.test(text)) return "status";
    if (/^크론\s*작업\s*(?:목록|리스트)$/.test(text)) return "list";
    if (/^크론\s*작업\s*(?:삭제|제거)\b/.test(text)) return "remove";
    return null;
  }

  private parse_duration_ms(token: string): number | null {
    const raw = String(token || "").trim().toLowerCase();
    const m = raw.match(/^(\d+)(s|sec|secs|second|seconds|초|m|min|mins|minute|minutes|분|h|hr|hrs|hour|hours|시간)?$/i);
    if (!m) return null;
    const value = Number(m[1]);
    if (!Number.isFinite(value) || value <= 0) return null;
    const unit = String(m[2] || "s").toLowerCase();
    if (unit === "m" || unit === "min" || unit === "mins" || unit === "minute" || unit === "minutes" || unit === "분") {
      return value * 60_000;
    }
    if (unit === "h" || unit === "hr" || unit === "hrs" || unit === "hour" || unit === "hours" || unit === "시간") {
      return value * 3_600_000;
    }
    return value * 1_000;
  }

  private parse_cron_add_tokens(message: InboundMessage, command: ParsedSlashCommand | null): string[] {
    const cmd = String(command?.name || "").trim();
    const args = (command?.args || []).map((v) => String(v || "").trim()).filter(Boolean);
    if (slash_name_in(cmd, CRON_ROOT_COMMAND_ALIASES) && args.length > 0) {
      if (slash_token_in(args[0], CRON_ADD_ARG_ALIASES)) return args.slice(1);
    }
    if (slash_name_in(cmd, CRON_ADD_COMMAND_ALIASES)) return args;
    const text = String(message.content || "").trim();
    const m = text.match(/^(?:cron|크론)\s*(?:add|추가|등록)\s+(.+)$/i);
    if (!m) return [];
    return String(m[1] || "").split(/\s+/).map((v) => v.trim()).filter(Boolean);
  }

  private parse_cron_remove_job_id(message: InboundMessage, command: ParsedSlashCommand | null): string {
    const cmd = String(command?.name || "").trim();
    const args = (command?.args || []).map((v) => String(v || "").trim()).filter(Boolean);
    if (slash_name_in(cmd, CRON_ROOT_COMMAND_ALIASES) && args.length >= 2) {
      if (slash_token_in(args[0], CRON_REMOVE_ARG_ALIASES)) return String(args[1] || "").trim();
    }
    if (slash_name_in(cmd, CRON_REMOVE_COMMAND_ALIASES)) return String(args[0] || "").trim();
    const text = String(message.content || "").trim();
    const m = text.match(/^(?:cron|크론)\s*(?:remove|delete|삭제|제거)\s+([A-Za-z0-9_-]{4,64})\b/i)
      || text.match(/^크론\s*작업\s*(?:삭제|제거)\s+([A-Za-z0-9_-]{4,64})\b/i);
    if (!m) return "";
    return String(m[1] || "").trim();
  }

  private parse_cron_quick_add_spec(message: InboundMessage, command: ParsedSlashCommand | null): {
    schedule: CronSchedule;
    message: string;
    name: string;
    deliver: boolean;
    delete_after_run: boolean;
  } | null {
    const tokens = this.parse_cron_add_tokens(message, command);
    if (tokens.length < 3) return null;
    const mode = String(tokens[0] || "").toLowerCase();
    let schedule: CronSchedule | null = null;
    let message_start_idx = -1;
    if (mode === "every") {
      const every_ms = this.parse_duration_ms(String(tokens[1] || ""));
      if (!every_ms) return null;
      schedule = { kind: "every", every_ms };
      message_start_idx = 2;
    } else if (mode === "at") {
      const at_ms = Date.parse(String(tokens[1] || ""));
      if (!Number.isFinite(at_ms) || at_ms <= 0) return null;
      schedule = { kind: "at", at_ms };
      message_start_idx = 2;
    } else if (mode === "cron") {
      if (tokens.length < 7) return null;
      const expr = tokens.slice(1, 6).join(" ");
      let tz: string | null = null;
      let idx = 6;
      if (String(tokens[idx] || "").toLowerCase() === "tz" && tokens[idx + 1]) {
        tz = String(tokens[idx + 1] || "").trim();
        idx += 2;
      } else if (/^tz=/i.test(String(tokens[idx] || ""))) {
        tz = String(tokens[idx] || "").slice(3).trim();
        idx += 1;
      }
      schedule = { kind: "cron", expr, tz: tz || null };
      message_start_idx = idx;
    } else {
      return null;
    }
    const body = tokens.slice(message_start_idx).join(" ").trim();
    if (!schedule || !body) return null;
    const name = body.slice(0, 40);
    const deliver = /(remind|reminder|알림|리마인드|알려줘|깨워)/i.test(body);
    const delete_after_run = schedule.kind === "at";
    return { schedule, message: body, name, deliver, delete_after_run };
  }

  private has_natural_schedule_intent(body: string): boolean {
    const text = String(body || "").trim();
    if (!text) return false;
    return /(알림|리마인드|알려|깨워|예약|등록|재생|실행|전송|보내|켜|끄|체크|확인|notify|remind|run)/i.test(text);
  }

  private parse_natural_cron_add_spec(message: InboundMessage): {
    schedule: CronSchedule;
    message: string;
    name: string;
    deliver: boolean;
    delete_after_run: boolean;
  } | null {
    const text = String(message.content || "").trim();
    if (!text || text.startsWith("/")) return null;

    const rel = text.match(/^(\d+)\s*(초|분|시간|s|sec|secs|m|min|mins|h|hr|hrs)\s*(?:후|뒤)\s+(.+)$/i);
    if (rel) {
      const duration = this.parse_duration_ms(`${rel[1]}${rel[2]}`);
      const body = String(rel[3] || "").trim();
      if (!duration || !body || !this.has_natural_schedule_intent(body)) return null;
      const at_ms = Date.now() + duration;
      return {
        schedule: { kind: "at", at_ms },
        message: body,
        name: body.slice(0, 40),
        deliver: /(remind|reminder|알림|리마인드|알려줘|깨워)/i.test(body),
        delete_after_run: true,
      };
    }

    const abs = text.match(/^(?:(오늘|내일|모레)\s+)?(?:(새벽|오전|오후|저녁|밤)\s*)?(\d{1,2})시(?:\s*(\d{1,2})분?)?(?:\s*(\d{1,2})초?)?\s*(?:에|쯤|부터)?\s+(.+)$/i);
    if (!abs) return null;
    const day_word = String(abs[1] || "").trim();
    const meridiem = String(abs[2] || "").trim();
    const hour_raw = Number(abs[3] || 0);
    const minute_raw = Number(abs[4] || 0);
    const second_raw = Number(abs[5] || 0);
    const body = String(abs[6] || "").trim();
    if (!body || !this.has_natural_schedule_intent(body)) return null;
    if (!Number.isFinite(hour_raw) || hour_raw < 0 || hour_raw > 24) return null;
    if (!Number.isFinite(minute_raw) || minute_raw < 0 || minute_raw > 59) return null;
    if (!Number.isFinite(second_raw) || second_raw < 0 || second_raw > 59) return null;

    let hour = hour_raw;
    const mer = meridiem.toLowerCase();
    if (mer === "오전" || mer === "새벽") {
      if (hour === 12) hour = 0;
    } else if (mer === "오후" || mer === "저녁" || mer === "밤") {
      if (hour >= 1 && hour <= 11) hour += 12;
    }
    if (hour === 24) hour = 0;
    if (hour < 0 || hour > 23) return null;

    const target = new Date();
    target.setMilliseconds(0);
    target.setSeconds(second_raw, 0);
    target.setMinutes(minute_raw);
    target.setHours(hour);
    if (day_word === "내일") target.setDate(target.getDate() + 1);
    if (day_word === "모레") target.setDate(target.getDate() + 2);
    if (!day_word && target.getTime() <= Date.now() + 1_000) {
      target.setDate(target.getDate() + 1);
    }
    const at_ms = target.getTime();
    if (!Number.isFinite(at_ms) || at_ms <= Date.now()) return null;

    return {
      schedule: { kind: "at", at_ms },
      message: body,
      name: body.slice(0, 40),
      deliver: /(remind|reminder|알림|리마인드|알려줘|깨워)/i.test(body),
      delete_after_run: true,
    };
  }

  private format_cron_time_kr(ms: unknown): string {
    const n = Number(ms || 0);
    if (!Number.isFinite(n) || n <= 0) return "n/a";
    return new Date(n).toLocaleString("sv-SE", { timeZone: "Asia/Seoul", hour12: false }).replace(" ", "T") + "+09:00";
  }

  private render_cron_schedule(schedule_raw: unknown): string {
    if (!schedule_raw || typeof schedule_raw !== "object") return "unknown";
    const schedule = schedule_raw as Record<string, unknown>;
    const kind = String(schedule.kind || "").toLowerCase();
    if (kind === "every") {
      const sec = Math.max(1, Math.floor(Number(schedule.every_ms || 0) / 1000));
      return `every ${sec}s`;
    }
    if (kind === "at") {
      return `at ${this.format_cron_time_kr(schedule.at_ms)}`;
    }
    if (kind === "cron") {
      const expr = String(schedule.expr || "").trim() || "(empty)";
      const tz = String(schedule.tz || "").trim();
      return tz ? `cron ${expr} tz=${tz}` : `cron ${expr}`;
    }
    return kind || "unknown";
  }

  private format_cron_status_response(
    provider: ChannelProvider,
    sender_id: string,
    status: { enabled: boolean; paused?: boolean; jobs: number; next_wake_at_ms: number | null },
  ): string {
    const mention = provider === "telegram" ? "" : `@${sender_id} `;
    const enabled = Boolean(status.enabled);
    const paused = Boolean(status.paused);
    const jobs = Math.max(0, Number(status.jobs || 0));
    const next = this.format_cron_time_kr(status.next_wake_at_ms);
    return [
      `${mention}⏱ cron 상태`,
      `- enabled: ${enabled ? "yes" : "no"}`,
      `- paused: ${paused ? "yes" : "no"}`,
      `- jobs: ${jobs}`,
      `- next_wake: ${next}`,
    ].join("\n").trim();
  }

  private format_cron_list_response(
    provider: ChannelProvider,
    sender_id: string,
    rows: Array<Record<string, unknown>>,
  ): string {
    const mention = provider === "telegram" ? "" : `@${sender_id} `;
    if (rows.length === 0) return `${mention}⏱ 등록된 cron 작업이 없습니다.`.trim();
    const head = `${mention}⏱ cron 작업 목록 (${rows.length})`;
    const body = rows.slice(0, 10).map((row, idx) => {
      const id = String(row.id || "").trim() || `job-${idx + 1}`;
      const name = String(row.name || "").trim() || "(no-name)";
      const enabled = row.enabled === true ? "on" : "off";
      const state = (row.state && typeof row.state === "object") ? (row.state as Record<string, unknown>) : {};
      const next = this.format_cron_time_kr(state.next_run_at_ms);
      const schedule = this.render_cron_schedule(row.schedule);
      return `${idx + 1}. ${id} | ${name} | ${enabled} | ${schedule} | next=${next}`;
    });
    const tail = rows.length > 10 ? [`... and ${rows.length - 10} more`] : [];
    return [head, ...body, ...tail].join("\n").trim();
  }

  private format_cron_add_usage(provider: ChannelProvider, sender_id: string): string {
    const mention = provider === "telegram" ? "" : `@${sender_id} `;
    return [
      `${mention}cron add 형식`,
      "- /cron add every 10m <message>",
      "- /cron add at 2026-02-26T01:40:00+09:00 <message>",
      "- /cron add cron 40 1 * * * tz Asia/Seoul <message>",
      "- 자연어: '10분 후 알림 ...', '새벽 1시 40분 ...'",
    ].join("\n").trim();
  }

  private format_cron_remove_usage(provider: ChannelProvider, sender_id: string): string {
    const mention = provider === "telegram" ? "" : `@${sender_id} `;
    return `${mention}cron remove 형식: /cron remove <job_id>`.trim();
  }

  private format_cron_add_response(
    provider: ChannelProvider,
    sender_id: string,
    job_raw: unknown,
  ): string {
    const mention = provider === "telegram" ? "" : `@${sender_id} `;
    const job = (job_raw && typeof job_raw === "object") ? (job_raw as Record<string, unknown>) : {};
    const id = String(job.id || "").trim() || "(unknown)";
    const name = String(job.name || "").trim() || "(no-name)";
    const schedule_text = this.render_cron_schedule(job.schedule);
    const state = (job.state && typeof job.state === "object") ? (job.state as Record<string, unknown>) : {};
    const next = this.format_cron_time_kr(state.next_run_at_ms);
    const auto_remove = job.delete_after_run === true ? "yes" : "no";
    return [
      `${mention}⏱ cron 등록 완료`,
      `- id: ${id}`,
      `- name: ${name}`,
      `- schedule: ${schedule_text}`,
      `- next_run: ${next}`,
      `- auto_remove_after_run: ${auto_remove}`,
    ].join("\n").trim();
  }

  private async try_handle_cron_quick_command(
    provider: ChannelProvider,
    message: InboundMessage,
    command: ParsedSlashCommand | null,
  ): Promise<boolean> {
    if (!this.cron) return false;
    const action = this.parse_cron_quick_action(message, command);
    const natural_add = action ? null : this.parse_natural_cron_add_spec(message);
    if (!action && !natural_add) return false;
    let content = "";
    try {
      if (action === "status") {
        const status = await this.cron.status();
        content = this.format_cron_status_response(provider, message.sender_id, status);
      } else if (action === "list") {
        const rows = await this.cron.list_jobs(true);
        content = this.format_cron_list_response(
          provider,
          message.sender_id,
          rows as unknown as Array<Record<string, unknown>>,
        );
      } else if (action === "remove") {
        const job_id = this.parse_cron_remove_job_id(message, command);
        if (!job_id) {
          content = this.format_cron_remove_usage(provider, message.sender_id);
        } else {
          const removed = await this.cron.remove_job(job_id);
          const mention = provider === "telegram" ? "" : `@${message.sender_id} `;
          content = removed
            ? `${mention}⏱ cron 작업 삭제 완료: ${job_id}`.trim()
            : `${mention}⏱ cron 작업을 찾지 못했습니다: ${job_id}`.trim();
        }
      } else {
        const spec = natural_add || this.parse_cron_quick_add_spec(message, command);
        if (!spec) {
          content = this.format_cron_add_usage(provider, message.sender_id);
        } else {
          const job = await this.cron.add_job(
            spec.name,
            spec.schedule,
            spec.message,
            spec.deliver,
            provider,
            message.chat_id,
            spec.delete_after_run,
          );
          content = this.format_cron_add_response(provider, message.sender_id, job);
        }
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const mention = provider === "telegram" ? "" : `@${message.sender_id} `;
      content = `${mention}cron ${action || "add"} 처리 실패: ${reason}`.trim();
    }
    await this.send_command_reply(provider, message, content, {
      kind: "cron_quick",
      action: action || "add",
    });
    return true;
  }

  private async cancel_active_runs(provider: ChannelProvider, chat_id: string): Promise<number> {
    let count = 0;
    for (const run of this.active_runs.values()) {
      if (run.provider !== provider) continue;
      if (run.chat_id !== chat_id) continue;
      run.abort.abort();
      count += 1;
    }
    return count;
  }

  private extract_approval_request_id(text: string): string | null {
    const raw = String(text || "");
    const m = raw.match(/\brequest[_\s-]?id\s*[:=]\s*([a-z0-9-]{6,})\b/i)
      || raw.match(/\bapproval[_\s-]?request[_\s-]?id\s*[:=]\s*([a-z0-9-]{6,})\b/i)
      || raw.match(/\b([a-z0-9]{8,12})\b/i);
    if (!m) return null;
    return String(m[1] || "").trim() || null;
  }

  private async try_handle_approval_reply(provider: ChannelProvider, message: InboundMessage): Promise<boolean> {
    if (!this.agent) return false;
    const text = String(message.content || "").trim();
    if (!text) return false;
    const tools = this.agent.tools;
    const pending = tools.list_approval_requests("pending");
    if (pending.length === 0) return false;

    const explicit_id = this.extract_approval_request_id(text);
    const same_chat = pending.filter((r) =>
      String(r.context?.channel || "").toLowerCase() === provider &&
      String(r.context?.chat_id || "") === String(message.chat_id || ""),
    );
    const selected = (explicit_id
      ? pending.find((r) => r.request_id === explicit_id)
      : same_chat[0]) || null;
    if (!selected) return false;
    return this.apply_approval_decision(provider, message, selected.request_id, text, "text");
  }

  private async apply_approval_decision(
    provider: ChannelProvider,
    message: InboundMessage,
    request_id: string,
    decision_input: string,
    source: "text" | "reaction",
  ): Promise<boolean> {
    if (!this.agent) return false;
    const tools = this.agent.tools;
    const selected = tools.get_approval_request(request_id);
    if (!selected) return false;

    const resolved = tools.resolve_approval_request(selected.request_id, decision_input);
    if (!resolved.ok) return false;

    if (resolved.status === "approved") {
      const executed = await tools.execute_approved_request(selected.request_id);
      const summary = executed.ok
        ? `✅ 승인 반영 완료(${source}) · tool=${executed.tool_name}\n${String(executed.result || "").slice(0, 700)}`
        : `🔴 승인 반영 실패(${source}) · tool=${executed.tool_name || selected.tool_name}\n${String(executed.error || "unknown_error").slice(0, 220)}`;
      await this.send_with_retry(provider, {
        id: `${provider}-${Date.now()}`,
        provider,
        channel: provider,
        sender_id: "approval-bot",
        chat_id: message.chat_id,
        content: summary,
        at: new Date().toISOString(),
        reply_to: this.resolve_reply_to(provider, message),
        thread_id: message.thread_id,
        metadata: {
          kind: "approval_result",
          request_id: selected.request_id,
          tool_name: selected.tool_name,
          decision: resolved.decision,
        },
      }, { source: "approval_result" });
      return true;
    }

    const status_text = resolved.status === "denied"
      ? "❌ 승인 거부됨"
      : resolved.status === "deferred"
        ? "⏸️ 승인 보류됨"
      : resolved.status === "cancelled"
          ? "⛔ 승인 취소됨"
          : "ℹ️ 승인 판단 보류";
    await this.send_with_retry(provider, {
      id: `${provider}-${Date.now()}`,
      provider,
      channel: provider,
      sender_id: "approval-bot",
      chat_id: message.chat_id,
      content: `${status_text}(${source}) · request_id=${selected.request_id} · tool=${selected.tool_name}`,
      at: new Date().toISOString(),
      reply_to: this.resolve_reply_to(provider, message),
      thread_id: message.thread_id,
      metadata: {
        kind: "approval_result",
        request_id: selected.request_id,
        tool_name: selected.tool_name,
        decision: resolved.decision,
      },
    }, { source: "approval_result" });
    return true;
  }

  private extract_reaction_names(message: InboundMessage): string[] {
    const meta = (message.metadata || {}) as Record<string, unknown>;
    const slack = (meta.slack && typeof meta.slack === "object") ? (meta.slack as Record<string, unknown>) : null;
    if (!slack) return [];
    const reactions = Array.isArray(slack.reactions) ? (slack.reactions as Array<Record<string, unknown>>) : [];
    return reactions
      .map((row) => String(row.name || "").trim().toLowerCase())
      .filter(Boolean);
  }

  private reaction_decision_from_names(names: string[]): "approve" | "deny" | "defer" | "cancel" | null {
    const set = new Set(names.map((n) => n.toLowerCase()));
    const approve = ["white_check_mark", "heavy_check_mark", "thumbsup", "+1", "green_heart", "large_green_circle", "ok_hand"];
    const deny = ["x", "thumbsdown", "-1", "no_entry", "no_entry_sign", "red_circle"];
    const defer = ["hourglass_flowing_sand", "hourglass", "pause_button", "thinking_face"];
    const cancel = ["octagonal_sign", "stop_sign"];
    if (approve.some((n) => set.has(n))) return "approve";
    if (deny.some((n) => set.has(n))) return "deny";
    if (defer.some((n) => set.has(n))) return "defer";
    if (cancel.some((n) => set.has(n))) return "cancel";
    return null;
  }

  private mark_reaction_action_seen(key: string): void {
    this.reaction_actions_seen.set(key, Date.now());
    if (this.reaction_actions_seen.size > this.seen_max_size + 1_000) {
      this.prune_reaction_actions_seen(true);
    }
  }

  private has_reaction_action_seen(key: string): boolean {
    return this.reaction_actions_seen.has(key);
  }

  private prune_reaction_actions_seen(force_size_trim: boolean): void {
    if (this.reaction_actions_seen.size === 0) return;
    const now = Date.now();
    for (const [key, ts] of this.reaction_actions_seen.entries()) {
      if (now - ts > this.reaction_action_ttl_ms) {
        this.reaction_actions_seen.delete(key);
      }
    }
    if (!force_size_trim && this.reaction_actions_seen.size <= this.seen_max_size) return;
    const overflow = this.reaction_actions_seen.size - this.seen_max_size;
    if (overflow <= 0) return;
    let removed = 0;
    for (const key of this.reaction_actions_seen.keys()) {
      this.reaction_actions_seen.delete(key);
      removed += 1;
      if (removed >= overflow) break;
    }
  }

  private async try_handle_reaction_controls(provider: ChannelProvider, rows: InboundMessage[]): Promise<void> {
    if (provider !== "slack") return;
    if (!this.agent) return;
    if (!Array.isArray(rows) || rows.length === 0) return;
    if (this.approval_reaction_enabled) {
      await this.try_handle_approval_reactions(provider, rows);
    }
    if (this.control_reaction_enabled) {
      await this.try_handle_stop_reactions(provider, rows);
    }
  }

  private async try_handle_approval_reactions(provider: ChannelProvider, rows: InboundMessage[]): Promise<void> {
    if (!this.agent) return;
    const pending = this.agent.tools.list_approval_requests("pending");
    if (pending.length <= 0) return;
    const sorted = [...rows].sort((a, b) => this.extract_timestamp_ms(b) - this.extract_timestamp_ms(a));
    for (const row of sorted.slice(0, 80)) {
      const request_id = this.extract_approval_request_id(String(row.content || ""));
      if (!request_id) continue;
      const request = pending.find((p) => p.request_id === request_id);
      if (!request) continue;
      const names = this.extract_reaction_names(row);
      if (names.length === 0) continue;
      const decision = this.reaction_decision_from_names(names);
      if (!decision) continue;
      const signature = `${provider}:${row.chat_id}:${request_id}:${decision}:${names.sort().join(",")}`;
      if (this.has_reaction_action_seen(signature)) continue;
      this.mark_reaction_action_seen(signature);
      const decision_input = decision === "approve"
        ? "✅"
        : decision === "deny"
          ? "❌"
          : decision === "defer"
            ? "⏸️"
            : "⛔";
      await this.apply_approval_decision(provider, row, request_id, decision_input, "reaction");
      return;
    }
  }

  private async try_handle_stop_reactions(provider: ChannelProvider, rows: InboundMessage[]): Promise<void> {
    if (this.active_runs.size <= 0) return;
    const stop_tokens = new Set(["stop_sign", "octagonal_sign", "no_entry", "no_entry_sign"]);
    const now = Date.now();
    const sorted = [...rows].sort((a, b) => this.extract_timestamp_ms(b) - this.extract_timestamp_ms(a));
    for (const row of sorted.slice(0, 50)) {
      const ts = this.extract_timestamp_ms(row);
      if (ts > 0 && (now - ts) > 10 * 60_000) continue;
      const names = this.extract_reaction_names(row);
      const has_stop = names.some((name) => stop_tokens.has(name));
      if (!has_stop) continue;
      const row_id = String(row.metadata?.message_id || row.id || "").trim();
      if (!row_id) continue;
      const signature = `${provider}:${row.chat_id}:${row_id}:stop:${names.sort().join(",")}`;
      if (this.has_reaction_action_seen(signature)) continue;
      this.mark_reaction_action_seen(signature);
      const cancelled = await this.cancel_active_runs(provider, row.chat_id);
      if (cancelled <= 0) continue;
      await this.send_with_retry(provider, {
        id: `${provider}-${Date.now()}`,
        provider,
        channel: provider,
        sender_id: this.default_agent_alias,
        chat_id: row.chat_id,
        content: `⛔ 반응 기반 중지 처리: 실행 중 작업 ${cancelled}건을 중지했습니다.`,
        at: new Date().toISOString(),
        reply_to: this.resolve_reply_to(provider, row),
        thread_id: row.thread_id,
        metadata: {
          kind: "reaction_control",
          action: "stop",
          source_message_id: row_id,
        },
      }, { source: "reaction_control" });
      return;
    }
  }

  private resolve_provider(message: OutboundMessage): ChannelProvider | null {
    const raw = String(message.provider || message.channel || "").toLowerCase();
    if (raw === "slack" || raw === "discord" || raw === "telegram") return raw;
    return null;
  }

  private resolve_target(provider: ChannelProvider): string {
    if (this.targets[provider]) return String(this.targets[provider] || "");
    if (provider === "slack") return String(process.env.SLACK_DEFAULT_CHANNEL || "");
    if (provider === "discord") return String(process.env.DISCORD_DEFAULT_CHANNEL || "");
    if (provider === "telegram") return String(process.env.TELEGRAM_DEFAULT_CHAT_ID || "");
    return "";
  }

  private dedupe_key(message: InboundMessage): string {
    const id = String(message.metadata?.message_id || message.id || "");
    return `${message.provider}:${message.chat_id}:${id}`;
  }

  private is_duplicate(message: InboundMessage): boolean {
    const key = this.dedupe_key(message);
    return key.endsWith(":") ? false : this.seen.has(key);
  }

  private mark_seen(message: InboundMessage): void {
    const key = this.dedupe_key(message);
    if (key.endsWith(":")) return;
    this.seen.set(key, Date.now());
    if (this.seen.size > this.seen_max_size + 1_000) {
      this.prune_seen_cache(true);
    }
  }

  private prune_seen_cache(force_size_trim: boolean): void {
    if (this.seen.size === 0) return;
    const now = Date.now();
    if (this.seen_ttl_ms > 0) {
      for (const [key, ts] of this.seen.entries()) {
        if (now - ts > this.seen_ttl_ms) {
          this.seen.delete(key);
        }
      }
    }
    if (!force_size_trim && this.seen.size <= this.seen_max_size) return;
    const overflow = this.seen.size - this.seen_max_size;
    if (overflow <= 0) return;
    let removed = 0;
    for (const key of this.seen.keys()) {
      this.seen.delete(key);
      removed += 1;
      if (removed >= overflow) break;
    }
  }

  private extract_timestamp_ms(message: InboundMessage): number {
    const raw = String(message.metadata?.message_id || message.id || "").trim();
    if (!raw) return 0;
    if (/^\d+$/.test(raw)) return Number(raw) || 0;
    if (/^\d+\.\d+$/.test(raw)) return Math.floor((Number(raw) || 0) * 1000);
    return 0;
  }
}
