/**
 * OB-5 — Injection Points 단위 테스트.
 *
 * 검증 항목:
 *   1. instrument() — 비동기 함수를 span + metrics로 감싸서 실행
 *   2. instrument_sync() — 동기 함수를 span + metrics로 감싸서 실행
 *   3. 성공 시 span.end("ok") + counter(status 없음) + histogram 기록
 *   4. 실패 시 span.fail(error) + counter(status="error") + histogram 기록
 *   5. NOOP_OBSERVABILITY — 기존 동작에 영향 없음
 *   6. ObservabilityLike 결합 — SpanRecorder + MetricsSink 실제 인스턴스
 *   7. 각 SpanKind 경로별 계측 검증
 */
import { describe, it, expect, vi } from "vitest";
import { instrument, instrument_sync } from "@src/observability/instrument.js";
import { NOOP_OBSERVABILITY, type ObservabilityLike } from "@src/observability/context.js";
import { ExecutionSpanRecorder } from "@src/observability/span.js";
import { MetricsSink } from "@src/observability/metrics.js";
import { create_correlation } from "@src/observability/correlation.js";

/** 실제 recorder + sink로 구성한 테스트용 observability. */
function create_test_obs(): ObservabilityLike & { spans: ExecutionSpanRecorder; metrics: MetricsSink } {
  return {
    spans: new ExecutionSpanRecorder(),
    metrics: new MetricsSink(),
  };
}

describe("instrument — 비동기 계측", () => {
  it("성공 시 span end(ok) + counter + histogram이 기록된다", async () => {
    const obs = create_test_obs();
    const corr = create_correlation({ team_id: "t1" });

    const result = await instrument(obs, {
      kind: "http_request",
      name: "GET /api/state",
      correlation: corr,
      counter: "http_requests_total",
      counter_labels: { method: "GET" },
      histogram: "http_request_duration_ms",
      histogram_labels: { method: "GET" },
    }, async () => "ok_result");

    expect(result).toBe("ok_result");

    // span 검증
    const spans = obs.spans.get_spans();
    expect(spans).toHaveLength(1);
    expect(spans[0].kind).toBe("http_request");
    expect(spans[0].name).toBe("GET /api/state");
    expect(spans[0].status).toBe("ok");
    expect(spans[0].correlation.team_id).toBe("t1");
    expect(typeof spans[0].duration_ms).toBe("number");

    // metrics 검증
    const snap = obs.metrics.snapshot();
    expect(snap.counters).toHaveLength(1);
    expect(snap.counters[0].name).toBe("http_requests_total");
    expect(snap.counters[0].labels.method).toBe("GET");
    expect(snap.counters[0].value).toBe(1);
    expect(snap.histograms).toHaveLength(1);
    expect(snap.histograms[0].name).toBe("http_request_duration_ms");
    expect(snap.histograms[0].count).toBe(1);
  });

  it("실패 시 span fail + counter(status=error) + histogram이 기록되고 에러가 재throw된다", async () => {
    const obs = create_test_obs();
    const corr = create_correlation();

    await expect(
      instrument(obs, {
        kind: "orchestration_run",
        name: "execute",
        correlation: corr,
        counter: "orchestration_runs_total",
        histogram: "orchestration_run_duration_ms",
      }, async () => { throw new Error("provider_timeout"); }),
    ).rejects.toThrow("provider_timeout");

    const spans = obs.spans.get_spans();
    expect(spans).toHaveLength(1);
    expect(spans[0].status).toBe("error");
    expect(spans[0].error).toBe("provider_timeout");

    const snap = obs.metrics.snapshot();
    expect(snap.counters[0].labels.status).toBe("error");
    expect(snap.histograms[0].count).toBe(1);
  });

  it("counter/histogram 미지정 시 span만 기록된다", async () => {
    const obs = create_test_obs();
    await instrument(obs, {
      kind: "channel_inbound",
      name: "message",
      correlation: create_correlation(),
    }, async () => undefined);

    expect(obs.spans.get_spans()).toHaveLength(1);
    const snap = obs.metrics.snapshot();
    expect(snap.counters).toHaveLength(0);
    expect(snap.histograms).toHaveLength(0);
  });

  it("attributes가 span에 포함된다", async () => {
    const obs = create_test_obs();
    await instrument(obs, {
      kind: "dashboard_route",
      name: "GET /api/config",
      correlation: create_correlation(),
      attributes: { path: "/api/config", method: "GET" },
    }, async () => undefined);

    const span = obs.spans.get_spans()[0];
    expect(span.attributes.path).toBe("/api/config");
    expect(span.attributes.method).toBe("GET");
  });

  it("fn 내부에서 handle.span에 접근 가능하다", async () => {
    const obs = create_test_obs();
    let captured_trace_id = "";
    await instrument(obs, {
      kind: "workflow_run",
      name: "phase_1",
      correlation: create_correlation({ trace_id: "fixed-trace" }),
    }, async (handle) => {
      captured_trace_id = handle.span.trace_id;
    });

    expect(captured_trace_id).toBe("fixed-trace");
  });
});

describe("instrument_sync — 동기 계측", () => {
  it("성공 시 span + metrics가 기록된다", () => {
    const obs = create_test_obs();
    const result = instrument_sync(obs, {
      kind: "delivery",
      name: "send_slack",
      correlation: create_correlation(),
      counter: "channel_outbound_total",
      counter_labels: { provider: "slack" },
    }, () => 42);

    expect(result).toBe(42);
    expect(obs.spans.get_spans()).toHaveLength(1);
    expect(obs.spans.get_spans()[0].status).toBe("ok");
    expect(obs.metrics.snapshot().counters[0].value).toBe(1);
  });

  it("실패 시 에러가 재throw되고 span.fail이 기록된다", () => {
    const obs = create_test_obs();
    expect(() =>
      instrument_sync(obs, {
        kind: "delivery",
        name: "send_telegram",
        correlation: create_correlation(),
        counter: "channel_outbound_total",
      }, () => { throw new Error("network_error"); }),
    ).toThrow("network_error");

    expect(obs.spans.get_spans()[0].status).toBe("error");
    expect(obs.spans.get_spans()[0].error).toBe("network_error");
  });
});

describe("NOOP_OBSERVABILITY — no-op 회귀", () => {
  it("NOOP으로 instrument 호출해도 정상 실행된다", async () => {
    const result = await instrument(NOOP_OBSERVABILITY, {
      kind: "http_request",
      name: "noop_test",
      correlation: create_correlation(),
      counter: "http_requests_total",
      histogram: "http_request_duration_ms",
    }, async () => "pass");

    expect(result).toBe("pass");
  });

  it("NOOP spans.start()가 유효한 handle을 반환한다", () => {
    const handle = NOOP_OBSERVABILITY.spans.start("http_request", "test", {});
    expect(handle.span).toBeDefined();
    expect(handle.end()).toBeDefined();
    expect(handle.fail("err")).toBeDefined();
  });

  it("NOOP metrics 호출이 에러 없이 완료된다", () => {
    expect(() => {
      NOOP_OBSERVABILITY.metrics.counter("a");
      NOOP_OBSERVABILITY.metrics.gauge("b", 1);
      NOOP_OBSERVABILITY.metrics.histogram("c", 10);
      NOOP_OBSERVABILITY.metrics.snapshot();
    }).not.toThrow();
  });

  it("NOOP snapshot은 빈 결과를 반환한다", () => {
    const snap = NOOP_OBSERVABILITY.metrics.snapshot();
    expect(snap.counters).toHaveLength(0);
    expect(snap.gauges).toHaveLength(0);
    expect(snap.histograms).toHaveLength(0);
  });
});

describe("ObservabilityLike — 실제 인스턴스 결합", () => {
  it("SpanRecorder + MetricsSink 실제 인스턴스가 정상 동작한다", async () => {
    const obs = create_test_obs();

    // 여러 경로를 연속 계측
    await instrument(obs, {
      kind: "channel_inbound",
      name: "slack_message",
      correlation: create_correlation({ provider: "slack" }),
      counter: "channel_inbound_total",
      counter_labels: { provider: "slack" },
    }, async () => undefined);

    await instrument(obs, {
      kind: "orchestration_run",
      name: "execute",
      correlation: create_correlation({ provider: "openai" }),
      counter: "orchestration_runs_total",
      counter_labels: { provider: "openai" },
      histogram: "orchestration_run_duration_ms",
    }, async () => undefined);

    await instrument(obs, {
      kind: "delivery",
      name: "send_slack",
      correlation: create_correlation({ provider: "slack" }),
      counter: "channel_outbound_total",
      counter_labels: { provider: "slack" },
    }, async () => undefined);

    // span 3개 기록
    expect(obs.spans.get_spans()).toHaveLength(3);
    expect(obs.spans.get_spans().map(s => s.kind)).toEqual([
      "channel_inbound", "orchestration_run", "delivery",
    ]);

    // metrics 집계
    const snap = obs.metrics.snapshot();
    expect(snap.counters).toHaveLength(3);
    expect(snap.histograms).toHaveLength(1);
  });
});

describe("SpanKind 경로별 계측", () => {
  const KINDS: Array<{ kind: Parameters<typeof instrument>[1]["kind"]; name: string; counter: string }> = [
    { kind: "http_request", name: "GET /api/state", counter: "http_requests_total" },
    { kind: "dashboard_route", name: "state", counter: "http_requests_total" },
    { kind: "channel_inbound", name: "message", counter: "channel_inbound_total" },
    { kind: "orchestration_run", name: "execute", counter: "orchestration_runs_total" },
    { kind: "workflow_run", name: "phase_1", counter: "workflow_runs_total" },
    { kind: "delivery", name: "send_slack", counter: "channel_outbound_total" },
  ];

  it.each(KINDS)("kind '$kind' 경로가 정상 계측된다", async ({ kind, name, counter }) => {
    const obs = create_test_obs();
    await instrument(obs, {
      kind, name,
      correlation: create_correlation(),
      counter,
    }, async () => undefined);

    const span = obs.spans.get_spans()[0];
    expect(span.kind).toBe(kind);
    expect(span.name).toBe(name);
    expect(span.status).toBe("ok");
    expect(obs.metrics.snapshot().counters[0].name).toBe(counter);
  });
});
