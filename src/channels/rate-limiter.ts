/** Token Bucket 기반 아웃바운드 레이트 리미터. 채널 API rate limit 보호용. */

export type RateLimiterOptions = {
  capacity?: number;
  refill_rate?: number;
  refill_interval_ms?: number;
};

export class TokenBucketRateLimiter {
  private tokens: number;
  private readonly capacity: number;
  private readonly refill_rate: number;
  private readonly refill_interval_ms: number;
  private last_refill_at: number;

  constructor(opts?: RateLimiterOptions) {
    this.capacity = opts?.capacity ?? 30;
    this.refill_rate = opts?.refill_rate ?? 1;
    this.refill_interval_ms = opts?.refill_interval_ms ?? 1000;
    this.tokens = this.capacity;
    this.last_refill_at = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.last_refill_at;
    if (elapsed < this.refill_interval_ms) return;
    const intervals = Math.floor(elapsed / this.refill_interval_ms);
    this.tokens = Math.min(this.capacity, this.tokens + intervals * this.refill_rate);
    this.last_refill_at = now - (elapsed % this.refill_interval_ms);
  }

  try_consume(tokens = 1): boolean {
    this.refill();
    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return true;
    }
    return false;
  }

  wait_time_ms(): number {
    this.refill();
    if (this.tokens >= 1) return 0;
    const deficit = 1 - this.tokens;
    return Math.ceil((deficit / this.refill_rate) * this.refill_interval_ms);
  }

  get available(): number {
    this.refill();
    return this.tokens;
  }
}
