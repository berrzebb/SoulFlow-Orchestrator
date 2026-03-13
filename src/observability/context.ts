/**
 * OB-5: Observability 통합 컨텍스트.
 *
 * SpanRecorderLike + MetricsSinkLike를 하나로 묶어 DI 한 번에 주입.
 * 미설정 시 NOOP_OBSERVABILITY로 무비용 fallback.
 */
import type { SpanRecorderLike, SpanHandle, ExecutionSpan, SpanKind } from "./span.js";
import type { MetricsSinkLike, MetricsSnapshot, Labels } from "./metrics.js";
import type { CorrelationContext } from "./correlation.js";

export interface ObservabilityLike {
  readonly spans: SpanRecorderLike;
  readonly metrics: MetricsSinkLike;
}

const NOOP_SPAN: ExecutionSpan = {
  span_id: "", trace_id: "", kind: "http_request", name: "",
  started_at: "", attributes: {}, correlation: {},
};

const NOOP_HANDLE: SpanHandle = {
  span: NOOP_SPAN,
  end: () => NOOP_SPAN,
  fail: () => NOOP_SPAN,
};

const NOOP_RECORDER: SpanRecorderLike = {
  start: () => NOOP_HANDLE,
  get_spans: () => [],
};

const NOOP_SNAPSHOT: MetricsSnapshot = { counters: [], gauges: [], histograms: [] };

const NOOP_SINK: MetricsSinkLike = {
  counter: () => {},
  gauge: () => {},
  histogram: () => {},
  snapshot: () => NOOP_SNAPSHOT,
};

/** 미설정 시 사용하는 무비용 no-op observability. */
export const NOOP_OBSERVABILITY: ObservabilityLike = {
  spans: NOOP_RECORDER,
  metrics: NOOP_SINK,
};
