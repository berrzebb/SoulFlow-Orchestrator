/**
 * EG-5: Guardrail Observability 테스트.
 *
 * record_guardrail_metrics가 stop_reason에 따라 올바른 counters를 방출하는지 검증.
 */
import { describe, it, expect } from "vitest";
import { MetricsSink } from "@src/observability/metrics.js";
import { record_guardrail_metrics } from "@src/orchestration/guardrails/observability.js";
import { STOP_REASON_BUDGET_EXCEEDED } from "@src/orchestration/guardrails/budget-policy.js";
import type { OrchestrationResult } from "@src/orchestration/types.js";

function make_result(overrides: Partial<OrchestrationResult> = {}): OrchestrationResult {
  return { reply: "test", mode: "once", tool_calls_count: 0, streamed: false, ...overrides };
}

describe("record_guardrail_metrics", () => {
  it("stop_reason 없으면 카운터 방출하지 않음", () => {
    const sink = new MetricsSink();
    record_guardrail_metrics(sink, make_result(), "slack");
    expect(sink.snapshot().counters).toHaveLength(0);
  });

  it("session_reuse:reuse_summary → guardrail_session_reuse_total 카운터", () => {
    const sink = new MetricsSink();
    record_guardrail_metrics(sink, make_result({ stop_reason: "session_reuse:reuse_summary" }), "slack");
    const counters = sink.snapshot().counters;
    expect(counters).toHaveLength(1);
    expect(counters[0].name).toBe("guardrail_session_reuse_total");
    expect(counters[0].labels).toEqual({ kind: "reuse_summary", provider: "slack" });
    expect(counters[0].value).toBe(1);
  });

  it("session_reuse:same_topic → kind=same_topic 라벨", () => {
    const sink = new MetricsSink();
    record_guardrail_metrics(sink, make_result({ stop_reason: "session_reuse:same_topic" }), "telegram");
    const c = sink.snapshot().counters[0];
    expect(c.labels).toEqual({ kind: "same_topic", provider: "telegram" });
  });

  it("budget_exceeded → guardrail_budget_exceeded_total 카운터", () => {
    const sink = new MetricsSink();
    record_guardrail_metrics(sink, make_result({ stop_reason: STOP_REASON_BUDGET_EXCEEDED, mode: "agent" }), "web");
    const counters = sink.snapshot().counters;
    expect(counters).toHaveLength(1);
    expect(counters[0].name).toBe("guardrail_budget_exceeded_total");
    expect(counters[0].labels).toEqual({ provider: "web", mode: "agent" });
  });

  it("알 수 없는 stop_reason → 카운터 방출하지 않음", () => {
    const sink = new MetricsSink();
    record_guardrail_metrics(sink, make_result({ stop_reason: "unknown_reason" }), "slack");
    expect(sink.snapshot().counters).toHaveLength(0);
  });

  it("여러 번 호출 시 카운터 누적", () => {
    const sink = new MetricsSink();
    record_guardrail_metrics(sink, make_result({ stop_reason: "session_reuse:reuse_summary" }), "slack");
    record_guardrail_metrics(sink, make_result({ stop_reason: "session_reuse:reuse_summary" }), "slack");
    record_guardrail_metrics(sink, make_result({ stop_reason: STOP_REASON_BUDGET_EXCEEDED, mode: "task" }), "slack");
    const counters = sink.snapshot().counters;
    expect(counters).toHaveLength(2);
    const reuse = counters.find(c => c.name === "guardrail_session_reuse_total");
    const budget = counters.find(c => c.name === "guardrail_budget_exceeded_total");
    expect(reuse?.value).toBe(2);
    expect(budget?.value).toBe(1);
  });

  it("provider별 라벨 분리", () => {
    const sink = new MetricsSink();
    record_guardrail_metrics(sink, make_result({ stop_reason: "session_reuse:reuse_summary" }), "slack");
    record_guardrail_metrics(sink, make_result({ stop_reason: "session_reuse:reuse_summary" }), "telegram");
    const counters = sink.snapshot().counters;
    expect(counters).toHaveLength(2);
    expect(counters[0].labels.provider).toBe("slack");
    expect(counters[1].labels.provider).toBe("telegram");
  });
});
