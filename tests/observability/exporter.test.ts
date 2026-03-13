/**
 * OB-8 — Exporter Ports + No-op Adapter 테스트.
 *
 * 검증 항목:
 *   1. NOOP_TRACE_EXPORTER / NOOP_METRICS_EXPORTER — 호출 시 에러 없음
 *   2. SpanExportAdapter — on_span_end로 버퍼 축적 + flush로 일괄 export
 *   3. SpanExportAdapter — max_buffer 도달 시 자동 flush
 *   4. SpanExportAdapter — shutdown 시 잔여 버퍼 flush + exporter shutdown
 *   5. MetricsExportAdapter — start/stop + 주기적 export
 *   6. ExecutionSpanRecorder on_end → SpanExportAdapter 통합
 *   7. local mode regression: exporter 없어도 observability 정상 동작
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  NOOP_TRACE_EXPORTER,
  NOOP_METRICS_EXPORTER,
  SpanExportAdapter,
  MetricsExportAdapter,
  type TraceExporterLike,
  type MetricsExporterLike,
} from "@src/observability/exporter.js";
import { ExecutionSpanRecorder } from "@src/observability/span.js";
import { MetricsSink } from "@src/observability/metrics.js";
import { NOOP_OBSERVABILITY } from "@src/observability/context.js";
import type { ExecutionSpan } from "@src/observability/span.js";
import type { MetricsSnapshot } from "@src/observability/metrics.js";
import { create_correlation } from "@src/observability/correlation.js";

// ══════════════════════════════════════════
// No-op exporter
// ══════════════════════════════════════════

describe("NOOP_TRACE_EXPORTER", () => {
  it("export 호출 시 에러 없음", async () => {
    await expect(NOOP_TRACE_EXPORTER.export([])).resolves.toBeUndefined();
  });

  it("shutdown 호출 시 에러 없음", async () => {
    await expect(NOOP_TRACE_EXPORTER.shutdown()).resolves.toBeUndefined();
  });
});

describe("NOOP_METRICS_EXPORTER", () => {
  it("export 호출 시 에러 없음", async () => {
    const snapshot: MetricsSnapshot = { counters: [], gauges: [], histograms: [] };
    await expect(NOOP_METRICS_EXPORTER.export(snapshot)).resolves.toBeUndefined();
  });

  it("shutdown 호출 시 에러 없음", async () => {
    await expect(NOOP_METRICS_EXPORTER.shutdown()).resolves.toBeUndefined();
  });
});

// ══════════════════════════════════════════
// SpanExportAdapter
// ══════════════════════════════════════════

describe("SpanExportAdapter", () => {
  let exported: ExecutionSpan[][];
  let mock_exporter: TraceExporterLike;

  beforeEach(() => {
    exported = [];
    mock_exporter = {
      export: async (spans) => { exported.push([...spans]); },
      shutdown: vi.fn(async () => {}),
    };
  });

  it("on_span_end로 버퍼에 span 축적", () => {
    const adapter = new SpanExportAdapter(mock_exporter);
    const recorder = new ExecutionSpanRecorder();
    const handle = recorder.start("orchestration_run", "test", create_correlation());
    handle.end();

    adapter.on_span_end(handle.span);

    expect(adapter.buffered_count).toBe(1);
    expect(exported).toHaveLength(0);
  });

  it("flush()로 버퍼의 span을 일괄 export", async () => {
    const adapter = new SpanExportAdapter(mock_exporter);
    const recorder = new ExecutionSpanRecorder();

    for (let i = 0; i < 3; i++) {
      const h = recorder.start("orchestration_run", `span_${i}`, create_correlation());
      h.end();
      adapter.on_span_end(h.span);
    }

    expect(adapter.buffered_count).toBe(3);
    await adapter.flush();

    expect(adapter.buffered_count).toBe(0);
    expect(exported).toHaveLength(1);
    expect(exported[0]).toHaveLength(3);
  });

  it("빈 버퍼 flush는 exporter를 호출하지 않음", async () => {
    const adapter = new SpanExportAdapter(mock_exporter);
    await adapter.flush();

    expect(exported).toHaveLength(0);
  });

  it("max_buffer 도달 시 자동 flush", async () => {
    const adapter = new SpanExportAdapter(mock_exporter, { max_buffer: 3 });
    const recorder = new ExecutionSpanRecorder();

    for (let i = 0; i < 3; i++) {
      const h = recorder.start("orchestration_run", `span_${i}`, create_correlation());
      h.end();
      adapter.on_span_end(h.span);
    }

    // max_buffer=3 도달 → 자동 flush (비동기)
    await new Promise((r) => setTimeout(r, 10));
    expect(exported.length).toBeGreaterThanOrEqual(1);
    expect(adapter.buffered_count).toBe(0);
  });

  it("shutdown 시 잔여 버퍼 flush + exporter shutdown", async () => {
    const adapter = new SpanExportAdapter(mock_exporter);
    const recorder = new ExecutionSpanRecorder();
    const h = recorder.start("delivery", "send", create_correlation());
    h.end();
    adapter.on_span_end(h.span);

    await adapter.shutdown();

    expect(exported).toHaveLength(1);
    expect(exported[0]).toHaveLength(1);
    expect(mock_exporter.shutdown).toHaveBeenCalledOnce();
    expect(adapter.buffered_count).toBe(0);
  });
});

// ══════════════════════════════════════════
// MetricsExportAdapter
// ══════════════════════════════════════════

describe("MetricsExportAdapter", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("start 후 interval마다 snapshot export", async () => {
    const snapshots: MetricsSnapshot[] = [];
    const mock_exporter: MetricsExporterLike = {
      export: async (s) => { snapshots.push(s); },
      shutdown: vi.fn(async () => {}),
    };
    const sink = new MetricsSink();
    sink.counter("test_counter", 5);

    const adapter = new MetricsExportAdapter(mock_exporter, () => sink.snapshot(), { interval_ms: 1000 });
    adapter.start();

    expect(adapter.running).toBe(true);

    await vi.advanceTimersByTimeAsync(1000);
    expect(snapshots.length).toBeGreaterThanOrEqual(1);
    expect(snapshots[0].counters[0].value).toBe(5);

    sink.counter("test_counter", 3);
    await vi.advanceTimersByTimeAsync(1000);
    expect(snapshots.length).toBeGreaterThanOrEqual(2);
  });

  it("중복 start 호출은 무시", () => {
    const mock_exporter: MetricsExporterLike = {
      export: async () => {},
      shutdown: async () => {},
    };
    const adapter = new MetricsExportAdapter(mock_exporter, () => ({ counters: [], gauges: [], histograms: [] }));
    adapter.start();
    adapter.start(); // 중복

    expect(adapter.running).toBe(true);
  });

  it("stop 시 최종 snapshot export + exporter shutdown", async () => {
    const snapshots: MetricsSnapshot[] = [];
    const mock_exporter: MetricsExporterLike = {
      export: async (s) => { snapshots.push(s); },
      shutdown: vi.fn(async () => {}),
    };
    const sink = new MetricsSink();
    sink.gauge("active_runs", 3);

    const adapter = new MetricsExportAdapter(mock_exporter, () => sink.snapshot(), { interval_ms: 60000 });
    adapter.start();

    await adapter.stop();

    expect(adapter.running).toBe(false);
    // stop 시 최종 export 호출됨
    expect(snapshots.length).toBeGreaterThanOrEqual(1);
    expect(mock_exporter.shutdown).toHaveBeenCalledOnce();
  });
});

// ══════════════════════════════════════════
// 통합: ExecutionSpanRecorder → SpanExportAdapter
// ══════════════════════════════════════════

describe("ExecutionSpanRecorder + SpanExportAdapter 통합", () => {
  it("recorder의 on_end → adapter 버퍼 → flush → exporter", async () => {
    const exported: ExecutionSpan[][] = [];
    const mock_exporter: TraceExporterLike = {
      export: async (spans) => { exported.push([...spans]); },
      shutdown: async () => {},
    };
    const adapter = new SpanExportAdapter(mock_exporter);
    const recorder = new ExecutionSpanRecorder({ on_end: adapter.on_span_end });

    recorder.start("orchestration_run", "exec_1", create_correlation()).end();
    recorder.start("delivery", "send_1", create_correlation()).fail("timeout");

    expect(adapter.buffered_count).toBe(2);

    await adapter.flush();

    expect(exported).toHaveLength(1);
    expect(exported[0]).toHaveLength(2);
    expect(exported[0][0].name).toBe("exec_1");
    expect(exported[0][0].status).toBe("ok");
    expect(exported[0][1].name).toBe("send_1");
    expect(exported[0][1].status).toBe("error");
  });
});

// ══════════════════════════════════════════
// Local mode regression
// ══════════════════════════════════════════

describe("local mode regression", () => {
  it("NOOP_OBSERVABILITY는 exporter 없이 정상 동작", () => {
    const obs = NOOP_OBSERVABILITY;
    const handle = obs.spans.start("orchestration_run", "test", {});
    handle.end();

    expect(obs.spans.get_spans()).toHaveLength(0); // no-op는 기록하지 않음
    expect(obs.metrics.snapshot().counters).toHaveLength(0);
  });

  it("실제 recorder + sink는 exporter 없이 독립 동작", () => {
    const recorder = new ExecutionSpanRecorder();
    const sink = new MetricsSink();
    const obs = { spans: recorder, metrics: sink };

    const h = obs.spans.start("channel_inbound", "msg", create_correlation());
    h.end();
    obs.metrics.counter("test", 1);

    expect(obs.spans.get_spans()).toHaveLength(1);
    expect(obs.metrics.snapshot().counters).toHaveLength(1);
  });

  it("no-op exporter를 연결해도 recorder/sink 동작에 영향 없음", async () => {
    const adapter = new SpanExportAdapter(NOOP_TRACE_EXPORTER);
    const recorder = new ExecutionSpanRecorder({ on_end: adapter.on_span_end });
    const sink = new MetricsSink();

    recorder.start("workflow_run", "phase", create_correlation()).end();
    sink.counter("runs", 1);

    // no-op exporter로 flush해도 에러 없음
    await adapter.flush();

    // recorder와 sink는 정상 동작
    expect(recorder.get_spans()).toHaveLength(1);
    expect(sink.snapshot().counters[0].value).toBe(1);
  });
});
