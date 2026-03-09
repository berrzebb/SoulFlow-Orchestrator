/**
 * 노드 핸들러 execute() catch 블록 커버리지.
 * 도구 모듈을 mock해서 throw → catch 경로 실행.
 */
import { describe, it, expect, vi } from "vitest";
import type { OrcheNodeDefinition } from "@src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "@src/agent/nodes/orche-node-executor.js";

// ── 공통 mock 컨텍스트 ──────────────────────────────────────

const ctx: OrcheNodeExecutorContext = {
  memory: {},
  workspace: "/tmp",
  abort_signal: undefined,
};

function bare(node_type: string, overrides: Record<string, unknown> = {}): OrcheNodeDefinition {
  return { node_id: "x", node_type, ...overrides } as OrcheNodeDefinition;
}

// ══════════════════════════════════════════════════════════
// circuit_breaker — CircuitBreakerTool mock throw
// ══════════════════════════════════════════════════════════

vi.mock("@src/agent/tools/circuit-breaker.js", () => ({
  CircuitBreakerTool: class {
    execute() { throw new Error("mock circuit breaker error"); }
  },
}));

describe("circuit_breaker_handler — execute() catch 분기", () => {
  it("CircuitBreakerTool throws → catch → {state:'unknown', result:null}", async () => {
    const { circuit_breaker_handler } = await import("@src/agent/nodes/circuit-breaker.js");
    const result = await circuit_breaker_handler.execute(
      bare("circuit_breaker", { action: "get_state", name: "x" }),
      ctx,
    );
    expect(result.output).toMatchObject({ state: "unknown", result: null });
  });
});
