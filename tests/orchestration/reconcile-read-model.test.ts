/**
 * PAR-6: reconcile-read-model 테스트.
 *
 * - extract_reconcile_read_model: reconcile + critic_gate 노드 식별
 * - has_failures, total_conflicts, unresolved_count 집계
 * - __rounds_used 내부 추적 키 건너뜀
 * - 빈 memory, 혼합 키 처리
 */

import { describe, it, expect } from "vitest";
import { extract_reconcile_read_model } from "@src/orchestration/reconcile-read-model.js";

// ── 빈 memory ────────────────────────────────────────────────────

describe("extract_reconcile_read_model — 빈 memory", () => {
  it("빈 memory → 모든 집계 0, 빈 배열", () => {
    const model = extract_reconcile_read_model({});
    expect(model.reconcile_summaries).toHaveLength(0);
    expect(model.critic_summaries).toHaveLength(0);
    expect(model.has_failures).toBe(false);
    expect(model.total_conflicts).toBe(0);
    expect(model.unresolved_count).toBe(0);
  });
});

// ── reconcile 노드 식별 ──────────────────────────────────────────

describe("extract_reconcile_read_model — reconcile 노드", () => {
  it("policy_applied 키 → ReconcileSummary로 추출", () => {
    const model = extract_reconcile_read_model({
      rec_node_1: {
        policy_applied: "majority_vote",
        succeeded: 2,
        failed: 1,
        conflicts: { fields: ["score", "rating"] },
      },
    });
    expect(model.reconcile_summaries).toHaveLength(1);
    const s = model.reconcile_summaries[0];
    expect(s.node_id).toBe("rec_node_1");
    expect(s.policy).toBe("majority_vote");
    expect(s.succeeded).toBe(2);
    expect(s.failed).toBe(1);
    expect(s.conflict_count).toBe(2);
  });

  it("conflicts.fields 없는 경우 conflict_count = 0", () => {
    const model = extract_reconcile_read_model({
      rec1: { policy_applied: "first_wins", succeeded: 3, failed: 0 },
    });
    expect(model.reconcile_summaries[0].conflict_count).toBe(0);
  });

  it("복수 reconcile 노드 — 모두 추출", () => {
    const model = extract_reconcile_read_model({
      r1: { policy_applied: "first_wins", succeeded: 2, failed: 0, conflicts: { fields: ["f1"] } },
      r2: { policy_applied: "last_wins",  succeeded: 1, failed: 1, conflicts: { fields: ["f2", "f3"] } },
    });
    expect(model.reconcile_summaries).toHaveLength(2);
    expect(model.total_conflicts).toBe(3); // 1 + 2
  });

  it("failed > 0 시 has_failures = true", () => {
    const model = extract_reconcile_read_model({
      r1: { policy_applied: "majority_vote", succeeded: 1, failed: 1 },
    });
    expect(model.has_failures).toBe(true);
  });

  it("모든 reconcile 노드 failed = 0 → has_failures = false", () => {
    const model = extract_reconcile_read_model({
      r1: { policy_applied: "first_wins", succeeded: 3, failed: 0 },
      r2: { policy_applied: "last_wins",  succeeded: 2, failed: 0 },
    });
    expect(model.has_failures).toBe(false);
  });
});

// ── critic_gate 노드 식별 ─────────────────────────────────────────

describe("extract_reconcile_read_model — critic_gate 노드", () => {
  it("verdict + rounds_used + passed 키 → CriticSummary로 추출", () => {
    const model = extract_reconcile_read_model({
      critic_1: { verdict: "pass", rounds_used: 1, passed: true, reason: "looks good" },
    });
    expect(model.critic_summaries).toHaveLength(1);
    const c = model.critic_summaries[0];
    expect(c.node_id).toBe("critic_1");
    expect(c.verdict).toBe("pass");
    expect(c.passed).toBe(true);
    expect(c.rounds_used).toBe(1);
    expect(c.reason).toBe("looks good");
  });

  it("verdict = 'fail' → unresolved_count++", () => {
    const model = extract_reconcile_read_model({
      c1: { verdict: "fail", rounds_used: 2, passed: false },
      c2: { verdict: "pass", rounds_used: 1, passed: true },
    });
    expect(model.unresolved_count).toBe(1);
  });

  it("모든 critic verdict = fail → unresolved_count = 전체 수", () => {
    const model = extract_reconcile_read_model({
      c1: { verdict: "fail", rounds_used: 2, passed: false },
      c2: { verdict: "fail", rounds_used: 2, passed: false },
    });
    expect(model.unresolved_count).toBe(2);
  });

  it("reason 없는 critic 노드 → reason undefined", () => {
    const model = extract_reconcile_read_model({
      c1: { verdict: "pass", rounds_used: 1, passed: true },
    });
    expect(model.critic_summaries[0].reason).toBeUndefined();
  });
});

// ── 내부 추적 키 건너뜀 ──────────────────────────────────────────

describe("extract_reconcile_read_model — __rounds_used 건너뜀", () => {
  it("__rounds_used 접미사 키 → critic summary에 포함 안 됨", () => {
    const model = extract_reconcile_read_model({
      "critic_1__rounds_used": 3,
      critic_1: { verdict: "pass", rounds_used: 1, passed: true },
    });
    // __rounds_used는 제외, critic_1만 포함
    expect(model.critic_summaries).toHaveLength(1);
    expect(model.critic_summaries[0].node_id).toBe("critic_1");
  });
});

// ── 혼합 키 처리 ─────────────────────────────────────────────────

describe("extract_reconcile_read_model — 비-reconcile 키 무시", () => {
  it("인식 불가 키 (문자열, null, 일반 객체) → 무시", () => {
    const model = extract_reconcile_read_model({
      some_string: "hello",
      some_null: null,
      some_number: 42,
      unrelated_obj: { foo: "bar" },
    });
    expect(model.reconcile_summaries).toHaveLength(0);
    expect(model.critic_summaries).toHaveLength(0);
  });

  it("reconcile + critic + 기타 혼합 → 정확히 분리", () => {
    const model = extract_reconcile_read_model({
      rec_node: { policy_applied: "first_wins", succeeded: 2, failed: 0 },
      critic_node: { verdict: "fail", rounds_used: 2, passed: false },
      unrelated: { some_field: "value" },
      "critic_node__rounds_used": 2,
    });
    expect(model.reconcile_summaries).toHaveLength(1);
    expect(model.critic_summaries).toHaveLength(1);
  });
});
