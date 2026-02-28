import type { MessageBus } from "../bus/service.js";
import type { OutboundMessage } from "../bus/types.js";
import type { Logger } from "../logger.js";
import type { ServiceLike } from "../runtime/service.types.js";
import type { AppConfig } from "../config/schema.js";
import { resolve_provider, type ChannelProvider, type ChannelRegistryLike } from "./types.js";
import type { DispatchDlqStoreLike } from "./dlq-store.js";
import type { OutboundDedupePolicy } from "./outbound-dedupe.js";
import { TokenBucketRateLimiter, type RateLimiterOptions } from "./rate-limiter.js";
import { prune_ttl_map, sleep } from "../utils/common.js";

type RecentRecord = { at_ms: number; message_id: string };

type RetryConfig = AppConfig["channel"]["dispatch"];
type DedupeConfig = AppConfig["channel"]["outboundDedupe"];

export type DispatchServiceDeps = {
  bus: MessageBus;
  registry: ChannelRegistryLike;
  retry_config: RetryConfig;
  dedupe_config: DedupeConfig;
  dlq_store: DispatchDlqStoreLike | null;
  dedupe_policy: OutboundDedupePolicy;
  logger: Logger;
  rate_limiter?: RateLimiterOptions;
};

const NON_RETRYABLE_ERRORS = [
  "invalid_auth", "not_authed", "channel_not_found",
  "chat_id_required", "bot_token_missing", "permission_denied", "invalid_arguments",
] as const;

export class DispatchService implements ServiceLike {
  readonly name = "dispatch";

  private readonly bus: MessageBus;
  private readonly registry: ChannelRegistryLike;
  private readonly retry_config: RetryConfig;
  private readonly dedupe_config: DedupeConfig;
  private readonly dlq: DispatchDlqStoreLike | null;
  private readonly dedupe_policy: OutboundDedupePolicy;
  private readonly logger: Logger;
  private readonly rate_limiter: TokenBucketRateLimiter;
  private readonly recent = new Map<string, RecentRecord>();
  private readonly pending_retries = new Set<ReturnType<typeof setTimeout>>();
  private running = false;
  private loop_task: Promise<void> | null = null;

  constructor(deps: DispatchServiceDeps) {
    this.bus = deps.bus;
    this.registry = deps.registry;
    this.retry_config = deps.retry_config;
    this.dedupe_config = deps.dedupe_config;
    this.dlq = deps.dlq_store;
    this.dedupe_policy = deps.dedupe_policy;
    this.logger = deps.logger;
    this.rate_limiter = new TokenBucketRateLimiter(deps.rate_limiter);
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.loop_task = this.consume_loop();
  }

  async stop(): Promise<void> {
    this.running = false;
    for (const timer of this.pending_retries) clearTimeout(timer);
    this.pending_retries.clear();
    await this.loop_task;
    // loop_task 완료 중 schedule_retry()가 새 타이머를 생성했을 수 있으므로 재정리
    for (const timer of this.pending_retries) clearTimeout(timer);
    this.pending_retries.clear();
    this.loop_task = null;
  }

  health_check(): { ok: boolean; details?: Record<string, unknown> } {
    return { ok: this.running, details: { recent_cache_size: this.recent.size } };
  }

  async send(provider: ChannelProvider, message: OutboundMessage): Promise<{ ok: boolean; message_id?: string; error?: string }> {
    return this.send_with_retry(provider, message, true);
  }

  private async consume_loop(): Promise<void> {
    while (this.running) {
      const msg = await this.bus.consume_outbound({ timeout_ms: 2000 });
      if (!msg) continue;
      const provider = resolve_provider(msg);
      if (!provider) continue;
      const result = await this.send_with_retry(provider, msg, true);
      if (!result.ok) {
        this.logger.debug("dispatch failed", { provider, error: result.error });
      }
    }
  }

  private async send_with_retry(
    provider: ChannelProvider,
    message: OutboundMessage,
    allow_requeue: boolean,
  ): Promise<{ ok: boolean; message_id?: string; error?: string }> {
    if (!this.rate_limiter.try_consume()) {
      const wait = this.rate_limiter.wait_time_ms();
      this.logger.debug("rate limited, waiting", { provider, wait_ms: wait });
      await sleep(wait);
      if (!this.rate_limiter.try_consume()) {
        this.logger.debug("rate limit still exceeded after wait", { provider });
      }
    }

    this.prune_recent_cache();

    const dedupe_key = this.dedupe_policy.key(provider, message);
    const cached = this.recent.get(dedupe_key);
    if (cached && (Date.now() - cached.at_ms) <= this.dedupe_config.ttlMs) {
      return { ok: true, message_id: cached.message_id };
    }

    const attempts = Math.max(1, this.retry_config.inlineRetries + 1);
    let last_error = "";

    for (let attempt = 1; attempt <= attempts; attempt++) {
      const sent = await this.registry.send(message);
      if (sent.ok) {
        this.recent.set(dedupe_key, { at_ms: Date.now(), message_id: String(sent.message_id || message.id || "") });
        if (this.recent.size > this.dedupe_config.maxSize + 500) this.prune_recent_cache(true);
        return sent;
      }
      last_error = String(sent.error || "unknown_error");
      if (!is_retryable(last_error)) break;
      if (attempt < attempts) await sleep(this.compute_delay(attempt));
    }

    const dispatch_retry = get_retry_count(message);
    if (allow_requeue && dispatch_retry < this.retry_config.retryMax && is_retryable(last_error)) {
      this.schedule_retry(provider, message, dispatch_retry + 1, last_error);
      return { ok: false, error: `requeued_retry_${dispatch_retry + 1}:${last_error}` };
    }

    if (allow_requeue && dispatch_retry >= this.retry_config.retryMax) {
      await this.write_dlq(provider, message, last_error, dispatch_retry);
    }
    return { ok: false, error: last_error || "send_failed" };
  }

  private schedule_retry(provider: ChannelProvider, message: OutboundMessage, retry_count: number, error: string): void {
    const delay = this.compute_delay(retry_count);
    const retry_msg = clone_outbound(message);
    retry_msg.metadata = {
      ...(retry_msg.metadata || {}),
      dispatch_retry: retry_count,
      dispatch_error: error,
      dispatch_retry_at: new Date(Date.now() + delay).toISOString(),
    };
    const timer = setTimeout(() => {
      this.pending_retries.delete(timer);
      if (this.running) this.bus.publish_outbound(retry_msg).catch((e) => {
        this.logger.debug("retry publish failed", { error: e instanceof Error ? e.message : String(e) });
      });
    }, delay);
    this.pending_retries.add(timer);
    this.logger.debug("dispatch requeue", { provider, retry: retry_count, delay_ms: delay });
  }

  private async write_dlq(provider: ChannelProvider, message: OutboundMessage, error: string, retry_count: number): Promise<void> {
    if (!this.dlq) return;
    try {
      await this.dlq.append({
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
        metadata: (message.metadata as Record<string, unknown>) || {},
      });
    } catch (e) {
      this.logger.error("dlq append failed", { error: String(e) });
    }
  }

  private compute_delay(attempt: number): number {
    const base = this.retry_config.retryBaseMs * Math.pow(2, attempt - 1);
    const capped = Math.min(base, this.retry_config.retryMaxMs);
    const jitter = this.retry_config.retryJitterMs > 0 ? Math.floor(Math.random() * this.retry_config.retryJitterMs) : 0;
    return capped + jitter;
  }

  private prune_recent_cache(force_trim = false): void {
    prune_ttl_map(this.recent, (r) => r.at_ms, this.dedupe_config.ttlMs, force_trim ? this.dedupe_config.maxSize : Infinity);
  }
}


function is_retryable(error: string): boolean {
  const lower = error.toLowerCase();
  return !NON_RETRYABLE_ERRORS.some((e) => lower.includes(e));
}

function get_retry_count(msg: OutboundMessage): number {
  const meta = (msg.metadata || {}) as Record<string, unknown>;
  return Math.max(0, Number(meta.dispatch_retry || 0));
}

function clone_outbound(msg: OutboundMessage): OutboundMessage {
  return { ...msg, media: [...(msg.media || [])], metadata: { ...(msg.metadata || {}) } };
}

