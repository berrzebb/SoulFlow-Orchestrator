/**
 * PAR-2: DeterministicReconcilePolicy + apply_reconcile_policy 검증.
 */

import { describe, it, expect } from "vitest";
import { apply_reconcile_policy } from "../../src/orchestration/reconcile-policy.js";
import {
  build_parallel_envelope,
  detect_conflicts,
  type ParallelAgentResult,
} from "../../src/orchestration/parallel-contracts.js";

function make_results(contents: Array<string | null>): ParallelAgentResult[] {
  return contents.map((c, i) => ({
    agent_id: `a${i + 1}`,
    content: c,
    ...(c === null ? { error: "failed" } : {}),
  }));
}

// ── first_wins ───────────────────────────────────────────────────

describe("apply_reconcile_policy — first_wins", () => {
  it("첫 번째 성공 결과 반환", () => {
    const env = build_parallel_envelope(
      ["n1", "n2", "n3"],
      make_results(["A", "B", "C"]),
    );
    const result = apply_reconcile_policy(env, "first_wins");
    expect(result).toBe("A");
  });

  it("첫 번째가 실패 → 다음 성공 결과 반환", () => {
    const env = build_parallel_envelope(
      ["n1", "n2"],
      make_results([null, "B"]),
    );
    const result = apply_reconcile_policy(env, "first_wins");
    expect(result).toBe("B");
  });

  it("모두 실패 → null 반환", () => {
    const env = build_parallel_envelope(["n1"], make_results([null]));
    const result = apply_reconcile_policy(env, "first_wins");
    expect(result).toBeNull();
  });
});

// ── last_wins ────────────────────────────────────────────────────

describe("apply_reconcile_policy — last_wins", () => {
  it("마지막 성공 결과 반환", () => {
    const env = build_parallel_envelope(
      ["n1", "n2", "n3"],
      make_results(["A", "B", "C"]),
    );
    const result = apply_reconcile_policy(env, "last_wins");
    expect(result).toBe("C");
  });

  it("마지막이 실패 → 그 전 성공 결과 반환", () => {
    const env = build_parallel_envelope(
      ["n1", "n2"],
      make_results(["A", null]),
    );
    const result = apply_reconcile_policy(env, "last_wins");
    expect(result).toBe("A");
  });
});

// ── majority_vote ────────────────────────────────────────────────

describe("apply_reconcile_policy — majority_vote", () => {
  it("과반수 동일 content → 해당 값 채택", () => {
    const env = build_parallel_envelope(
      ["n1", "n2", "n3"],
      make_results(["X", "X", "Y"]),
    );
    const result = apply_reconcile_policy(env, "majority_vote");
    expect(result).toBe("X");
  });

  it("동수(tie) → 첫 번째 값 채택 (결정론적 보장)", () => {
    const env = build_parallel_envelope(
      ["n1", "n2"],
      make_results(["A", "B"]),
    );
    const result = apply_reconcile_policy(env, "majority_vote");
    expect(result).toBe("A");
  });

  it("모두 동일 → 해당 값 채택", () => {
    const env = build_parallel_envelope(
      ["n1", "n2", "n3"],
      make_results(["same", "same", "same"]),
    );
    const result = apply_reconcile_policy(env, "majority_vote");
    expect(result).toBe("same");
  });
});

// ── merge_union ──────────────────────────────────────────────────

describe("apply_reconcile_policy — merge_union", () => {
  it("parsed 객체 필드들의 합집합 반환", () => {
    const results: ParallelAgentResult[] = [
      { agent_id: "a1", content: "x", parsed: { name: "Alice", role: "admin" } },
      { agent_id: "a2", content: "y", parsed: { name: "Alice", score: 0.9 } },
    ];
    const env = build_parallel_envelope(["n1", "n2"], results);
    const result = apply_reconcile_policy(env, "merge_union") as Record<string, unknown>;
    expect(result["name"]).toBe("Alice");  // 합의 값
    expect(result["role"]).toBe("admin");  // a1 고유
    expect(result["score"]).toBe(0.9);    // a2 고유
  });

  it("content만 있는 경우 → 배열로 합집합 반환", () => {
    const env = build_parallel_envelope(
      ["n1", "n2"],
      make_results(["Part A", "Part B"]),
    );
    const result = apply_reconcile_policy(env, "merge_union");
    expect(Array.isArray(result)).toBe(true);
    expect(result as unknown[]).toContain("Part A");
    expect(result as unknown[]).toContain("Part B");
  });
});

// ── conflict_set 연동 ────────────────────────────────────────────

describe("apply_reconcile_policy — conflict_set 전달 시 합의 필드 우선 사용", () => {
  it("majority_vote + conflict_set → 충돌 없는 필드는 consensus에서", () => {
    const results: ParallelAgentResult[] = [
      { agent_id: "a1", content: "x", parsed: { category: "tech", score: 0.9 } },
      { agent_id: "a2", content: "y", parsed: { category: "tech", score: 0.9 } },
      { agent_id: "a3", content: "z", parsed: { category: "science", score: 0.9 } },
    ];
    const env = build_parallel_envelope(["n1", "n2", "n3"], results);
    const conflicts = detect_conflicts(results, "parsed");
    const result = apply_reconcile_policy(env, "majority_vote", conflicts) as Record<string, unknown>;
    // score는 합의 — consensus에서 가져옴
    expect(result["score"]).toBe(0.9);
    // category는 충돌 — majority_vote로 "tech" 채택 (2/3)
    expect(result["category"]).toBe("tech");
  });
});
