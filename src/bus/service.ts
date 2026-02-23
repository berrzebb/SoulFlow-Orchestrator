import type { BusDirection, BusDrainResult, BusSizes, ConsumeOptions, InboundMessage, OutboundMessage } from "./types.js";

type Waiter<T> = (message: T | null) => void;

export class MessageBus {
  private readonly inbound_queue: InboundMessage[] = [];
  private readonly outbound_queue: OutboundMessage[] = [];
  private readonly inbound_waiters: Waiter<InboundMessage>[] = [];
  private readonly outbound_waiters: Waiter<OutboundMessage>[] = [];
  private _closed = false;

  async publish_inbound(message: InboundMessage): Promise<void> {
    if (this._closed) return;
    this.publish(message, this.inbound_queue, this.inbound_waiters);
  }

  async publish_outbound(message: OutboundMessage): Promise<void> {
    if (this._closed) return;
    this.publish(message, this.outbound_queue, this.outbound_waiters);
  }

  async consume_inbound(options?: ConsumeOptions): Promise<InboundMessage | null> {
    return this.consume(this.inbound_queue, this.inbound_waiters, options);
  }

  async consume_outbound(options?: ConsumeOptions): Promise<OutboundMessage | null> {
    return this.consume(this.outbound_queue, this.outbound_waiters, options);
  }

  peek(limit = 20): Array<InboundMessage | OutboundMessage> {
    const n = Math.max(1, limit);
    return [...this.inbound_queue.slice(0, n), ...this.outbound_queue.slice(0, n)];
  }

  get_size(direction?: BusDirection): number {
    if (direction === "inbound") return this.inbound_queue.length;
    if (direction === "outbound") return this.outbound_queue.length;
    return this.inbound_queue.length + this.outbound_queue.length;
  }

  get_sizes(): BusSizes {
    const inbound = this.inbound_queue.length;
    const outbound = this.outbound_queue.length;
    return { inbound, outbound, total: inbound + outbound };
  }

  async drain(limit = 5000): Promise<BusDrainResult> {
    const max = Math.max(1, Number(limit || 5000));
    let drained_inbound = 0;
    let drained_outbound = 0;
    while (this.inbound_queue.length > 0 && drained_inbound < max) {
      this.inbound_queue.shift();
      drained_inbound += 1;
    }
    while (this.outbound_queue.length > 0 && drained_outbound < max) {
      this.outbound_queue.shift();
      drained_outbound += 1;
    }
    return { drained_inbound, drained_outbound };
  }

  async close(): Promise<void> {
    this._closed = true;
    const all_inbound = [...this.inbound_waiters];
    const all_outbound = [...this.outbound_waiters];
    this.inbound_waiters.length = 0;
    this.outbound_waiters.length = 0;
    for (const waiter of all_inbound) waiter(null);
    for (const waiter of all_outbound) waiter(null);
    await this.drain();
  }

  is_closed(): boolean {
    return this._closed;
  }

  private publish<T>(message: T, queue: T[], waiters: Waiter<T>[]): void {
    const waiter = waiters.shift();
    if (waiter) {
      waiter(message);
      return;
    }
    queue.push(message);
  }

  private async consume<T>(queue: T[], waiters: Waiter<T>[], options?: ConsumeOptions): Promise<T | null> {
    const immediate = queue.shift() ?? null;
    if (immediate) return immediate;

    return new Promise<T | null>((resolve) => {
      let done = false;
      let timer: NodeJS.Timeout | null = null;
      const on_done = (message: T | null) => {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        resolve(message);
      };
      if (options?.timeout_ms && options.timeout_ms > 0) {
        timer = setTimeout(() => on_done(null), options.timeout_ms);
      }
      waiters.push(on_done);
    });
  }
}
