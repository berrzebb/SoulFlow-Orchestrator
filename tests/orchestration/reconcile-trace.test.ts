/**
 * PAR-5: reconcile-trace 테스트.
 *
 * - emit_reconcile_event: 4가지 이벤트 발행 + span 속성 검증
 * - filter_reconcile_spans: reconcile 이벤트만 필터링
 * - SpanKind "orchestration_run" 유지 (enum 변경 없음)
 */

import { describe, it, expect, beforeEach } from "vitest";
import { ExecutionSpanRecorder } from "@src/observability/index.js";
import {
  emit_reconcile_event,
  filter_reconcile_spans,
} from "@src/orchestration/reconcile-trace.js";

let recorder: ExecutionSpanRecorder;

beforeEach(() => {
  recorder = new ExecutionSpanRecorder();
});

// ── emit_reconcile_event ──────────────────────────────────────────

describe("emit_reconcile_event — reconcile_start", () => {
  it("span kind = 'orchestration_run', name = 'reconcile_start'", () => {
    const span = emit_reconcile_event(
      recorder,
      "reconcile_start",
      { trace_id: "t1" },
      { source_node_ids: ["n1", "n2"], policy: "majority_vote" },
    );
    expect(span.kind).toBe("orchestration_run");
    expect(span.name).toBe("reconcile_start");
    expect(span.status).toBe("ok");
  });

  it("attributes에 source_node_ids + policy 포함", () => {
    const span = emit_reconcile_event(
      recorder,
      "reconcile_start",
      {},
      { source_node_ids: ["a", "b"], policy: "first_wins" },
    );
    expect(span.attributes["source_node_ids"]).toEqual(["a", "b"]);
    expect(span.attributes["policy"]).toBe("first_wins");
  });
});

describe("emit_reconcile_event — reconcile_conflict", () => {
  it("conflict_count + conflict_fields 속성 기록", () => {
    const span = emit_reconcile_event(
      recorder,
      "reconcile_conflict",
      {},
      { conflict_count: 2, conflict_fields: ["score", "rating"] },
    );
    expect(span.name).toBe("reconcile_conflict");
    expect(span.attributes["conflict_count"]).toBe(2);
    expect(span.attributes["conflict_fields"]).toEqual(["score", "rating"]);
  });
});

describe("emit_reconcile_event — reconcile_retry", () => {
  it("round + rework_instruction 속성 기록", () => {
    const span = emit_reconcile_event(
      recorder,
      "reconcile_retry",
      {},
      { round: 1, rework_instruction: "re-evaluate score" },
    );
    expect(span.name).toBe("reconcile_retry");
    expect(span.attributes["round"]).toBe(1);
    expect(span.attributes["rework_instruction"]).toBe("re-evaluate score");
  });

  it("rework_instruction 미지정 시 속성 누락", () => {
    const span = emit_reconcile_event(
      recorder,
      "reconcile_retry",
      {},
      { round: 2 },
    );
    expect(span.attributes["rework_instruction"]).toBeUndefined();
  });
});

describe("emit_reconcile_event — reconcile_finalized", () => {
  it("policy_applied + succeeded + failed + verdict 속성 기록", () => {
    const span = emit_reconcile_event(
      recorder,
      "reconcile_finalized",
      { trace_id: "t-final" },
      { policy_applied: "last_wins", succeeded: 3, failed: 1, verdict: "pass" },
    );
    expect(span.name).toBe("reconcile_finalized");
    expect(span.attributes["policy_applied"]).toBe("last_wins");
    expect(span.attributes["succeeded"]).toBe(3);
    expect(span.attributes["failed"]).toBe(1);
    expect(span.attributes["verdict"]).toBe("pass");
  });
});

// ── filter_reconcile_spans ────────────────────────────────────────

describe("filter_reconcile_spans", () => {
  it("reconcile 이벤트 span만 반환, 비-reconcile span 제외", () => {
    // reconcile 이벤트 발행
    emit_reconcile_event(recorder, "reconcile_start", {}, { source_node_ids: [], policy: "first_wins" });
    emit_reconcile_event(recorder, "reconcile_finalized", {}, { policy_applied: "first_wins", succeeded: 1, failed: 0 });
    // 비-reconcile span
    recorder.start("orchestration_run", "some_other_event", {}, {}).end("ok");
    recorder.start("workflow_run", "workflow_step", {}, {}).end("ok");

    const filtered = filter_reconcile_spans(recorder);
    expect(filtered).toHaveLength(2);
    expect(filtered.map((s) => s.name)).toContain("reconcile_start");
    expect(filtered.map((s) => s.name)).toContain("reconcile_finalized");
  });

  it("reconcile 이벤트 없을 때 빈 배열 반환", () => {
    recorder.start("workflow_run", "step", {}, {}).end("ok");
    expect(filter_reconcile_spans(recorder)).toHaveLength(0);
  });

  it("4가지 reconcile 이벤트 모두 필터링됨", () => {
    emit_reconcile_event(recorder, "reconcile_start", {}, { source_node_ids: [], policy: "majority_vote" });
    emit_reconcile_event(recorder, "reconcile_conflict", {}, { conflict_count: 1, conflict_fields: ["f"] });
    emit_reconcile_event(recorder, "reconcile_retry", {}, { round: 1 });
    emit_reconcile_event(recorder, "reconcile_finalized", {}, { policy_applied: "majority_vote", succeeded: 2, failed: 0 });

    const filtered = filter_reconcile_spans(recorder);
    expect(filtered).toHaveLength(4);
    const names = new Set(filtered.map((s) => s.name));
    expect(names.has("reconcile_start")).toBe(true);
    expect(names.has("reconcile_conflict")).toBe(true);
    expect(names.has("reconcile_retry")).toBe(true);
    expect(names.has("reconcile_finalized")).toBe(true);
  });

  it("span recorder에 emit된 span이 실제 저장됨 (recorder 통합)", () => {
    emit_reconcile_event(recorder, "reconcile_start", {}, { source_node_ids: ["n1"], policy: "first_wins" });
    expect(recorder.get_spans()).toHaveLength(1);
  });
});
