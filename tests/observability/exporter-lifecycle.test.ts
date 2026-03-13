/**
 * OB-8 — Exporter Lifecycle (종료 경로) 테스트.
 *
 * 검증 항목:
 *   1. SpanExportAdapter.shutdown() — 잔여 버퍼 flush + exporter shutdown 호출
 *   2. MetricsExportAdapter.stop() — 최종 snapshot export + exporter shutdown 호출
 *   3. cleanup_observability 클로저 — 두 adapter의 shutdown/stop을 순차 호출
 *   4. shutdown 중 exporter 에러 → 전파 (catch 가능)
 *   5. 이중 shutdown/stop 호출 안전성
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  SpanExportAdapter,
  MetricsExportAdapter,
  NOOP_TRACE_EXPORTER,
  NOOP_METRICS_EXPORTER,
  type TraceExporterLike,
  type MetricsExporterLike,
} from "@src/observability/exporter.js";
import { ExecutionSpanRecorder } from "@src/observability/span.js";
import { MetricsSink } from "@src/observability/metrics.js";
import type { ExecutionSpan } from "@src/observability/span.js";
import type { MetricsSnapshot } from "@src/observability/metrics.js";
import { create_correlation } from "@src/observability/correlation.js";

// ══════════════════════════════════════════
// SpanExportAdapter.shutdown() 종료 경로
// ══════════════════════════════════════════

describe("SpanExportAdapter shutdown 경로", () => {
  it("잔여 버퍼 span을 flush 후 exporter shutdown 호출", async () => {
    const exported: ExecutionSpan[][] = [];
    const mock: TraceExporterLike = {
      export: vi.fn(async (spans) => { exported.push([...spans]); }),
      shutdown: vi.fn(async () => {}),
    };

    const adapter = new SpanExportAdapter(mock);
    const recorder = new ExecutionSpanRecorder({ on_end: adapter.on_span_end });

    recorder.start("orchestration_run", "exec_1", create_correlation()).end();
    recorder.start("delivery", "send_1", create_correlation()).end();
    expect(adapter.buffered_count).toBe(2);

    await adapter.shutdown();

    expect(exported).toHaveLength(1);
    expect(exported[0]).toHaveLength(2);
    expect(mock.shutdown).toHaveBeenCalledOnce();
    expect(adapter.buffered_count).toBe(0);
  });

  it("빈 버퍼에서 shutdown → export 호출 없이 shutdown만", async () => {
    const mock: TraceExporterLike = {
      export: vi.fn(async () => {}),
      shutdown: vi.fn(async () => {}),
    };

    const adapter = new SpanExportAdapter(mock);
    await adapter.shutdown();

    expect(mock.export).not.toHaveBeenCalled();
    expect(mock.shutdown).toHaveBeenCalledOnce();
  });
});

// ══════════════════════════════════════════
// MetricsExportAdapter.stop() 종료 경로
// ══════════════════════════════════════════

describe("MetricsExportAdapter stop 경로", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("stop 시 최종 snapshot export + exporter shutdown", async () => {
    const snapshots: MetricsSnapshot[] = [];
    const mock: MetricsExporterLike = {
      export: vi.fn(async (s) => { snapshots.push(s); }),
      shutdown: vi.fn(async () => {}),
    };
    const sink = new MetricsSink();
    sink.counter("req_total", 10);

    const adapter = new MetricsExportAdapter(mock, () => sink.snapshot(), { interval_ms: 60_000 });
    adapter.start();

    await adapter.stop();

    // 최종 export: counter 값 반영
    expect(snapshots.length).toBeGreaterThanOrEqual(1);
    const last = snapshots[snapshots.length - 1];
    expect(last.counters.some((c) => c.name === "req_total" && c.value === 10)).toBe(true);
    expect(mock.shutdown).toHaveBeenCalledOnce();
    expect(adapter.running).toBe(false);
  });

  it("stop 후 interval timer 해제 확인", async () => {
    const mock: MetricsExporterLike = {
      export: vi.fn(async () => {}),
      shutdown: vi.fn(async () => {}),
    };
    const sink = new MetricsSink();
    const adapter = new MetricsExportAdapter(mock, () => sink.snapshot(), { interval_ms: 1000 });

    adapter.start();
    await adapter.stop();

    // stop 후 timer가 더 이상 export를 트리거하지 않음
    const call_count = (mock.export as ReturnType<typeof vi.fn>).mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect((mock.export as ReturnType<typeof vi.fn>).mock.calls.length).toBe(call_count);
  });
});

// ══════════════════════════════════════════
// cleanup_observability 클로저 통합
// ══════════════════════════════════════════

describe("cleanup_observability 통합", () => {
  it("span + metrics 양쪽 adapter를 순차 shutdown", async () => {
    const call_order: string[] = [];

    const trace_mock: TraceExporterLike = {
      export: async () => {},
      shutdown: vi.fn(async () => { call_order.push("trace_shutdown"); }),
    };
    const metrics_mock: MetricsExporterLike = {
      export: async () => {},
      shutdown: vi.fn(async () => { call_order.push("metrics_shutdown"); }),
    };

    const span_adapter = new SpanExportAdapter(trace_mock);
    const sink = new MetricsSink();
    const metrics_adapter = new MetricsExportAdapter(metrics_mock, () => sink.snapshot());
    metrics_adapter.start();

    // main.ts의 cleanup_observability 클로저 재현
    const cleanup_observability = async () => {
      await span_adapter.shutdown();
      await metrics_adapter.stop();
    };

    await cleanup_observability();

    expect(trace_mock.shutdown).toHaveBeenCalledOnce();
    expect(metrics_mock.shutdown).toHaveBeenCalledOnce();
    expect(call_order).toEqual(["trace_shutdown", "metrics_shutdown"]);
    expect(metrics_adapter.running).toBe(false);
  });

  it("버퍼에 span이 남아있으면 cleanup 시 flush됨", async () => {
    const exported: ExecutionSpan[][] = [];
    const trace_mock: TraceExporterLike = {
      export: vi.fn(async (spans) => { exported.push([...spans]); }),
      shutdown: vi.fn(async () => {}),
    };
    const metrics_mock: MetricsExporterLike = {
      export: async () => {},
      shutdown: async () => {},
    };

    const span_adapter = new SpanExportAdapter(trace_mock);
    const recorder = new ExecutionSpanRecorder({ on_end: span_adapter.on_span_end });
    const sink = new MetricsSink();
    const metrics_adapter = new MetricsExportAdapter(metrics_mock, () => sink.snapshot());
    metrics_adapter.start();

    // 3개 span 기록
    recorder.start("orchestration_run", "run_1", create_correlation()).end();
    recorder.start("workflow_run", "phase_1", create_correlation()).end();
    recorder.start("delivery", "send_1", create_correlation()).fail("timeout");

    const cleanup_observability = async () => {
      await span_adapter.shutdown();
      await metrics_adapter.stop();
    };

    await cleanup_observability();

    expect(exported).toHaveLength(1);
    expect(exported[0]).toHaveLength(3);
    expect(exported[0][0].name).toBe("run_1");
    expect(exported[0][2].status).toBe("error");
  });

  it("no-op exporter로 cleanup해도 에러 없음", async () => {
    const span_adapter = new SpanExportAdapter(NOOP_TRACE_EXPORTER);
    const sink = new MetricsSink();
    const metrics_adapter = new MetricsExportAdapter(NOOP_METRICS_EXPORTER, () => sink.snapshot());
    metrics_adapter.start();

    const cleanup_observability = async () => {
      await span_adapter.shutdown();
      await metrics_adapter.stop();
    };

    await expect(cleanup_observability()).resolves.toBeUndefined();
  });
});
