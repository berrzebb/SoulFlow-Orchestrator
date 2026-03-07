import type {
  BusMetrics,
  ConsumeMessageOptions,
  InboundMessage,
  MessageBusObserver,
  MessageBusRuntime,
  OutboundMessage,
  ProgressEvent,
} from "./types.js";

type Waiter<T> = (message: T | null) => void;

const DEFAULT_CONSUME_TIMEOUT_MS = 30_000;
const MAX_CONSUME_TIMEOUT_MS = 300_000;

/** 큐 포화 시 정책. */
export type OverflowPolicy = "drop-oldest" | "reject-newest";

export type MessageBusOptions = {
  /** 큐별 최대 크기 (기본 10_000). */
  max_queue_size?: number;
  /** 포화 시 정책 (기본 drop-oldest). */
  overflow_policy?: OverflowPolicy;
};

const DEFAULT_MAX_QUEUE_SIZE = 10_000;

/* ── head-index 기반 bounded queue ─────────────────── */

const COMPACT_THRESHOLD = 512;

/** O(1) enqueue/dequeue + 상한 제한. */
export class BoundedQueue<T> {
  private items: T[] = [];
  private head = 0;
  readonly capacity: number;
  private readonly policy: OverflowPolicy;
  private _overflow_count = 0;

  constructor(capacity: number, policy: OverflowPolicy = "drop-oldest") {
    this.capacity = Math.max(1, capacity);
    this.policy = policy;
  }

  push(item: T): T | null {
    if (this.length >= this.capacity) {
      this._overflow_count++;
      if (this.policy === "reject-newest") return item;
      const dropped = this.items[this.head] as T;
      this.items[this.head] = undefined as unknown as T;
      this.head++;
      this.items.push(item);
      this.compact();
      return dropped;
    }
    this.items.push(item);
    return null;
  }

  shift(): T | undefined {
    if (this.head >= this.items.length) return undefined;
    const item = this.items[this.head];
    this.items[this.head] = undefined as unknown as T;
    this.head++;
    this.compact();
    return item;
  }

  get length(): number {
    return this.items.length - this.head;
  }

  clear(): number {
    const count = this.length;
    this.items.length = 0;
    this.head = 0;
    return count;
  }

  get overflow_count(): number {
    return this._overflow_count;
  }

  private compact(): void {
    if (this.head >= COMPACT_THRESHOLD && this.head >= this.items.length / 2) {
      this.items = this.items.slice(this.head);
      this.head = 0;
    }
  }
}

/* ── InMemoryMessageBus (구 MessageBus) ───────────── */

export class InMemoryMessageBus implements MessageBusRuntime {
  readonly kind = "memory" as const;

  private readonly inbound_queue: BoundedQueue<InboundMessage>;
  private readonly outbound_queue: BoundedQueue<OutboundMessage>;
  private readonly progress_queue: BoundedQueue<ProgressEvent>;
  private readonly inbound_waiters: Array<Waiter<InboundMessage>> = [];
  private readonly outbound_waiters: Array<Waiter<OutboundMessage>> = [];
  private readonly progress_waiters: Array<Waiter<ProgressEvent>> = [];
  private readonly observers: MessageBusObserver[] = [];
  private _closed = false;

  constructor(options?: MessageBusOptions) {
    const cap = Math.max(1, options?.max_queue_size ?? DEFAULT_MAX_QUEUE_SIZE);
    const policy = options?.overflow_policy ?? "drop-oldest";
    this.inbound_queue = new BoundedQueue(cap, policy);
    this.outbound_queue = new BoundedQueue(cap, policy);
    this.progress_queue = new BoundedQueue(cap, policy);
  }

  on_publish(observer: MessageBusObserver): void {
    this.observers.push(observer);
  }

  async publish_inbound(message: InboundMessage): Promise<void> {
    if (this._closed) return;
    this._publish(message, this.inbound_queue, this.inbound_waiters);
    for (const fn of this.observers) try { fn("inbound", message); } catch { /* noop */ }
  }

  async publish_outbound(message: OutboundMessage): Promise<void> {
    if (this._closed) return;
    this._publish(message, this.outbound_queue, this.outbound_waiters);
    for (const fn of this.observers) try { fn("outbound", message); } catch { /* noop */ }
  }

  async consume_inbound(options?: ConsumeMessageOptions): Promise<InboundMessage | null> {
    return this._consume(this.inbound_queue, this.inbound_waiters, options);
  }

  async consume_outbound(options?: ConsumeMessageOptions): Promise<OutboundMessage | null> {
    return this._consume(this.outbound_queue, this.outbound_waiters, options);
  }

  async publish_progress(event: ProgressEvent): Promise<void> {
    if (this._closed) return;
    this._publish(event, this.progress_queue, this.progress_waiters);
  }

  async consume_progress(options?: ConsumeMessageOptions): Promise<ProgressEvent | null> {
    return this._consume(this.progress_queue, this.progress_waiters, options);
  }

  get_size(direction?: "inbound" | "outbound"): number {
    if (direction === "inbound") return this.inbound_queue.length;
    if (direction === "outbound") return this.outbound_queue.length;
    return this.inbound_queue.length + this.outbound_queue.length;
  }

  get_sizes(): { inbound: number; outbound: number; total: number } {
    const inbound = this.inbound_queue.length;
    const outbound = this.outbound_queue.length;
    return { inbound, outbound, total: inbound + outbound };
  }

  get_metrics(): BusMetrics {
    return {
      inbound: { depth: this.inbound_queue.length, overflow: this.inbound_queue.overflow_count },
      outbound: { depth: this.outbound_queue.length, overflow: this.outbound_queue.overflow_count },
      progress: { depth: this.progress_queue.length, overflow: this.progress_queue.overflow_count },
      capacity: this.inbound_queue.capacity,
    };
  }

  async close(): Promise<void> {
    this._closed = true;
    const all_inbound = [...this.inbound_waiters];
    const all_outbound = [...this.outbound_waiters];
    const all_progress = [...this.progress_waiters];
    this.inbound_waiters.length = 0;
    this.outbound_waiters.length = 0;
    this.progress_waiters.length = 0;
    for (const waiter of all_inbound) waiter(null);
    for (const waiter of all_outbound) waiter(null);
    for (const waiter of all_progress) waiter(null);
    this.inbound_queue.clear();
    this.outbound_queue.clear();
    this.progress_queue.clear();
  }

  is_closed(): boolean {
    return this._closed;
  }

  private _publish<T>(message: T, queue: BoundedQueue<T>, waiters: Array<Waiter<T>>): void {
    const waiter = waiters.shift();
    if (waiter) {
      waiter(message);
      return;
    }
    queue.push(message);
  }

  private async _consume<T>(
    queue: BoundedQueue<T>,
    waiters: Array<Waiter<T>>,
    options?: ConsumeMessageOptions,
  ): Promise<T | null> {
    if (this._closed) return null;
    const immediate = queue.shift() ?? null;
    if (immediate) return immediate;
    if (this._closed) return null;
    return new Promise((resolve) => {
      let done = false;
      let timer: NodeJS.Timeout | null = null;
      const raw_timeout = Number(options?.timeout_ms || DEFAULT_CONSUME_TIMEOUT_MS);
      const timeout_ms = Math.max(1, Math.min(MAX_CONSUME_TIMEOUT_MS, Number.isFinite(raw_timeout) ? raw_timeout : DEFAULT_CONSUME_TIMEOUT_MS));
      const on_done = (message: T | null): void => {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        resolve(message);
      };
      timer = setTimeout(() => {
        const idx = waiters.indexOf(on_done);
        if (idx >= 0) waiters.splice(idx, 1);
        on_done(null);
      }, timeout_ms);
      waiters.push(on_done);
    });
  }
}

/** 하위 호환 alias — 점진 제거 대상. */
export { InMemoryMessageBus as MessageBus };
