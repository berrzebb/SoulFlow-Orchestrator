import { describe, it, expect, beforeEach } from "vitest";
import { CircuitBreaker } from "@src/providers/circuit-breaker.ts";

describe("CircuitBreaker", () => {
  let cb: CircuitBreaker;

  beforeEach(() => {
    cb = new CircuitBreaker({ failure_threshold: 3, reset_timeout_ms: 100, half_open_max: 1 });
  });

  it("초기 상태 closed, 요청 허용", () => {
    expect(cb.state).toBe("closed");
    expect(cb.try_acquire()).toBe(true);
  });

  it("실패 threshold 미만 — closed 유지", () => {
    cb.record_failure();
    cb.record_failure();
    expect(cb.state).toBe("closed");
    expect(cb.try_acquire()).toBe(true);
  });

  it("실패 threshold 도달 — closed → open", () => {
    for (let i = 0; i < 3; i++) cb.record_failure();
    expect(cb.state).toBe("open");
    expect(cb.try_acquire()).toBe(false);
  });

  it("open 상태에서 timeout 후 → half_open (try_acquire 시 전환)", async () => {
    for (let i = 0; i < 3; i++) cb.record_failure();
    expect(cb.state).toBe("open");

    await new Promise((r) => setTimeout(r, 120));
    // try_acquire()가 open → half_open 전환을 트리거
    expect(cb.try_acquire()).toBe(true);
    expect(cb.state).toBe("half_open");
  });

  it("half_open에서 성공 → closed", async () => {
    for (let i = 0; i < 3; i++) cb.record_failure();
    await new Promise((r) => setTimeout(r, 120));

    cb.try_acquire(); // open → half_open 전환
    expect(cb.state).toBe("half_open");
    cb.record_success();
    expect(cb.state).toBe("closed");
    expect(cb.try_acquire()).toBe(true);
  });

  it("half_open에서 실패 → open 복귀", async () => {
    for (let i = 0; i < 3; i++) cb.record_failure();
    await new Promise((r) => setTimeout(r, 120));

    cb.try_acquire(); // open → half_open 전환
    expect(cb.state).toBe("half_open");
    cb.record_failure();
    expect(cb.state).toBe("open");
    expect(cb.try_acquire()).toBe(false);
  });

  it("half_open 시도 횟수 제한 (half_open_max)", async () => {
    for (let i = 0; i < 3; i++) cb.record_failure();
    await new Promise((r) => setTimeout(r, 120));

    // try_acquire()가 half_open 전환 + slot 소비를 원자적으로 수행
    expect(cb.try_acquire()).toBe(true);
    expect(cb.try_acquire()).toBe(false);
  });

  it("성공 기록 → failure_count 리셋", () => {
    cb.record_failure();
    cb.record_failure();
    cb.record_success();
    // 다시 threshold까지 실패해야 open
    cb.record_failure();
    cb.record_failure();
    expect(cb.state).toBe("closed");
    cb.record_failure();
    expect(cb.state).toBe("open");
  });

  it("reset() → 초기 상태 복원", () => {
    for (let i = 0; i < 3; i++) cb.record_failure();
    expect(cb.state).toBe("open");
    cb.reset();
    expect(cb.state).toBe("closed");
    expect(cb.try_acquire()).toBe(true);
  });

  it("can_acquire: closed에서 슬롯 미소비 반복 true", () => {
    expect(cb.can_acquire()).toBe(true);
    expect(cb.can_acquire()).toBe(true);
  });

  it("can_acquire: half_open에서 슬롯 미소비 확인", async () => {
    for (let i = 0; i < 3; i++) cb.record_failure();
    await new Promise((r) => setTimeout(r, 120));
    // can_acquire는 슬롯을 소비하지 않으므로 반복 호출해도 true
    expect(cb.can_acquire()).toBe(true);
    expect(cb.can_acquire()).toBe(true);
    // try_acquire는 슬롯을 소비하므로 1번만 true
    expect(cb.try_acquire()).toBe(true);
    expect(cb.try_acquire()).toBe(false);
  });

  it("can_acquire: open에서 false", () => {
    for (let i = 0; i < 3; i++) cb.record_failure();
    expect(cb.can_acquire()).toBe(false);
  });

  it("기본 옵션 (threshold=5, timeout=30000, half_open_max=1)", () => {
    const def = new CircuitBreaker();
    for (let i = 0; i < 4; i++) def.record_failure();
    expect(def.state).toBe("closed");
    def.record_failure();
    expect(def.state).toBe("open");
  });
});
