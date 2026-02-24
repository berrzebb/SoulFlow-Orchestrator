import type { MessageBus } from "../bus/index.js";
import type { InboundMessage, OutboundMessage, MediaItem } from "../bus/types.js";
import type { ProviderRegistry } from "../providers/index.js";
import type { AgentDomain } from "../agent/index.js";
import type { SessionStore } from "../session/index.js";
import { create_default_channels, type ChannelProvider, type ChannelRegistry } from "./index.js";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import type { TaskNode } from "../agent/loop.js";

export type ChannelManagerStatus = {
  running: boolean;
  dispatch_running: boolean;
  mention_loop_running: boolean;
  enabled_channels: ChannelProvider[];
};

export class ChannelManager {
  readonly bus: MessageBus;
  readonly registry: ChannelRegistry;
  readonly providers: ProviderRegistry | null;
  readonly agent: AgentDomain | null;
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

  constructor(args: {
    bus: MessageBus;
    registry?: ChannelRegistry;
    provider_hint?: string;
    providers?: ProviderRegistry | null;
    agent?: AgentDomain | null;
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
    this.grouping_enabled = String(process.env.CHANNEL_GROUPING_ENABLED || "1").trim() !== "0";
    this.grouping_window_ms = Math.max(500, Number(process.env.CHANNEL_GROUPING_WINDOW_MS || 3500));
    this.grouping_max_messages = Math.max(2, Number(process.env.CHANNEL_GROUPING_MAX_MESSAGES || 8));
    this.seen_ttl_ms = Math.max(60_000, Number(process.env.CHANNEL_SEEN_TTL_MS || 86_400_000));
    this.seen_max_size = Math.max(2_000, Number(process.env.CHANNEL_SEEN_MAX_SIZE || 50_000));
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
        const target = this.resolve_target(provider);
        if (!target) continue;
        try {
          const rows = await this.registry.read(provider, target, this.read_limit);
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
    await this.registry.send(provider, message);
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
    const cmd = this.extract_command_name(message);
    if (cmd === "stop" || cmd === "cancel" || cmd === "중지") {
      const cancelled = await this.cancel_active_runs(provider, message.chat_id);
      await this.registry.send(provider, {
        id: `${provider}-${Date.now()}`,
        provider,
        channel: provider,
        sender_id: this.default_agent_alias,
        chat_id: message.chat_id,
        content: cancelled > 0
          ? `@${message.sender_id} ⛔ 실행 중 작업 ${cancelled}건을 중지했습니다.`
          : `@${message.sender_id} 중지할 실행 작업이 없습니다.`,
        at: new Date().toISOString(),
        reply_to: this.resolve_reply_to(provider, message),
        thread_id: message.thread_id,
      });
      return;
    }
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
      const rendered = this.build_user_render_payload(result.reply, provider);
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
      const rendered = this.build_user_render_payload(result.reply, provider);
      const routed = await this.route_agent_reply({
        provider,
        chat_id: message.chat_id,
        agent_alias: alias,
        content: rendered.content,
        media: rendered.media,
        mention_sender: true,
        sender_alias: message.sender_id,
        limit: 50,
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
    const cmd = this.extract_command_name(message);
    if (cmd) return true;
    const text = String(message.content || "").trim();
    if (!text) return false;
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
    const sender = String(message.sender_id || "").trim().toLowerCase();
    if (!sender || sender === "unknown" || sender.startsWith("subagent:") || sender === "approval-bot") return true;

    const meta = (message.metadata || {}) as Record<string, unknown>;
    const slack = (meta.slack && typeof meta.slack === "object") ? (meta.slack as Record<string, unknown>) : null;
    if (!slack) return false;

    const subtype = String(slack.subtype || "").toLowerCase();
    const has_bot_id = typeof slack.bot_id === "string" && slack.bot_id.length > 0;
    if (has_bot_id) return true;
    if (subtype === "bot_message" || subtype === "message_changed" || subtype === "message_deleted") return true;
    return false;
  }

  private async invoke_headless_agent(
    message: InboundMessage,
    alias: string,
  ): Promise<{ reply: string | null; error?: string }> {
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
      String(process.env.ORCH_EXECUTOR_PROVIDER || "chatgpt").trim() as
      "claude_code" | "chatgpt" | "openrouter"
    );
    const default_executor = this.resolve_executor_provider(preferred_executor);
    const run_key = `${channel_provider}:${message.chat_id}:${alias}`.toLowerCase();
    const abort = new AbortController();
    this.active_runs.set(run_key, { abort, provider: channel_provider, chat_id: message.chat_id, alias });
    let live_preview = "";
    let stream_buffer = "";
    let last_stream_emit_at = 0;
    let stream_emitted_count = 0;
    let last_stream_sent_key = "";
    let last_stream_sent_at = 0;
    const should_skip_duplicate_stream = (content: string): boolean => {
      const key = String(content || "").replace(/\s+/g, " ").trim().toLowerCase();
      if (!key) return true;
      const now = Date.now();
      if (key === last_stream_sent_key && now - last_stream_sent_at < 30_000) return true;
      last_stream_sent_key = key;
      last_stream_sent_at = now;
      return false;
    };
    const started_at_ms = Date.now();
    const typingTicker = setInterval(() => {
      void this.registry.set_typing(channel_provider, message.chat_id, true);
    }, 4000);
    const pulse_enabled = this.progress_pulse_enabled;
    const pulseTicker = pulse_enabled
      ? setInterval(() => {
          const elapsed_sec = Math.max(1, Math.floor((Date.now() - started_at_ms) / 1000));
          const preview = live_preview ? ` | ${live_preview}` : "";
          const fallback = !preview && stream_emitted_count === 0
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
      const always_skills = agent_domain.context.skills_loader.get_always_skills();
      const task = String(message.content || "").trim();
      const media_inputs = await this.collect_inbound_media_inputs(channel_provider, message);
      const task_with_media = this.compose_task_with_media(task, media_inputs);
      const provider_hint = default_executor;
      const session_history = await this.get_session_history(channel_provider, message.chat_id, alias, 24);
      const mode = this.pick_loop_mode(task_with_media);
      this.apply_tool_runtime_context(agent_domain, channel_provider, message);

      const run_once = async (
        provider_id: "claude_code" | "chatgpt" | "openrouter",
      ): Promise<{ reply: string | null; error?: string }> => {
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
            abort,
          });
        }

        const response = await agent_domain.loop.run_agent_loop({
          loop_id: `loop-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          agent_id: alias,
          objective: task_with_media || task || "handle inbound request",
          context_builder: agent_domain.context,
          providers: orchestrator,
          provider_id,
          current_message: [
            ...session_history.map((r) => `[${r.role}] ${r.content}`),
            task_with_media,
          ].filter(Boolean).join("\n\n"),
          history_days: [],
          skill_names: always_skills,
          media: media_inputs,
          channel: channel_provider,
          chat_id: message.chat_id,
          max_turns: Math.max(1, Number(process.env.AGENT_LOOP_MAX_TURNS || 8)),
          model: undefined,
          max_tokens: 1800,
          temperature: 0.3,
          abort_signal: abort.signal,
          on_stream: async (chunk) => {
            const part = this.sanitize_stream_chunk(String(chunk || ""));
            if (!part) return;
            live_preview = this.squash_for_preview(`${live_preview} ${part}`);
            if (!this.stream_emit_enabled) return;
            stream_buffer += part;
            const now = Date.now();
            const due_by_size = stream_buffer.length >= this.stream_emit_min_chars;
            const due_by_time = stream_buffer.length > 0 && (now - last_stream_emit_at >= this.stream_emit_interval_ms);
            if (!due_by_size && !due_by_time) return;
            const content = this.format_stream_content(channel_provider, stream_buffer);
            stream_buffer = "";
            last_stream_emit_at = now;
            if (!content) return;
            if (should_skip_duplicate_stream(content)) return;
            stream_emitted_count += 1;
            const sent = await this.registry.send(channel_provider, {
              id: `stream-${Date.now()}`,
              provider: channel_provider,
              channel: channel_provider,
              sender_id: alias,
              chat_id: message.chat_id,
              content,
              at: new Date().toISOString(),
              reply_to: this.resolve_reply_to(channel_provider, message),
              thread_id: message.thread_id,
              metadata: { kind: "agent_stream", agent_alias: alias },
            });
            if (!sent.ok && this.debug) {
              // eslint-disable-next-line no-console
              console.log(`[channel-manager] stream send failed provider=${channel_provider} alias=${alias} err=${sent.error || "unknown_error"}`);
            }
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
        if (this.stream_emit_enabled && stream_buffer.trim()) {
          const tail = this.format_stream_content(channel_provider, stream_buffer);
          stream_buffer = "";
          if (tail) {
            if (!should_skip_duplicate_stream(tail)) {
              stream_emitted_count += 1;
              const sent = await this.registry.send(channel_provider, {
                id: `stream-${Date.now()}`,
                provider: channel_provider,
                channel: channel_provider,
                sender_id: alias,
                chat_id: message.chat_id,
                content: tail,
                at: new Date().toISOString(),
                reply_to: this.resolve_reply_to(channel_provider, message),
                thread_id: message.thread_id,
                metadata: { kind: "agent_stream", agent_alias: alias },
              });
              if (!sent.ok && this.debug) {
                // eslint-disable-next-line no-console
                console.log(`[channel-manager] stream tail send failed provider=${channel_provider} alias=${alias} err=${sent.error || "unknown_error"}`);
              }
            }
          }
        }
        const content = this.sanitize_provider_output(String(response.final_content || ""));
        if (!content) return { reply: null, error: "empty_provider_response" };
        const providerError = this.extract_provider_error(content);
        if (providerError) return { reply: null, error: providerError };
        return { reply: this.normalize_agent_reply(content, alias, message.sender_id) };
      };

      const primary_provider = this.resolve_executor_provider(provider_hint);
      const first = await run_once(primary_provider);
      if (first.reply) return first;

      // One-shot fallback for CLI executor startup failures.
      if (primary_provider === "claude_code") {
        const fallback_provider = this.resolve_executor_provider("chatgpt");
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

  private async run_task_loop_for_message(args: {
    agent_domain: AgentDomain;
    provider_id: "claude_code" | "chatgpt" | "openrouter";
    alias: string;
    channel_provider: ChannelProvider;
    message: InboundMessage;
    task_with_media: string;
    media_inputs: string[];
    session_history: Array<{ role: "system" | "user" | "assistant" | "tool"; content: string }>;
    abort: AbortController;
  }): Promise<{ reply: string | null; error?: string }> {
    const always_skills = args.agent_domain.context.skills_loader.get_always_skills();
    const task_id = `task:${args.channel_provider}:${args.message.chat_id}:${args.alias}`.toLowerCase();
    let last_task_stream_key = "";
    let last_task_stream_at = 0;
    const should_skip_duplicate_task_stream = (content: string): boolean => {
      const key = String(content || "").replace(/\s+/g, " ").trim().toLowerCase();
      if (!key) return true;
      const now = Date.now();
      if (key === last_task_stream_key && now - last_task_stream_at < 30_000) return true;
      last_task_stream_key = key;
      last_task_stream_at = now;
      return false;
    };
    const seed = [
      ...args.session_history.map((r) => `[${r.role}] ${r.content}`),
      args.task_with_media,
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
            provider_id: args.provider_id,
            current_message: String(memory.seed_prompt || seed),
            history_days: [],
            skill_names: always_skills,
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
              const part = this.sanitize_stream_chunk(String(chunk || ""));
              if (!part) return;
              const content = this.format_stream_content(args.channel_provider, part);
              if (!content) return;
              if (should_skip_duplicate_task_stream(content)) return;
              const sent = await this.registry.send(args.channel_provider, {
                id: `stream-${Date.now()}`,
                provider: args.channel_provider,
                channel: args.channel_provider,
                sender_id: args.alias,
                chat_id: args.message.chat_id,
                content,
                at: new Date().toISOString(),
                reply_to: this.resolve_reply_to(args.channel_provider, args.message),
                thread_id: args.message.thread_id,
                metadata: { kind: "agent_stream", agent_alias: args.alias },
              });
              if (!sent.ok && this.debug) {
                // eslint-disable-next-line no-console
                console.log(`[channel-manager] task stream send failed provider=${args.channel_provider} alias=${args.alias} err=${sent.error || "unknown_error"}`);
              }
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
      return { reply: "승인 대기 상태입니다. 승인 응답 후 같은 작업을 재개합니다." };
    }
    if (!output) {
      return { reply: null, error: `task_loop_no_output:${task_result.state.status}` };
    }
    const providerError = this.extract_provider_error(output);
    if (providerError) return { reply: null, error: providerError };
    return { reply: this.normalize_agent_reply(output, args.alias, args.message.sender_id) };
  }

  private resolve_executor_provider(
    preferred: "claude_code" | "chatgpt" | "openrouter",
  ): "claude_code" | "chatgpt" | "openrouter" {
    const chatgptHeadless = String(process.env.CHATGPT_HEADLESS_COMMAND || "").trim();
    const claudeHeadless = String(process.env.CLAUDE_HEADLESS_COMMAND || "").trim();
    const allowClaude = String(process.env.ALLOW_CLAUDE_CODE_EXECUTOR || "0").trim() === "1";
    const openrouterApiKey = String(process.env.OPENROUTER_API_KEY || "").trim();
    if (preferred === "openrouter") {
      if (openrouterApiKey) return "openrouter";
      if (chatgptHeadless) return "chatgpt";
      if (allowClaude && claudeHeadless) return "claude_code";
      return "openrouter";
    }
    if (preferred === "claude_code") {
      if (chatgptHeadless) return "chatgpt";
      if (openrouterApiKey) return "openrouter";
      if (allowClaude && claudeHeadless) return "claude_code";
      return "chatgpt";
    }
    if (chatgptHeadless) return "chatgpt";
    if (allowClaude && claudeHeadless) return "claude_code";
    if (openrouterApiKey) return "openrouter";
    return "chatgpt";
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

  private format_stream_content(provider: ChannelProvider, raw: string): string {
    const cleaned = this.sanitize_provider_output(String(raw || "")).trim();
    if (!cleaned) return "";
    const clipped = cleaned
      .split("\n")
      .slice(-12)
      .join("\n")
      .trim()
      .slice(0, 700);
    if (!clipped) return "";
    return this.apply_channel_codeblock_format(provider, clipped);
  }

  private session_key(provider: ChannelProvider, chat_id: string, alias: string): string {
    return `${provider}:${chat_id}:${alias}`.toLowerCase();
  }

  private async get_session_history(
    provider: ChannelProvider,
    chat_id: string,
    alias: string,
    max_messages: number,
  ): Promise<Array<{ role: "system" | "user" | "assistant" | "tool"; content: string }>> {
    if (!this.sessions) return [];
    try {
      const key = this.session_key(provider, chat_id, alias);
      const session = await this.sessions.get_or_create(key);
      const rows = session.get_history(max_messages);
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

  private async record_user_message(provider: ChannelProvider, message: InboundMessage, alias: string): Promise<void> {
    if (!this.sessions) return;
    try {
      const key = this.session_key(provider, message.chat_id, alias);
      const session = await this.sessions.get_or_create(key);
      session.add_message("user", String(message.content || ""), {
        sender_id: message.sender_id,
        at: message.at,
      });
      await this.sessions.save(session);
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
      const key = this.session_key(provider, message.chat_id, alias);
      const session = await this.sessions.get_or_create(key);
      session.add_message("assistant", String(content || ""), {
        sender_id: alias,
        at: new Date().toISOString(),
      });
      await this.sessions.save(session);
    } catch {
      // no-op
    }
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
    const clean = this.strip_ansi(String(raw || ""))
      .replace(/\r/g, "")
      .replace(/<<ORCH_FINAL>>/g, "")
      .replace(/<<ORCH_FINAL_END>>/g, "");
    if (!clean) return "";
    const lines = clean
      .split("\n")
      .map((l) => l.trimEnd())
      .filter((l) => !this.is_provider_noise_line(l))
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
      if (m?.url) push(String(m.url));
    }
    if (provider === "slack") {
      const files = this.extract_slack_files(message);
      for (const f of files) {
        const saved = await this.download_slack_file(f.url, f.name);
        push(saved || f.url);
      }
    }
    if (provider === "telegram") {
      const ids = this.extract_telegram_file_ids(message);
      for (const id of ids) {
        const saved = await this.download_telegram_file(id);
        if (saved) push(saved);
      }
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

  private make_safe_filename(name: string): string {
    const raw = String(name || "").trim() || "file.bin";
    return raw.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").slice(0, 120);
  }

  private async ensure_inbound_files_dir(provider: ChannelProvider): Promise<string> {
    const dir = join(this.workspace_dir, "runtime", "inbound-files", provider);
    await mkdir(dir, { recursive: true });
    return dir;
  }

  private build_user_render_payload(raw: string, provider: ChannelProvider): { content: string; media: MediaItem[] } {
    const pretty = this.prettify_user_output(raw, provider);
    const extracted = this.extract_media_items(pretty);
    const content = extracted.content || (extracted.media.length > 0 ? "첨부 파일을 확인해주세요." : "");
    return {
      content: content.slice(0, 1600),
      media: extracted.media.slice(0, 4),
    };
  }

  private prettify_user_output(raw: string, provider: ChannelProvider): string {
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
      return this.apply_channel_codeblock_format(provider, lines.join("\n")).slice(0, 1600);
    }

    const hasBullet = lines.some((l) => /^(\-|\*|\d+\.)\s+/.test(l.trim()));
    if (hasBullet) {
      return this.apply_channel_codeblock_format(provider, lines.join("\n")).slice(0, 1600);
    }

    const one = lines.join(" ").replace(/\s+/g, " ").trim();
    const chunks = one
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (chunks.length >= 2) {
      const head = chunks[0];
      const tail = chunks.slice(1, 5).map((s) => `- ${s}`);
      return this.apply_channel_codeblock_format(provider, [`${head}`, ...tail].join("\n")).slice(0, 1600);
    }
    return this.apply_channel_codeblock_format(provider, one).slice(0, 1600);
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
    const text = this.strip_ansi(String(raw || "")).replace(/\r/g, "");
    if (!text) return "";
    const lines = text
      .split("\n")
      .map((l) => l.trimEnd())
      .filter((l) => !this.is_provider_noise_line(l))
      .filter((l) => !this.is_sensitive_command_line(l));
    return lines.join("\n").trim();
  }

  private strip_sensitive_command_blocks(raw: string): string {
    let out = String(raw || "");
    out = out.replace(/```(?:bash|sh|zsh|powershell|pwsh|cmd|shell)[\s\S]*?```/gi, "");
    out = out.replace(/```(?:ps1|bat)[\s\S]*?```/gi, "");
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

  private has_markdown_table(lines: string[]): boolean {
    const body = lines.filter((l) => /\|/.test(l));
    if (body.length < 2) return false;
    return body.some((l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(l));
  }

  private extract_media_items(text: string): { content: string; media: MediaItem[] } {
    let content = String(text || "");
    const media: MediaItem[] = [];
    const seen = new Set<string>();
    const push_media = (urlRaw: string, alt?: string): void => {
      const url = String(urlRaw || "").trim();
      if (!url || seen.has(url)) return;
      const type = this.detect_media_type(url);
      if (!type) return;
      seen.add(url);
      media.push({
        type,
        url,
        name: alt ? alt.slice(0, 120) : undefined,
      });
    };

    content = content.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_m, alt, url) => {
      push_media(String(url || ""), String(alt || ""));
      return "";
    });
    content = content.replace(/<(?:img|video)[^>]*src=["']([^"']+)["'][^>]*>/gi, (_m, url) => {
      push_media(String(url || ""));
      return "";
    });
    content = content.replace(/\[(IMAGE|VIDEO|FILE)\s*:\s*([^\]]+)\]/gi, (_m, _kind, url) => {
      push_media(String(url || ""));
      return "";
    });

    const plain_urls = content.match(/https?:\/\/[^\s)]+/gi) || [];
    for (const url of plain_urls) {
      const type = this.detect_media_type(url);
      if (!type) continue;
      push_media(url);
      content = content.replace(url, "");
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
    const sent = await this.registry.send(provider, {
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
    });
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
    const m = text.match(/^Error calling ([A-Za-z0-9_-]+):\s*(.*)$/i);
    if (m) {
      const provider = String(m[1] || "provider").toLowerCase();
      const body = String(m[2] || "").trim() || "error";
      return `${provider}:${body}`.slice(0, 180);
    }
    return text.slice(0, 180);
  }

  private extract_command_name(message: InboundMessage): string {
    const meta = (message.metadata || {}) as Record<string, unknown>;
    const command = (meta.command && typeof meta.command === "object")
      ? (meta.command as Record<string, unknown>)
      : null;
    if (command && typeof command.name === "string") {
      return String(command.name || "").trim().toLowerCase();
    }
    const raw = String(message.content || "").trim();
    if (!raw.startsWith("/")) return "";
    const first = raw.slice(1).split(/\s+/)[0] || "";
    return first.toLowerCase();
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

    const resolved = tools.resolve_approval_request(selected.request_id, text);
    if (!resolved.ok) return false;

    if (resolved.status === "approved") {
      const executed = await tools.execute_approved_request(selected.request_id);
      const summary = executed.ok
        ? `✅ 승인 반영 완료 · tool=${executed.tool_name}\n${String(executed.result || "").slice(0, 700)}`
        : `🔴 승인 반영 실패 · tool=${executed.tool_name || selected.tool_name}\n${String(executed.error || "unknown_error").slice(0, 220)}`;
      await this.registry.send(provider, {
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
      });
      return true;
    }

    const status_text = resolved.status === "denied"
      ? "❌ 승인 거부됨"
      : resolved.status === "deferred"
        ? "⏸️ 승인 보류됨"
        : resolved.status === "cancelled"
          ? "⛔ 승인 취소됨"
          : "ℹ️ 승인 판단 보류";
    await this.registry.send(provider, {
      id: `${provider}-${Date.now()}`,
      provider,
      channel: provider,
      sender_id: "approval-bot",
      chat_id: message.chat_id,
      content: `${status_text} · request_id=${selected.request_id} · tool=${selected.tool_name}`,
      at: new Date().toISOString(),
      reply_to: this.resolve_reply_to(provider, message),
      thread_id: message.thread_id,
      metadata: {
        kind: "approval_result",
        request_id: selected.request_id,
        tool_name: selected.tool_name,
        decision: resolved.decision,
      },
    });
    return true;
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
