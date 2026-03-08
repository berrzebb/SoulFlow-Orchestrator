/**
 * SystemMetricsCollector — start/stop/get_latest 단위 테스트.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SystemMetricsCollector } from "../../src/dashboard/system-metrics.js";

let collector: SystemMetricsCollector;

beforeEach(() => {
  collector = new SystemMetricsCollector(500); // 500ms 간격
});

afterEach(() => {
  collector.stop();
});

describe("SystemMetricsCollector — 초기 상태", () => {
  it("start() 전 get_latest() → null", () => {
    expect(collector.get_latest()).toBeNull();
  });
});

describe("SystemMetricsCollector — start/stop", () => {
  it("start() 이후 get_latest() → null이 아님 (첫 수집 즉시)", async () => {
    collector.start();
    // 첫 수집은 즉시 비동기로 실행 — 짧은 대기 후 확인
    await new Promise((r) => setTimeout(r, 100));
    const metrics = collector.get_latest();
    expect(metrics).not.toBeNull();
  });

  it("start() 이후 mem_total_mb > 0", async () => {
    collector.start();
    await new Promise((r) => setTimeout(r, 100));
    const metrics = collector.get_latest();
    expect(metrics!.mem_total_mb).toBeGreaterThan(0);
  });

  it("start() 이후 uptime_s >= 0", async () => {
    collector.start();
    await new Promise((r) => setTimeout(r, 100));
    expect(collector.get_latest()!.uptime_s).toBeGreaterThanOrEqual(0);
  });

  it("start() 이후 cpu_percent 0~100 범위", async () => {
    collector.start();
    await new Promise((r) => setTimeout(r, 100));
    const cpu = collector.get_latest()!.cpu_percent;
    expect(cpu).toBeGreaterThanOrEqual(0);
    expect(cpu).toBeLessThanOrEqual(100);
  });

  it("stop() 이후 get_latest()는 마지막 값 유지", async () => {
    collector.start();
    await new Promise((r) => setTimeout(r, 100));
    collector.stop();
    const after_stop = collector.get_latest();
    expect(after_stop).not.toBeNull(); // 마지막 수집 값 유지
  });

  it("start() 중복 호출 → 두 번 시작 안 됨", async () => {
    collector.start();
    collector.start(); // 두 번째 호출 무시
    await new Promise((r) => setTimeout(r, 100));
    // 에러 없이 정상 동작
    expect(collector.get_latest()).not.toBeNull();
  });
});

describe("SystemMetricsCollector — 메트릭 구조", () => {
  it("필수 필드 포함", async () => {
    collector.start();
    await new Promise((r) => setTimeout(r, 100));
    const m = collector.get_latest()!;
    expect(typeof m.cpu_percent).toBe("number");
    expect(typeof m.mem_total_mb).toBe("number");
    expect(typeof m.mem_used_mb).toBe("number");
    expect(typeof m.mem_percent).toBe("number");
    expect(typeof m.uptime_s).toBe("number");
  });

  it("mem_percent = 0~100 범위", async () => {
    collector.start();
    await new Promise((r) => setTimeout(r, 100));
    const pct = collector.get_latest()!.mem_percent;
    expect(pct).toBeGreaterThanOrEqual(0);
    expect(pct).toBeLessThanOrEqual(100);
  });

  it("Windows/non-Linux에서 swap/net → null 허용", async () => {
    collector.start();
    await new Promise((r) => setTimeout(r, 100));
    const m = collector.get_latest()!;
    // Linux가 아니면 null, Linux이면 숫자 또는 null
    expect(m.swap_total_mb === null || typeof m.swap_total_mb === "number").toBe(true);
    expect(m.net_rx_kbps === null || typeof m.net_rx_kbps === "number").toBe(true);
  });
});
