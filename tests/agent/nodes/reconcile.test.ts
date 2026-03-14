/**
 * PAR-2: ReconcileNode 핸들러 통합 테스트.
 */

import { describe, it, expect } from "vitest";
import { reconcile_handler } from "../../../src/agent/nodes/reconcile.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/orche-node-executor.js";

function make_ctx(memory: Record<string, unknown>): OrcheNodeExecutorContext {
  return { memory, node_id: "test_ctx" } as OrcheNodeExecutorContext;
}

function make_node(overrides: Record<string, unknown>) {
  return {
    node_id: "reconcile_test",
    node_type: "reconcile" as const,
    title: "Test Reconcile",
    source_node_ids: [],
    policy: "majority_vote" as const,
    ...overrides,
  };
}

// ── execute — content 기반 ────────────────────────────────────────

describe("reconcile_handler.execute — content 기반", () => {
  it("majority_vote: 2/3 동일 → 해당 값 채택", async () => {
    const ctx = make_ctx({ n1: "answer", n2: "answer", n3: "other" });
    const node = make_node({ source_node_ids: ["n1", "n2", "n3"], policy: "majority_vote" });
    const result = await reconcile_handler.execute(node as never, ctx);
    expect(result.output["reconciled"]).toBe("answer");
    expect(result.output["policy_applied"]).toBe("majority_vote");
    expect(result.output["succeeded"]).toBe(3);
  });

  it("first_wins: 첫 번째 성공 값 반환", async () => {
    const ctx = make_ctx({ n1: "first", n2: "second" });
    const node = make_node({ source_node_ids: ["n1", "n2"], policy: "first_wins" });
    const result = await reconcile_handler.execute(node as never, ctx);
    expect(result.output["reconciled"]).toBe("first");
  });

  it("last_wins: 마지막 성공 값 반환", async () => {
    const ctx = make_ctx({ n1: "first", n2: "last" });
    const node = make_node({ source_node_ids: ["n1", "n2"], policy: "last_wins" });
    const result = await reconcile_handler.execute(node as never, ctx);
    expect(result.output["reconciled"]).toBe("last");
  });

  it("소스 노드 데이터 없음 → failed 계수", async () => {
    const ctx = make_ctx({ n1: "ok" });
    const node = make_node({ source_node_ids: ["n1", "n2_missing"], policy: "first_wins" });
    const result = await reconcile_handler.execute(node as never, ctx);
    expect(result.output["failed"]).toBe(1);
    expect(result.output["succeeded"]).toBe(1);
    expect(result.output["reconciled"]).toBe("ok");
  });
});

// ── execute — parsed 기반 ─────────────────────────────────────────

describe("reconcile_handler.execute — parsed 기반 (use_parsed=true)", () => {
  it("parsed 객체 필드 합의 → conflicts 포함", async () => {
    const ctx = make_ctx({
      n1: { content: "x", parsed: { category: "tech", score: 0.9 } },
      n2: { content: "y", parsed: { category: "tech", score: 0.9 } },
      n3: { content: "z", parsed: { category: "science", score: 0.9 } },
    });
    const node = make_node({
      source_node_ids: ["n1", "n2", "n3"],
      policy: "majority_vote",
      use_parsed: true,
    });
    const result = await reconcile_handler.execute(node as never, ctx);
    const reconciled = result.output["reconciled"] as Record<string, unknown>;
    // score는 합의 → 합의 값
    expect(reconciled["score"]).toBe(0.9);
    // category는 충돌 → majority_vote로 "tech" 채택
    expect(reconciled["category"]).toBe("tech");
  });

  it("merge_union: parsed 필드 합집합", async () => {
    const ctx = make_ctx({
      n1: { content: "x", parsed: { name: "Alice", role: "admin" } },
      n2: { content: "y", parsed: { name: "Alice", score: 0.9 } },
    });
    const node = make_node({
      source_node_ids: ["n1", "n2"],
      policy: "merge_union",
      use_parsed: true,
    });
    const result = await reconcile_handler.execute(node as never, ctx);
    const reconciled = result.output["reconciled"] as Record<string, unknown>;
    expect(reconciled["name"]).toBe("Alice");
    expect(reconciled["role"]).toBe("admin");
    expect(reconciled["score"]).toBe(0.9);
  });
});

// ── test ─────────────────────────────────────────────────────────

describe("reconcile_handler.test", () => {
  it("source_node_ids가 비어있으면 경고", () => {
    const ctx = make_ctx({});
    const node = make_node({ source_node_ids: [] });
    const result = reconcile_handler.test!(node as never, ctx);
    expect(result.warnings).toContain("source_node_ids is empty");
  });

  it("upstream 데이터 없으면 경고", () => {
    const ctx = make_ctx({}); // n1, n2 없음
    const node = make_node({ source_node_ids: ["n1", "n2"] });
    const result = reconcile_handler.test!(node as never, ctx);
    expect(result.warnings.some((w: string) => w.includes("n1"))).toBe(true);
  });

  it("모든 데이터 존재 → 경고 없음", () => {
    const ctx = make_ctx({ n1: "ok", n2: "ok" });
    const node = make_node({ source_node_ids: ["n1", "n2"] });
    const result = reconcile_handler.test!(node as never, ctx);
    expect(result.warnings).toHaveLength(0);
  });
});
