/**
 * OB-6 — Delivery Trace 단위 테스트.
 *
 * 검증 항목:
 *   1. start_delivery — delivery span 시작, attributes에 pending 상태
 *   2. finish_delivery (sent) — span end(ok) + counter + histogram
 *   3. finish_delivery (failed) — span fail + counter(status=failed)
 *   4. channel mismatch 감지 — requested ≠ delivered → mismatch=true
 *   5. channel match — requested = delivered → mismatch=false
 *   6. NOOP_OBSERVABILITY — 에러 없이 무시
 *   7. delivery_attempt 기록 — 재시도 횟수 span attributes에 보존
 */
import { describe, it, expect } from "vitest";
import { start_delivery, finish_delivery } from "@src/observability/delivery-trace.js";
import { NOOP_OBSERVABILITY, type ObservabilityLike } from "@src/observability/context.js";
import { ExecutionSpanRecorder } from "@src/observability/span.js";
import { MetricsSink } from "@src/observability/metrics.js";
import { create_correlation } from "@src/observability/correlation.js";

function create_test_obs(): ObservabilityLike & { spans: ExecutionSpanRecorder; metrics: MetricsSink } {
  return { spans: new ExecutionSpanRecorder(), metrics: new MetricsSink() };
}

const BASE_ATTRS = {
  requested_channel: "slack",
  delivered_channel: "slack",
  delivery_attempt: 1,
  reply_target_chat_id: "C123",
  reply_target_sender_id: "U456",
};

describe("start_delivery", () => {
  it("delivery span을 pending 상태로 시작한다", () => {
    const obs = create_test_obs();
    const corr = create_correlation({ team_id: "t1" });

    const handle = start_delivery(obs, BASE_ATTRS, corr);

    expect(handle.span.kind).toBe("delivery");
    expect(handle.span.name).toBe("send_outbound");
    expect(handle.span.attributes.delivery_status).toBe("pending");
    expect(handle.span.attributes.requested_channel).toBe("slack");
    expect(handle.span.attributes.delivered_channel).toBe("slack");
    expect(handle.span.attributes.delivery_attempt).toBe(1);
    expect(handle.span.correlation.team_id).toBe("t1");
  });
});

describe("finish_delivery — sent", () => {
  it("성공 시 span end(ok) + delivery_status=sent + counter + histogram", () => {
    const obs = create_test_obs();
    const handle = start_delivery(obs, BASE_ATTRS, create_correlation());

    finish_delivery(handle, obs, "sent", 42);

    // span 검증
    const spans = obs.spans.get_spans();
    expect(spans).toHaveLength(1);
    expect(spans[0].status).toBe("ok");
    expect(spans[0].attributes.delivery_status).toBe("sent");

    // counter 검증
    const snap = obs.metrics.snapshot();
    const counter = snap.counters.find(c => c.name === "delivery_total");
    expect(counter).toBeDefined();
    expect(counter!.labels.status).toBe("sent");
    expect(counter!.labels.mismatch).toBe("false");
    expect(counter!.value).toBe(1);

    // histogram 검증
    const hist = snap.histograms.find(h => h.name === "delivery_duration_ms");
    expect(hist).toBeDefined();
    expect(hist!.count).toBe(1);
    expect(hist!.sum).toBe(42);
  });
});

describe("finish_delivery — failed", () => {
  it("실패 시 span fail + delivery_status=failed + counter(status=failed)", () => {
    const obs = create_test_obs();
    const handle = start_delivery(obs, BASE_ATTRS, create_correlation());

    finish_delivery(handle, obs, "failed", 100);

    const spans = obs.spans.get_spans();
    expect(spans).toHaveLength(1);
    expect(spans[0].status).toBe("error");
    expect(spans[0].error).toBe("delivery_failed");
    expect(spans[0].attributes.delivery_status).toBe("failed");

    const snap = obs.metrics.snapshot();
    const counter = snap.counters.find(c => c.name === "delivery_total");
    expect(counter!.labels.status).toBe("failed");
  });
});

describe("channel mismatch 감지", () => {
  it("requested ≠ delivered → mismatch=true", () => {
    const obs = create_test_obs();
    const attrs = { ...BASE_ATTRS, requested_channel: "slack", delivered_channel: "telegram" };
    const handle = start_delivery(obs, attrs, create_correlation());

    finish_delivery(handle, obs, "sent", 50);

    const snap = obs.metrics.snapshot();
    const counter = snap.counters.find(c => c.name === "delivery_total");
    expect(counter!.labels.mismatch).toBe("true");
    expect(counter!.labels.channel).toBe("telegram");
  });

  it("requested = delivered → mismatch=false", () => {
    const obs = create_test_obs();
    const handle = start_delivery(obs, BASE_ATTRS, create_correlation());

    finish_delivery(handle, obs, "sent", 30);

    const snap = obs.metrics.snapshot();
    const counter = snap.counters.find(c => c.name === "delivery_total");
    expect(counter!.labels.mismatch).toBe("false");
  });
});

describe("delivery_attempt 기록", () => {
  it("재시도 횟수가 span attributes에 보존된다", () => {
    const obs = create_test_obs();
    const attrs = { ...BASE_ATTRS, delivery_attempt: 3 };
    const handle = start_delivery(obs, attrs, create_correlation());

    finish_delivery(handle, obs, "sent", 200);

    const spans = obs.spans.get_spans();
    expect(spans[0].attributes.delivery_attempt).toBe(3);
  });
});

describe("NOOP_OBSERVABILITY", () => {
  it("no-op에서 에러 없이 동작한다", () => {
    const handle = start_delivery(NOOP_OBSERVABILITY, BASE_ATTRS, create_correlation());
    expect(() => finish_delivery(handle, NOOP_OBSERVABILITY, "sent", 10)).not.toThrow();
    expect(() => finish_delivery(handle, NOOP_OBSERVABILITY, "failed", 10)).not.toThrow();
  });
});
