/**
 * CircuitBreaker — state 전환, can_acquire, try_acquire, record_success/failure, reset 테스트.
 */
import { describe, it, expect } from "vitest";
import { CircuitBreaker } from "../../src/providers/circuit-breaker.js";

describe("CircuitBreaker", () => {
  it("초기 상태: closed", () => {
    const cb = new CircuitBreaker();
    expect(cb.state).toBe("closed");
  });

  it("closed 상태에서 can_acquire: true", () => {
    const cb = new CircuitBreaker();
    expect(cb.can_acquire()).toBe(true);
  });

  it("failure_threshold 도달 → open", () => {
    const cb = new CircuitBreaker({ failure_threshold: 3 });
    cb.record_failure();
    cb.record_failure();
    expect(cb.state).toBe("closed");
    cb.record_failure();
    expect(cb.state).toBe("open");
  });

  it("open 상태에서 can_acquire: false", () => {
    const cb = new CircuitBreaker({ failure_threshold: 1 });
    cb.record_failure();
    expect(cb.state).toBe("open");
    expect(cb.can_acquire()).toBe(false);
  });

  it("open → half_open: reset_timeout_ms 경과 후 전환", async () => {
    const cb = new CircuitBreaker({ failure_threshold: 1, reset_timeout_ms: 10 });
    cb.record_failure();
    expect(cb.state).toBe("open");
    await new Promise(r => setTimeout(r, 20));
    expect(cb.can_acquire()).toBe(true); // triggers transition to half_open
    expect(cb.state).toBe("half_open");
  });

  it("half_open에서 성공 → closed", async () => {
    const cb = new CircuitBreaker({ failure_threshold: 1, reset_timeout_ms: 10 });
    cb.record_failure();
    await new Promise(r => setTimeout(r, 20));
    cb.try_acquire(); // enter half_open
    cb.record_success();
    expect(cb.state).toBe("closed");
  });

  it("half_open에서 실패 → open", async () => {
    const cb = new CircuitBreaker({ failure_threshold: 1, reset_timeout_ms: 10, half_open_max: 1 });
    cb.record_failure();
    await new Promise(r => setTimeout(r, 20));
    cb.try_acquire(); // enter half_open and use slot
    cb.record_failure(); // back to open
    expect(cb.state).toBe("open");
  });

  it("try_acquire: half_open_max 슬롯 초과 → false", async () => {
    const cb = new CircuitBreaker({ failure_threshold: 1, reset_timeout_ms: 10, half_open_max: 1 });
    cb.record_failure();
    await new Promise(r => setTimeout(r, 20));
    expect(cb.try_acquire()).toBe(true);  // slot consumed
    expect(cb.try_acquire()).toBe(false); // no more slots
  });

  it("record_success: failure_count 리셋", () => {
    const cb = new CircuitBreaker({ failure_threshold: 5 });
    cb.record_failure();
    cb.record_failure();
    cb.record_success();
    // 리셋 후 다시 시작
    cb.record_failure();
    cb.record_failure();
    expect(cb.state).toBe("closed"); // only 2 failures, threshold=5
  });

  it("reset: 상태 완전 초기화", () => {
    const cb = new CircuitBreaker({ failure_threshold: 1 });
    cb.record_failure();
    expect(cb.state).toBe("open");
    cb.reset();
    expect(cb.state).toBe("closed");
    expect(cb.can_acquire()).toBe(true);
  });
});
