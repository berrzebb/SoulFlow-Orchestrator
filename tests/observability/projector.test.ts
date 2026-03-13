/**
 * OB-7 — Projector / Dashboard Read Model 단위 테스트.
 *
 * 검증 항목:
 *   1. failure_summary — 실패 span을 kind별로 그룹화
 *   2. error_rate — 전체 대비 에러 비율 계산
 *   3. latency_summary — kind별 p50/p95/p99
 *   4. delivery_mismatch — requested ≠ delivered 채널 불일치 추출
 *   5. 빈 데이터 — span/metrics 없을 때 안전한 기본값
 *   6. provider_usage — counter 기반 프로바이더별 사용량
 */
import { describe, it, expect } from "vitest";
import { project_summary, type ObservabilitySummary } from "@src/observability/projector.js";
import { ExecutionSpanRecorder, type SpanKind } from "@src/observability/span.js";
import { MetricsSink } from "@src/observability/metrics.js";
import { create_correlation } from "@src/observability/correlation.js";

function make_obs() {
  return { spans: new ExecutionSpanRecorder(), metrics: new MetricsSink() };
}

/** 지정된 kind/status로 span을 빠르게 추가. */
function add_span(
  recorder: ExecutionSpanRecorder,
  kind: SpanKind,
  name: string,
  status: "ok" | "error",
  duration_ms: number,
  attrs: Record<string, unknown> = {},
) {
  const handle = recorder.start(kind, name, create_correlation(), attrs);
  if (status === "error") {
    handle.fail("test_error");
  } else {
    handle.end("ok");
  }
  // duration_ms를 직접 설정 (테스트용)
  const spans = recorder.get_spans();
  const last = spans[spans.length - 1];
  (last as { duration_ms: number }).duration_ms = duration_ms;
}

describe("project_summary — failure_summary", () => {
  it("실패 span을 kind별로 그룹화한다", () => {
    const obs = make_obs();
    add_span(obs.spans, "http_request", "GET /api", "error", 100);
    add_span(obs.spans, "http_request", "POST /api", "error", 200);
    add_span(obs.spans, "orchestration_run", "execute", "error", 300);
    add_span(obs.spans, "http_request", "GET /health", "ok", 50);

    const summary = project_summary(obs);

    expect(summary.failure_summary).toHaveLength(2);
    const http_failures = summary.failure_summary.find(f => f.kind === "http_request");
    expect(http_failures).toBeDefined();
    expect(http_failures!.count).toBe(2);
    expect(http_failures!.recent_errors).toHaveLength(2);

    const orch_failures = summary.failure_summary.find(f => f.kind === "orchestration_run");
    expect(orch_failures!.count).toBe(1);
  });
});

describe("project_summary — error_rate", () => {
  it("전체 span 대비 에러 비율을 계산한다", () => {
    const obs = make_obs();
    add_span(obs.spans, "http_request", "a", "ok", 10);
    add_span(obs.spans, "http_request", "b", "error", 20);
    add_span(obs.spans, "http_request", "c", "ok", 30);
    add_span(obs.spans, "http_request", "d", "error", 40);

    const summary = project_summary(obs);

    expect(summary.error_rate.total).toBe(4);
    expect(summary.error_rate.errors).toBe(2);
    expect(summary.error_rate.rate).toBeCloseTo(0.5);
  });

  it("span이 없으면 rate = 0", () => {
    const obs = make_obs();
    const summary = project_summary(obs);
    expect(summary.error_rate.rate).toBe(0);
    expect(summary.error_rate.total).toBe(0);
  });
});

describe("project_summary — latency_summary", () => {
  it("kind별 p50/p95/p99를 계산한다", () => {
    const obs = make_obs();
    // 10개의 http_request span (10ms ~ 100ms)
    for (let i = 1; i <= 10; i++) {
      add_span(obs.spans, "http_request", `req${i}`, "ok", i * 10);
    }

    const summary = project_summary(obs);
    const http_lat = summary.latency_summary.find(l => l.kind === "http_request");
    expect(http_lat).toBeDefined();
    expect(http_lat!.count).toBe(10);
    expect(http_lat!.p50).toBeGreaterThanOrEqual(50);
    expect(http_lat!.p95).toBeGreaterThanOrEqual(90);
    expect(http_lat!.p99).toBeGreaterThanOrEqual(90);
  });
});

describe("project_summary — delivery_mismatch", () => {
  it("requested ≠ delivered 채널 불일치를 추출한다", () => {
    const obs = make_obs();
    add_span(obs.spans, "delivery", "send", "ok", 50, {
      requested_channel: "slack",
      delivered_channel: "telegram",
      delivery_status: "sent",
    });
    add_span(obs.spans, "delivery", "send", "ok", 30, {
      requested_channel: "slack",
      delivered_channel: "slack",
      delivery_status: "sent",
    });

    const summary = project_summary(obs);

    expect(summary.delivery_mismatch).toHaveLength(1);
    expect(summary.delivery_mismatch[0].requested_channel).toBe("slack");
    expect(summary.delivery_mismatch[0].delivered_channel).toBe("telegram");
  });

  it("delivery span이 없으면 빈 배열", () => {
    const obs = make_obs();
    const summary = project_summary(obs);
    expect(summary.delivery_mismatch).toEqual([]);
  });
});

describe("project_summary — provider_usage", () => {
  it("orchestration_runs_total counter에서 프로바이더별 사용량을 추출한다", () => {
    const obs = make_obs();
    obs.metrics.counter("orchestration_runs_total", 3, { status: "ok", provider: "claude" });
    obs.metrics.counter("orchestration_runs_total", 1, { status: "error", provider: "claude" });
    obs.metrics.counter("orchestration_runs_total", 2, { status: "ok", provider: "openai" });

    const summary = project_summary(obs);

    expect(summary.provider_usage).toHaveLength(2);
    const claude = summary.provider_usage.find(p => p.provider === "claude");
    expect(claude).toBeDefined();
    expect(claude!.total).toBe(4);
    expect(claude!.errors).toBe(1);
  });
});

describe("project_summary — 빈 데이터", () => {
  it("span/metrics 없을 때 안전한 기본값을 반환한다", () => {
    const obs = make_obs();
    const summary = project_summary(obs);

    expect(summary.failure_summary).toEqual([]);
    expect(summary.error_rate).toEqual({ total: 0, errors: 0, rate: 0 });
    expect(summary.latency_summary).toEqual([]);
    expect(summary.delivery_mismatch).toEqual([]);
    expect(summary.provider_usage).toEqual([]);
  });
});
