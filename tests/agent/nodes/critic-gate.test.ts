/**
 * PAR-3: CriticGateNode 핸들러 통합 테스트.
 */

import { describe, it, expect } from "vitest";
import { critic_gate_handler } from "../../../src/agent/nodes/critic-gate.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/orche-node-executor.js";

function make_ctx(memory: Record<string, unknown>): OrcheNodeExecutorContext {
  return { memory, node_id: "test_ctx" } as OrcheNodeExecutorContext;
}

function make_node(overrides: Record<string, unknown>) {
  return {
    node_id: "critic_test",
    node_type: "critic_gate" as const,
    title: "Test CriticGate",
    source_node_id: "reconcile_out",
    condition: "value !== null && value !== undefined",
    max_rounds: 2,
    ...overrides,
  };
}

// ── execute — pass / fail ─────────────────────────────────────────

describe("critic_gate_handler.execute — pass/fail", () => {
  it("조건 충족 → verdict:pass, passed:true", async () => {
    const ctx = make_ctx({ reconcile_out: { score: 0.9 } });
    const node = make_node({ condition: "value.score > 0.5" });
    const result = await critic_gate_handler.execute(node as never, ctx);
    expect(result.output["verdict"]).toBe("pass");
    expect(result.output["passed"]).toBe(true);
    expect(result.output["rounds_used"]).toBe(1);
  });

  it("조건 미충족 → verdict:fail, passed:false", async () => {
    const ctx = make_ctx({ reconcile_out: { score: 0.1 } });
    const node = make_node({ condition: "value.score > 0.5" });
    const result = await critic_gate_handler.execute(node as never, ctx);
    expect(result.output["verdict"]).toBe("fail");
    expect(result.output["passed"]).toBe(false);
  });

  it("소스 노드 데이터 없음 (null) → fail", async () => {
    const ctx = make_ctx({});
    const node = make_node({ condition: "value !== null && value !== undefined" });
    const result = await critic_gate_handler.execute(node as never, ctx);
    expect(result.output["verdict"]).toBe("fail");
  });

  it('"rework" 반환 조건 → verdict:rework + rework_instruction', async () => {
    const ctx = make_ctx({ reconcile_out: "partial" });
    const node = make_node({ condition: '"rework"', rework_instruction: "Please retry" });
    const result = await critic_gate_handler.execute(node as never, ctx);
    expect(result.output["verdict"]).toBe("rework");
    expect(result.output["rework_instruction"]).toBeTruthy();
  });
});

// ── execute — rounds_used 누적 ────────────────────────────────────

describe("critic_gate_handler.execute — rounds_used budget", () => {
  it("첫 실행: rounds_used=1, memory에 기록됨", async () => {
    const ctx = make_ctx({ reconcile_out: null });
    const node = make_node({ condition: '"rework"', max_rounds: 2 });
    const result = await critic_gate_handler.execute(node as never, ctx);
    expect(result.output["rounds_used"]).toBe(1);
    expect(ctx.memory["critic_test__rounds_used"]).toBe(1);
  });

  it("두 번째 rework 실행: rounds_used=2", async () => {
    const ctx = make_ctx({ reconcile_out: null, "critic_test__rounds_used": 1 });
    const node = make_node({ condition: '"rework"', max_rounds: 2 });
    const result = await critic_gate_handler.execute(node as never, ctx);
    expect(result.output["rounds_used"]).toBe(2);
  });

  it("max_rounds 초과 → fail로 강제 전환", async () => {
    const ctx = make_ctx({ reconcile_out: null, "critic_test__rounds_used": 2 });
    const node = make_node({ condition: '"rework"', max_rounds: 2 });
    const result = await critic_gate_handler.execute(node as never, ctx);
    expect(result.output["verdict"]).toBe("fail");
    expect(result.output["reason"]).toMatch(/exhausted/);
  });

  it("pass 후 rounds_used 초기화 (memory 키 0)", async () => {
    const ctx = make_ctx({ reconcile_out: "ok", "critic_test__rounds_used": 1 });
    const node = make_node({ condition: "value === 'ok'" });
    await critic_gate_handler.execute(node as never, ctx);
    expect(ctx.memory["critic_test__rounds_used"]).toBe(0);
  });
});

// ── test() ────────────────────────────────────────────────────────

describe("critic_gate_handler.test", () => {
  it("source_node_id 비어있으면 경고", () => {
    const ctx = make_ctx({});
    const node = make_node({ source_node_id: "" });
    const result = critic_gate_handler.test!(node as never, ctx);
    expect(result.warnings).toContain("source_node_id is required");
  });

  it("condition 비어있으면 경고", () => {
    const ctx = make_ctx({ reconcile_out: "x" });
    const node = make_node({ condition: "" });
    const result = critic_gate_handler.test!(node as never, ctx);
    expect(result.warnings).toContain("condition expression is required");
  });

  it("upstream 데이터 없으면 경고", () => {
    const ctx = make_ctx({});
    const node = make_node({ source_node_id: "reconcile_out" });
    const result = critic_gate_handler.test!(node as never, ctx);
    expect(result.warnings.some((w: string) => w.includes("reconcile_out"))).toBe(true);
  });

  it("모든 데이터 존재 → 경고 없음", () => {
    const ctx = make_ctx({ reconcile_out: "ok" });
    const node = make_node({});
    const result = critic_gate_handler.test!(node as never, ctx);
    expect(result.warnings).toHaveLength(0);
  });
});
