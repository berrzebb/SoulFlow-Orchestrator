import type { ConsumeMessageOptions, InboundMessage, OutboundMessage, ProgressEvent } from "./types.js";

type Waiter<T> = (message: T | null) => void;

const DEFAULT_CONSUME_TIMEOUT_MS = 30_000;
const MAX_CONSUME_TIMEOUT_MS = 300_000;

export class MessageBus {
  private readonly inbound_queue: InboundMessage[] = [];
  private readonly outbound_queue: OutboundMessage[] = [];
  private readonly progress_queue: ProgressEvent[] = [];
  private readonly inbound_waiters: Array<Waiter<InboundMessage>> = [];
  private readonly outbound_waiters: Array<Waiter<OutboundMessage>> = [];
  private readonly progress_waiters: Array<Waiter<ProgressEvent>> = [];
  private _closed = false;

  async publish_inbound(message: InboundMessage): Promise<void> {
    if (this._closed) return;
    this.publish(message, this.inbound_queue, this.inbound_waiters);
  }

  async publish_outbound(message: OutboundMessage): Promise<void> {
    if (this._closed) return;
    this.publish(message, this.outbound_queue, this.outbound_waiters);
  }

  async consume_inbound(options?: ConsumeMessageOptions): Promise<InboundMessage | null> {
    return this.consume(this.inbound_queue, this.inbound_waiters, options);
  }

  async consume_outbound(options?: ConsumeMessageOptions): Promise<OutboundMessage | null> {
    return this.consume(this.outbound_queue, this.outbound_waiters, options);
  }

  async publish_progress(event: ProgressEvent): Promise<void> {
    if (this._closed) return;
    this.publish(event, this.progress_queue, this.progress_waiters);
  }

  async consume_progress(options?: ConsumeMessageOptions): Promise<ProgressEvent | null> {
    return this.consume(this.progress_queue, this.progress_waiters, options);
  }

  peek(limit = 20): Array<InboundMessage | OutboundMessage> {
    const n = Math.max(1, Number(limit || 20));
    return [...this.inbound_queue.slice(0, n), ...this.outbound_queue.slice(0, n)];
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

  async drain(limit = 5000): Promise<{ drained_inbound: number; drained_outbound: number; drained_progress: number }> {
    const max = Math.max(1, Number(limit || 5000));
    let drained_inbound = 0;
    let drained_outbound = 0;
    let drained_progress = 0;
    while (this.inbound_queue.length > 0 && drained_inbound < max) {
      this.inbound_queue.shift();
      drained_inbound += 1;
    }
    while (this.outbound_queue.length > 0 && drained_outbound < max) {
      this.outbound_queue.shift();
      drained_outbound += 1;
    }
    while (this.progress_queue.length > 0 && drained_progress < max) {
      this.progress_queue.shift();
      drained_progress += 1;
    }
    return { drained_inbound, drained_outbound, drained_progress };
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
    await this.drain();
  }

  is_closed(): boolean {
    return this._closed;
  }

  private publish<T>(message: T, queue: T[], waiters: Array<Waiter<T>>): void {
    const waiter = waiters.shift();
    if (waiter) {
      waiter(message);
      return;
    }
    queue.push(message);
  }

  private async consume<T>(
    queue: T[],
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
