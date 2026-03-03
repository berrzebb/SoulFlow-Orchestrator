import { describe, it, expect } from "vitest";
import { TokenBucketRateLimiter } from "@src/channels/rate-limiter.ts";

describe("TokenBucketRateLimiter", () => {
  it("초기 상태에서 capacity만큼 소비 가능", () => {
    const rl = new TokenBucketRateLimiter({ capacity: 3, refill_rate: 1, refill_interval_ms: 1000 });
    expect(rl.try_consume()).toBe(true);
    expect(rl.try_consume()).toBe(true);
    expect(rl.try_consume()).toBe(true);
    expect(rl.try_consume()).toBe(false);
  });

  it("capacity 소진 후 available = 0", () => {
    const rl = new TokenBucketRateLimiter({ capacity: 2, refill_rate: 1, refill_interval_ms: 1000 });
    rl.try_consume();
    rl.try_consume();
    expect(rl.available).toBe(0);
  });

  it("시간 경과 후 리필 확인", async () => {
    const rl = new TokenBucketRateLimiter({ capacity: 2, refill_rate: 1, refill_interval_ms: 50 });
    rl.try_consume();
    rl.try_consume();
    expect(rl.try_consume()).toBe(false);

    await new Promise((r) => setTimeout(r, 60));
    expect(rl.try_consume()).toBe(true);
  });

  it("리필은 capacity를 초과하지 않음", async () => {
    const rl = new TokenBucketRateLimiter({ capacity: 2, refill_rate: 1, refill_interval_ms: 50 });
    await new Promise((r) => setTimeout(r, 200));
    expect(rl.available).toBeLessThanOrEqual(2);
  });

  it("wait_time_ms: 토큰 있으면 0", () => {
    const rl = new TokenBucketRateLimiter({ capacity: 5, refill_rate: 1, refill_interval_ms: 1000 });
    expect(rl.wait_time_ms()).toBe(0);
  });

  it("wait_time_ms: 토큰 없으면 양수", () => {
    const rl = new TokenBucketRateLimiter({ capacity: 1, refill_rate: 1, refill_interval_ms: 100 });
    rl.try_consume();
    const wait = rl.wait_time_ms();
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(100);
  });

  it("여러 토큰 한번에 소비", () => {
    const rl = new TokenBucketRateLimiter({ capacity: 5, refill_rate: 1, refill_interval_ms: 1000 });
    expect(rl.try_consume(3)).toBe(true);
    expect(rl.available).toBe(2);
    expect(rl.try_consume(3)).toBe(false);
  });

  it("기본 옵션 (capacity=30, refill_rate=1)", () => {
    const rl = new TokenBucketRateLimiter();
    expect(rl.available).toBe(30);
  });
});
