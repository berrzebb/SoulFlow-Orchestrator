/**
 * OB-4 — MetricsSink 단위 테스트.
 *
 * 검증 항목:
 *   1. counter: 누적 증가, 라벨별 분리
 *   2. gauge: 마지막 값 유지
 *   3. histogram: count/sum/bucket 누적
 *   4. snapshot: 전체 메트릭 스냅샷 반환
 *   5. reset: 전체 초기화
 *   6. 라벨 분리: 같은 이름이라도 라벨이 다르면 독립 집계
 */
import { describe, it, expect } from "vitest";
import { MetricsSink } from "@src/observability/metrics.js";

describe("MetricsSink — counter", () => {
  it("기본 증가값은 1이다", () => {
    const sink = new MetricsSink();
    sink.counter("http_requests_total");
    sink.counter("http_requests_total");
    sink.counter("http_requests_total");

    const snap = sink.snapshot();
    expect(snap.counters).toHaveLength(1);
    expect(snap.counters[0].value).toBe(3);
    expect(snap.counters[0].name).toBe("http_requests_total");
  });

  it("커스텀 증가값을 지원한다", () => {
    const sink = new MetricsSink();
    sink.counter("channel_inbound_total", 5);

    expect(sink.snapshot().counters[0].value).toBe(5);
  });

  it("라벨이 다르면 독립 카운터다", () => {
    const sink = new MetricsSink();
    sink.counter("http_requests_total", 1, { method: "GET" });
    sink.counter("http_requests_total", 1, { method: "POST" });
    sink.counter("http_requests_total", 1, { method: "GET" });

    const snap = sink.snapshot();
    expect(snap.counters).toHaveLength(2);
    const get = snap.counters.find(c => c.labels.method === "GET")!;
    const post = snap.counters.find(c => c.labels.method === "POST")!;
    expect(get.value).toBe(2);
    expect(post.value).toBe(1);
  });

  it("라벨 없는 counter와 라벨 있는 counter는 독립이다", () => {
    const sink = new MetricsSink();
    sink.counter("orchestration_runs_total");
    sink.counter("orchestration_runs_total", 1, { provider: "openai" });

    expect(sink.snapshot().counters).toHaveLength(2);
  });
});

describe("MetricsSink — gauge", () => {
  it("마지막 설정값만 유지한다", () => {
    const sink = new MetricsSink();
    sink.gauge("active_runs_count", 5);
    sink.gauge("active_runs_count", 3);
    sink.gauge("active_runs_count", 7);

    const snap = sink.snapshot();
    expect(snap.gauges).toHaveLength(1);
    expect(snap.gauges[0].value).toBe(7);
  });

  it("라벨이 다르면 독립 게이지다", () => {
    const sink = new MetricsSink();
    sink.gauge("active_runs_count", 2, { team_id: "t1" });
    sink.gauge("active_runs_count", 5, { team_id: "t2" });

    expect(sink.snapshot().gauges).toHaveLength(2);
    const t1 = sink.snapshot().gauges.find(g => g.labels.team_id === "t1")!;
    expect(t1.value).toBe(2);
  });
});

describe("MetricsSink — histogram", () => {
  it("count와 sum을 누적한다", () => {
    const sink = new MetricsSink();
    sink.histogram("http_request_duration_ms", 100);
    sink.histogram("http_request_duration_ms", 200);
    sink.histogram("http_request_duration_ms", 50);

    const snap = sink.snapshot();
    expect(snap.histograms).toHaveLength(1);
    expect(snap.histograms[0].count).toBe(3);
    expect(snap.histograms[0].sum).toBe(350);
  });

  it("기본 bucket 경계가 적용된다", () => {
    const sink = new MetricsSink();
    sink.histogram("http_request_duration_ms", 42);

    const h = sink.snapshot().histograms[0];
    expect(h.buckets.length).toBe(11);
    expect(h.buckets[0]).toEqual({ le: 5, count: 0 });    // 42 > 5
    expect(h.buckets[2]).toEqual({ le: 25, count: 0 });    // 42 > 25
    expect(h.buckets[3]).toEqual({ le: 50, count: 1 });    // 42 <= 50
    expect(h.buckets[4]).toEqual({ le: 100, count: 1 });   // 42 <= 100
  });

  it("커스텀 bucket을 지원한다", () => {
    const sink = new MetricsSink({ buckets: [10, 100, 1000] });
    sink.histogram("duration", 50);

    const h = sink.snapshot().histograms[0];
    expect(h.buckets).toHaveLength(3);
    expect(h.buckets[0]).toEqual({ le: 10, count: 0 });
    expect(h.buckets[1]).toEqual({ le: 100, count: 1 });
    expect(h.buckets[2]).toEqual({ le: 1000, count: 1 });
  });

  it("라벨이 다르면 독립 histogram이다", () => {
    const sink = new MetricsSink();
    sink.histogram("orchestration_run_duration_ms", 100, { provider: "openai" });
    sink.histogram("orchestration_run_duration_ms", 200, { provider: "anthropic" });

    expect(sink.snapshot().histograms).toHaveLength(2);
  });

  it("bucket은 누적(cumulative)이다 — 모든 상한에 카운트", () => {
    const sink = new MetricsSink({ buckets: [10, 50, 100] });
    sink.histogram("d", 5);
    sink.histogram("d", 30);
    sink.histogram("d", 80);

    const h = sink.snapshot().histograms[0];
    expect(h.count).toBe(3);
    expect(h.buckets[0]).toEqual({ le: 10, count: 1 });   // 5
    expect(h.buckets[1]).toEqual({ le: 50, count: 2 });   // 5, 30
    expect(h.buckets[2]).toEqual({ le: 100, count: 3 });  // 5, 30, 80
  });
});

describe("MetricsSink — snapshot + reset", () => {
  it("snapshot은 독립 복사본이다", () => {
    const sink = new MetricsSink();
    sink.counter("a");
    const snap = sink.snapshot();
    sink.counter("a");

    expect(snap.counters[0].value).toBe(1);
    expect(sink.snapshot().counters[0].value).toBe(2);
  });

  it("reset으로 전체 메트릭이 초기화된다", () => {
    const sink = new MetricsSink();
    sink.counter("a");
    sink.gauge("b", 1);
    sink.histogram("c", 10);
    sink.reset();

    const snap = sink.snapshot();
    expect(snap.counters).toHaveLength(0);
    expect(snap.gauges).toHaveLength(0);
    expect(snap.histograms).toHaveLength(0);
  });
});

describe("MetricsSink — 설계 문서 대상 메트릭", () => {
  it("work-breakdown.md 우선 대상 메트릭 10종이 정상 기록된다", () => {
    const sink = new MetricsSink();

    sink.counter("http_requests_total", 1, { method: "GET", status: "200" });
    sink.histogram("http_request_duration_ms", 45, { method: "GET" });
    sink.counter("orchestration_runs_total", 1, { provider: "openai" });
    sink.histogram("orchestration_run_duration_ms", 1200, { provider: "openai" });
    sink.counter("workflow_runs_total");
    sink.histogram("workflow_run_duration_ms", 3000);
    sink.counter("channel_inbound_total", 1, { provider: "slack" });
    sink.counter("channel_outbound_total", 1, { provider: "slack" });
    sink.counter("sse_broadcast_total");
    sink.gauge("active_runs_count", 2);

    const snap = sink.snapshot();
    expect(snap.counters.length).toBeGreaterThanOrEqual(6);
    expect(snap.gauges).toHaveLength(1);
    expect(snap.histograms).toHaveLength(3);
  });
});
