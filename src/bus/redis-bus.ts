import { Redis } from "ioredis";
import { hostname } from "node:os";
import { create_logger } from "../logger.js";
import type {
  BusMetrics,
  ConsumeMessageOptions,
  InboundMessage,
  MessageBusObserver,
  MessageBusRuntime,
  MessageLease,
  OutboundMessage,
  ProgressEvent,
  ReliableMessageBus,
} from "./types.js";

const log = create_logger("redis-bus");

const DEFAULT_BLOCK_MS = 5_000;
const DEFAULT_CLAIM_IDLE_MS = 30_000;
const DEFAULT_MAXLEN = 10_000;

export type RedisMessageBusOptions = {
  url: string;
  key_prefix?: string;
  block_ms?: number;
  claim_idle_ms?: number;
  stream_maxlen?: {
    inbound?: number;
    outbound?: number;
    progress?: number;
  };
};

type StreamName = "inbound" | "outbound" | "progress";

const CONSUMER_GROUPS: Record<StreamName, string> = {
  inbound: "channel-manager",
  outbound: "dispatch",
  progress: "progress-relay",
};

function make_consumer_name(): string {
  return `${hostname()}:${process.pid}`;
}

export class RedisMessageBus implements MessageBusRuntime, ReliableMessageBus {
  readonly kind = "redis" as const;

  private readonly client: Redis;
  private readonly prefix: string;
  private readonly block_ms: number;
  private readonly claim_idle_ms: number;
  private readonly maxlen: Record<StreamName, number>;
  private readonly consumer_name: string;
  private readonly observers: MessageBusObserver[] = [];
  private _closed = false;
  private bootstrap_done = false;
  private bootstrap_lock: Promise<void> | null = null;
  private cached_metrics: BusMetrics;
  private metrics_timer: ReturnType<typeof setInterval> | null = null;

  constructor(options: RedisMessageBusOptions) {
    this.client = new Redis(options.url, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => Math.min(times * 200, 3000),
      lazyConnect: true,
    });
    this.prefix = options.key_prefix || "sf:bus:";
    this.block_ms = options.block_ms ?? DEFAULT_BLOCK_MS;
    this.claim_idle_ms = options.claim_idle_ms ?? DEFAULT_CLAIM_IDLE_MS;
    this.maxlen = {
      inbound: options.stream_maxlen?.inbound ?? DEFAULT_MAXLEN,
      outbound: options.stream_maxlen?.outbound ?? DEFAULT_MAXLEN,
      progress: options.stream_maxlen?.progress ?? 2_000,
    };
    this.consumer_name = make_consumer_name();
    this.cached_metrics = {
      inbound: { depth: 0, overflow: 0 },
      outbound: { depth: 0, overflow: 0 },
      progress: { depth: 0, overflow: 0 },
      capacity: this.maxlen.inbound,
    };
  }

  /* ── bootstrap: stream + consumer group 생성 ── */

  private async bootstrap(): Promise<void> {
    if (this.bootstrap_done) return;
    if (this.bootstrap_lock) return this.bootstrap_lock;
    this.bootstrap_lock = this._do_bootstrap();
    try {
      await this.bootstrap_lock;
    } finally {
      this.bootstrap_lock = null;
    }
  }

  private async _do_bootstrap(): Promise<void> {
    if (this.bootstrap_done) return;
    await this.client.connect();
    for (const stream of ["inbound", "outbound", "progress"] as StreamName[]) {
      const key = this.stream_key(stream);
      const group = CONSUMER_GROUPS[stream];
      try {
        await this.client.xgroup("CREATE", key, group, "0", "MKSTREAM");
        log.info(`consumer group created: ${key} / ${group}`);
      } catch (err) {
        if (String(err).includes("BUSYGROUP")) {
          // 이미 존재 — 정상
        } else {
          throw err;
        }
      }
    }
    this.bootstrap_done = true;
    this.start_metrics_refresh();
    log.info("redis bus bootstrap done", { prefix: this.prefix, consumer: this.consumer_name });
  }

  private stream_key(name: StreamName): string {
    return `${this.prefix}${name}`;
  }

  /* ── MessageBusTap ── */

  on_publish(observer: MessageBusObserver): void {
    this.observers.push(observer);
  }

  private notify_observers(direction: "inbound" | "outbound", message: InboundMessage | OutboundMessage): void {
    for (const fn of this.observers) try { fn(direction, message); } catch { /* noop */ }
  }

  /* ── publish ── */

  private async xadd(stream: StreamName, payload: unknown): Promise<string> {
    await this.bootstrap();
    const key = this.stream_key(stream);
    const data = JSON.stringify(payload);
    const id = await this.client.xadd(
      key, "MAXLEN", "~", String(this.maxlen[stream]),
      "*",
      "payload", data,
      "kind", stream,
      "version", "1",
      "published_at", new Date().toISOString(),
    );
    return id ?? "";
  }

  async publish_inbound(message: InboundMessage): Promise<void> {
    if (this._closed) return;
    await this.xadd("inbound", message);
    this.notify_observers("inbound", message);
  }

  async publish_outbound(message: OutboundMessage): Promise<void> {
    if (this._closed) return;
    await this.xadd("outbound", message);
    this.notify_observers("outbound", message);
  }

  async publish_progress(event: ProgressEvent): Promise<void> {
    if (this._closed) return;
    await this.xadd("progress", event).catch((err) => {
      log.warn("progress publish failed (best-effort)", { error: String(err) });
    });
  }

  /* ── consume (기본 — auto-ack) ── */

  async consume_inbound(options?: ConsumeMessageOptions): Promise<InboundMessage | null> {
    const lease = await this.consume_inbound_lease(options);
    if (!lease) return null;
    await lease.ack();
    return lease.value;
  }

  async consume_outbound(options?: ConsumeMessageOptions): Promise<OutboundMessage | null> {
    const lease = await this.consume_outbound_lease(options);
    if (!lease) return null;
    await lease.ack();
    return lease.value;
  }

  async consume_progress(options?: ConsumeMessageOptions): Promise<ProgressEvent | null> {
    const lease = await this.consume_progress_lease(options);
    if (!lease) return null;
    await lease.ack();
    return lease.value;
  }

  /* ── consume_lease (lease/ack 모델) ── */

  async consume_inbound_lease(options?: ConsumeMessageOptions): Promise<MessageLease<InboundMessage> | null> {
    return this.xread_lease<InboundMessage>("inbound", options);
  }

  async consume_outbound_lease(options?: ConsumeMessageOptions): Promise<MessageLease<OutboundMessage> | null> {
    return this.xread_lease<OutboundMessage>("outbound", options);
  }

  async consume_progress_lease(options?: ConsumeMessageOptions): Promise<MessageLease<ProgressEvent> | null> {
    return this.xread_lease<ProgressEvent>("progress", options);
  }

  private async xread_lease<T>(stream: StreamName, options?: ConsumeMessageOptions): Promise<MessageLease<T> | null> {
    if (this._closed) return null;
    await this.bootstrap();

    const key = this.stream_key(stream);
    const group = CONSUMER_GROUPS[stream];
    const block_ms = options?.timeout_ms ?? this.block_ms;

    // 1. 먼저 pending 중 idle 상태인 메시지 claim 시도
    const claimed = await this.try_claim_idle<T>(key, group, stream);
    if (claimed) return claimed;

    // 2. 새 메시지 읽기
    const result = await this.client.xreadgroup(
      "GROUP", group, this.consumer_name,
      "COUNT", "1", "BLOCK", String(block_ms),
      "STREAMS", key, ">",
    ) as Array<[string, Array<[string, string[]]>]> | null;

    if (!result || result.length === 0) return null;
    const entries = result[0]?.[1];
    if (!entries || entries.length === 0) return null;

    const [entry_id, fields] = entries[0];
    const payload = this.parse_fields<T>(fields);
    if (!payload) {
      await this.client.xack(key, group, entry_id);
      return null;
    }

    return this.build_lease<T>(payload, key, group, entry_id);
  }

  private async try_claim_idle<T>(key: string, group: string, _stream: StreamName): Promise<MessageLease<T> | null> {
    try {
      const result = await this.client.xautoclaim(
        key, group, this.consumer_name,
        String(this.claim_idle_ms),
        "0-0", "COUNT", "1",
      ) as [string, Array<[string, string[]]>, string[]];

      const entries = result?.[1];
      if (!entries || entries.length === 0) return null;

      const [entry_id, fields] = entries[0];
      const payload = this.parse_fields<T>(fields);
      if (!payload) {
        await this.client.xack(key, group, entry_id);
        return null;
      }

      log.info("claimed idle message", { key, entry_id });
      return this.build_lease<T>(payload, key, group, entry_id);
    } catch {
      return null;
    }
  }

  private parse_fields<T>(fields: string[]): T | null {
    for (let i = 0; i < fields.length - 1; i += 2) {
      if (fields[i] === "payload") {
        try {
          return JSON.parse(fields[i + 1]) as T;
        } catch {
          return null;
        }
      }
    }
    return null;
  }

  private build_lease<T>(value: T, key: string, group: string, entry_id: string): MessageLease<T> {
    let settled = false;
    return {
      value,
      ack: async () => {
        if (settled) return;
        settled = true;
        await this.client.xack(key, group, entry_id);
      },
      retry: async (_delay_ms?: number) => {
        // release without ack — 다른 consumer가 claim 가능
        settled = true;
      },
      release: async () => {
        if (settled) return;
        settled = true;
        await this.client.xack(key, group, entry_id);
      },
    };
  }

  /* ── 크기/메트릭 ── */

  get_size(direction?: "inbound" | "outbound"): number {
    if (!direction) return this.cached_metrics.inbound.depth + this.cached_metrics.outbound.depth;
    return this.cached_metrics[direction].depth;
  }

  get_sizes(): { inbound: number; outbound: number; total: number } {
    const i = this.cached_metrics.inbound.depth;
    const o = this.cached_metrics.outbound.depth;
    return { inbound: i, outbound: o, total: i + o };
  }

  get_metrics(): BusMetrics {
    return this.cached_metrics;
  }

  private start_metrics_refresh(): void {
    if (this.metrics_timer) return;
    const refresh = () => {
      if (this._closed) return;
      this.get_metrics_async()
        .then((m) => { this.cached_metrics = m; })
        .catch(() => { /* 갱신 실패 — 이전 캐시 유지 */ });
    };
    refresh();
    this.metrics_timer = setInterval(refresh, 10_000);
    if (this.metrics_timer.unref) this.metrics_timer.unref();
  }

  /** 비동기 메트릭 조회. */
  async get_metrics_async(): Promise<BusMetrics> {
    await this.bootstrap();
    const [inLen, outLen, progLen] = await Promise.all([
      this.client.xlen(this.stream_key("inbound")),
      this.client.xlen(this.stream_key("outbound")),
      this.client.xlen(this.stream_key("progress")),
    ]);

    let pending_count = 0;
    try {
      const info = await this.client.xpending(
        this.stream_key("inbound"),
        CONSUMER_GROUPS.inbound,
      ) as [number, string | null, string | null, Array<[string, string]> | null];
      pending_count = info[0] || 0;
    } catch { /* noop */ }

    return {
      inbound: { depth: inLen, overflow: 0 },
      outbound: { depth: outLen, overflow: 0 },
      progress: { depth: progLen, overflow: 0 },
      capacity: this.maxlen.inbound,
      pending_count,
    };
  }

  /* ── lifecycle ── */

  async close(): Promise<void> {
    this._closed = true;
    if (this.metrics_timer) {
      clearInterval(this.metrics_timer);
      this.metrics_timer = null;
    }
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
    log.info("redis bus closed");
  }

  is_closed(): boolean {
    return this._closed;
  }
}
