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

// ── throwing ctx helper ──────────────────────────────────────────────────────

/** ctx.memory getter가 throw → try 블록 내 tpl 생성 시 즉시 예외 */
function make_throwing_ctx(): OrcheNodeExecutorContext {
  return { get memory(): never { throw new Error("forced ctx error"); } } as any;
}

// ══════════════════════════════════════════════════════════
// compress — L40 catch
// ══════════════════════════════════════════════════════════

describe("compress_handler — L40: execute catch", () => {
  it("ctx.memory throw → catch → { success: false }", async () => {
    const { compress_handler } = await import("@src/agent/nodes/compress.js");
    const result = await compress_handler.execute(bare("compress", { operation: "compress", input: "", input_path: "" }), make_throwing_ctx());
    expect(result.output.success).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════
// email — L45 catch
// ══════════════════════════════════════════════════════════

describe("email_handler — L45: execute catch", () => {
  it("ctx.memory throw → catch → { message_id: '', success: false }", async () => {
    const { email_handler } = await import("@src/agent/nodes/email.js");
    const result = await email_handler.execute(bare("email", { action: "send", to: "", subject: "", body: "" }), make_throwing_ctx());
    expect(result.output.success).toBe(false);
    expect(result.output.message_id).toBe("");
  });
});

// ══════════════════════════════════════════════════════════
// matrix — L37 catch
// ══════════════════════════════════════════════════════════

describe("matrix_handler — L37: execute catch", () => {
  it("ctx.memory throw → catch → { result: null }", async () => {
    const { matrix_handler } = await import("@src/agent/nodes/matrix.js");
    const result = await matrix_handler.execute(bare("matrix", { action: "multiply" }), make_throwing_ctx());
    expect(result.output.result).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════
// similarity — L39 catch
// ══════════════════════════════════════════════════════════

describe("similarity_handler — L39: execute catch", () => {
  it("ctx.memory throw → catch → { score: 0, result: null }", async () => {
    const { similarity_handler } = await import("@src/agent/nodes/similarity.js");
    const result = await similarity_handler.execute(bare("similarity", { action: "cosine", a: "hi", b: "hi" }), make_throwing_ctx());
    expect(result.output.score).toBe(0);
    expect(result.output.result).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════
// secret_read — L34 catch
// ══════════════════════════════════════════════════════════

describe("secret_read_handler — L34: execute catch", () => {
  it("ctx.memory throw → catch → { value: '', success: false }", async () => {
    const { secret_read_handler } = await import("@src/agent/nodes/secret-read.js");
    // template 참조가 있을 때 ctx.memory에 접근함
    const result = await secret_read_handler.execute(bare("secret_read", { key: "{{memory.x}}", namespace: "" }), make_throwing_ctx());
    expect(result.output.success).toBe(false);
    expect(result.output.value).toBe("");
  });
});

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
