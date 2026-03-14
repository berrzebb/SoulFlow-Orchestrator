/**
 * PAR-5 + PAR-6: ParallelConflictEvalExecutor + parallel-conflict bundle 테스트.
 *
 * - reconcile: majority_vote/first_wins/last_wins/merge_union/all_failed
 * - critic: pass/fail/rework/error
 * - read_model: has_failures/total_conflicts/unresolved_count/reconcile_count/__rounds_used 건너뜀
 * - 잘못된 입력 에러 처리
 * - parallel-conflict bundle 등록 + 데이터셋 로드
 * - eval runner 통합: 전체 데이터셋 실행 → 전체 통과
 */

import { describe, it, expect, beforeEach } from "vitest";
import { create_parallel_conflict_executor } from "@src/evals/parallel-conflict-executor.js";
import {
  clear_registry, register_bundle, get_bundle,
  load_bundle_datasets,
} from "@src/evals/bundles.js";
import { EvalRunner } from "@src/evals/runner.js";
import { EXACT_MATCH_SCORER } from "@src/evals/scorers.js";

const executor = create_parallel_conflict_executor();

// ── reconcile ─────────────────────────────────────────────────────

describe("parallel-conflict executor — reconcile", () => {
  it("majority_vote 전원 동의 → 문자열 직접 반환 (consensus 경로)", async () => {
    const result = await executor.execute(JSON.stringify({
      type: "reconcile",
      agent_results: [
        { agent_id: "a1", content: "answer-A" },
        { agent_id: "a2", content: "answer-A" },
        { agent_id: "a3", content: "answer-A" },
      ],
      policy: "majority_vote",
    }));
    expect(result.output).toBe("answer-A");
    expect(result.error).toBeUndefined();
  });

  it("majority_vote content 충돌 → {content} 객체 반환 (conflict_set 경로)", async () => {
    // content 충돌 시 conflict_set 경로를 타서 {content: winner} 객체 반환.
    // 이는 reconcile-policy의 의도된 동작 (parsed vs content 일관성).
    const result = await executor.execute(JSON.stringify({
      type: "reconcile",
      agent_results: [
        { agent_id: "a1", content: "answer-A" },
        { agent_id: "a2", content: "answer-A" },
        { agent_id: "a3", content: "answer-B" },
      ],
      policy: "majority_vote",
    }));
    expect(JSON.parse(result.output)).toMatchObject({ content: "answer-A" });
  });

  it("first_wins → 첫 번째 에이전트 content 반환", async () => {
    const result = await executor.execute(JSON.stringify({
      type: "reconcile",
      agent_results: [
        { agent_id: "a1", content: "first" },
        { agent_id: "a2", content: "second" },
      ],
      policy: "first_wins",
    }));
    expect(result.output).toBe("first");
  });

  it("last_wins → 마지막 에이전트 content 반환", async () => {
    const result = await executor.execute(JSON.stringify({
      type: "reconcile",
      agent_results: [
        { agent_id: "a1", content: "first" },
        { agent_id: "a2", content: "last" },
      ],
      policy: "last_wins",
    }));
    expect(result.output).toBe("last");
  });

  it("merge_union parsed → JSON 직렬화된 합집합 객체", async () => {
    const result = await executor.execute(JSON.stringify({
      type: "reconcile",
      agent_results: [
        { agent_id: "a1", content: null, parsed: { name: "Alice", age: 30 } },
        { agent_id: "a2", content: null, parsed: { name: "Alice", score: 95 } },
      ],
      policy: "merge_union",
      use_parsed: true,
    }));
    const parsed = JSON.parse(result.output);
    expect(parsed).toMatchObject({ name: "Alice", age: 30, score: 95 });
  });

  it("merge_union content (parsed 없음) → 배열로 합산", async () => {
    const result = await executor.execute(JSON.stringify({
      type: "reconcile",
      agent_results: [
        { agent_id: "a1", content: "part-one" },
        { agent_id: "a2", content: "part-two" },
      ],
      policy: "merge_union",
    }));
    expect(JSON.parse(result.output)).toEqual(["part-one", "part-two"]);
  });

  it("모든 에이전트 실패 → 'null' 반환", async () => {
    const result = await executor.execute(JSON.stringify({
      type: "reconcile",
      agent_results: [
        { agent_id: "a1", content: null, error: "timeout" },
        { agent_id: "a2", content: null, error: "oom" },
      ],
      policy: "first_wins",
    }));
    expect(result.output).toBe("null");
  });
});

// ── critic ────────────────────────────────────────────────────────

describe("parallel-conflict executor — critic", () => {
  it("조건 true → 'pass'", async () => {
    const result = await executor.execute(JSON.stringify({
      type: "critic",
      value: 10,
      condition: "value > 5",
    }));
    expect(result.output).toBe("pass");
  });

  it("조건 false → 'fail'", async () => {
    const result = await executor.execute(JSON.stringify({
      type: "critic",
      value: 3,
      condition: "value > 5",
    }));
    expect(result.output).toBe("fail");
  });

  it("조건 'rework' 반환 → 'rework'", async () => {
    const result = await executor.execute(JSON.stringify({
      type: "critic",
      value: "rework",
      condition: "value",
    }));
    expect(result.output).toBe("rework");
  });

  it("조건 평가 에러 → 'fail' (에러 경로)", async () => {
    const result = await executor.execute(JSON.stringify({
      type: "critic",
      value: null,
      condition: "undeclared_var.field",
    }));
    expect(result.output).toBe("fail");
  });
});

// ── read_model ───────────────────────────────────────────────────

describe("parallel-conflict executor — read_model", () => {
  it("has_failures: failed=0 → 'false'", async () => {
    const result = await executor.execute(JSON.stringify({
      type: "read_model",
      memory: { r1: { policy_applied: "first_wins", succeeded: 3, failed: 0 } },
      field: "has_failures",
    }));
    expect(result.output).toBe("false");
  });

  it("has_failures: failed>0 → 'true'", async () => {
    const result = await executor.execute(JSON.stringify({
      type: "read_model",
      memory: { r1: { policy_applied: "first_wins", succeeded: 1, failed: 2 } },
      field: "has_failures",
    }));
    expect(result.output).toBe("true");
  });

  it("total_conflicts: 복수 reconcile 노드 합산", async () => {
    const result = await executor.execute(JSON.stringify({
      type: "read_model",
      memory: {
        r1: { policy_applied: "majority_vote", succeeded: 2, failed: 0, conflicts: { fields: ["f1", "f2"] } },
        r2: { policy_applied: "first_wins",    succeeded: 1, failed: 0, conflicts: { fields: ["f3"] } },
      },
      field: "total_conflicts",
    }));
    expect(result.output).toBe("3");
  });

  it("unresolved_count: critic fail 수", async () => {
    const result = await executor.execute(JSON.stringify({
      type: "read_model",
      memory: {
        c1: { verdict: "fail", rounds_used: 2, passed: false },
        c2: { verdict: "pass", rounds_used: 1, passed: true },
      },
      field: "unresolved_count",
    }));
    expect(result.output).toBe("1");
  });

  it("__rounds_used 내부 추적 키 건너뜀 → critic_count 정확", async () => {
    const result = await executor.execute(JSON.stringify({
      type: "read_model",
      memory: {
        "c1__rounds_used": 3,
        c1: { verdict: "pass", rounds_used: 1, passed: true },
      },
      field: "critic_count",
    }));
    expect(result.output).toBe("1");
  });
});

// ── 에러 처리 ────────────────────────────────────────────────────

describe("parallel-conflict executor — error handling", () => {
  it("잘못된 JSON → error", async () => {
    const result = await executor.execute("not json");
    expect(result.error).toBeTruthy();
    expect(result.output).toBe("");
  });

  it("알 수 없는 type → error", async () => {
    const result = await executor.execute(JSON.stringify({ type: "unknown_type" }));
    expect(result.error).toContain("unknown type");
  });
});

// ── bundle + eval runner 통합 ─────────────────────────────────────

describe("parallel-conflict bundle", () => {
  beforeEach(() => { clear_registry(); });

  it("parallel-conflict 번들 등록 + 데이터셋 로드", () => {
    register_bundle({
      name: "parallel-conflict",
      description: "PAR-1~PAR-6: reconcile 파이프라인 + critic gate + read model 회귀 평가",
      dataset_files: ["tests/evals/cases/parallel-conflict.json"],
      smoke: true,
      tags: ["smoke"],
    });
    const bundle = get_bundle("parallel-conflict");
    expect(bundle).toBeTruthy();
    const datasets = load_bundle_datasets(bundle!);
    expect(datasets).toHaveLength(1);
    expect(datasets[0].name).toBe("parallel-conflict");
    expect(datasets[0].cases).toHaveLength(16);
  });

  it("eval runner 통합 — 전체 케이스 통과", async () => {
    register_bundle({
      name: "parallel-conflict",
      description: "PAR-1~PAR-6: reconcile 파이프라인 + critic gate + read model 회귀 평가",
      dataset_files: ["tests/evals/cases/parallel-conflict.json"],
      smoke: true,
    });
    const datasets = load_bundle_datasets(get_bundle("parallel-conflict")!);
    const runner = new EvalRunner(executor, EXACT_MATCH_SCORER);
    const summary = await runner.run_dataset(datasets[0]);
    expect(summary.total).toBe(16);
    expect(summary.passed).toBe(16);
    expect(summary.failed).toBe(0);
    expect(summary.error_count).toBe(0);
  });
});
