import { describe, it, expect } from "vitest";
import { eval_handler } from "../../../src/agent/nodes/eval.js";
import type { EvalNodeDefinition, OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("eval_handler", () => {
  const createMockNode = (overrides?: Partial<EvalNodeDefinition>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "eval",
    code: "1 + 1",
    context: "",
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be eval", () => {
    expect(eval_handler.node_type).toBe("eval");
  });

  it("metadata: output_schema should have result and success fields", () => {
    expect(eval_handler.output_schema).toEqual([
      { name: "result", type: "string", description: "Evaluation result" },
      { name: "success", type: "boolean", description: "Whether evaluation succeeded" },
    ]);
  });

  it("metadata: input_schema should have code and context fields", () => {
    expect(eval_handler.input_schema).toEqual([
      { name: "code", type: "string", description: "JavaScript code to evaluate" },
      { name: "context", type: "string", description: "JSON context variables" },
    ]);
  });

  it("create_default: should return default config", () => {
    const defaults = eval_handler.create_default?.();
    expect(defaults).toEqual({ code: "", context: "" });
  });

  it("execute: should evaluate simple JavaScript", async () => {
    const node = createMockNode({ code: "2 + 2", context: "" });
    const ctx = createMockContext();
    const result = await eval_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
    expect(result.output.success).toBe(true);
  });

  it("execute: should resolve templates in code", async () => {
    const node = createMockNode({ code: "${a} + ${b}", context: "" });
    const ctx = createMockContext({ a: 5, b: 3 });
    const result = await eval_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle evaluation errors", async () => {
    const node = createMockNode({ code: "throw new Error('test')", context: "" });
    const ctx = createMockContext();
    const result = await eval_handler.execute(node, ctx);
    expect(result.output.success).toBe(false);
    expect(result.output.result).toContain("Error:");
  });

  it("test validation: should warn if code is empty", () => {
    const node = createMockNode({ code: "", context: "" });
    const result = eval_handler.test(node);
    expect(result.warnings).toContain("code is required");
  });

  it("test validation: should warn if code is only whitespace", () => {
    const node = createMockNode({ code: "   ", context: "" });
    const result = eval_handler.test(node);
    expect(result.warnings).toContain("code is required");
  });

  it("test: preview should show first 80 chars of code", () => {
    const longCode = "x".repeat(100);
    const node = createMockNode({ code: longCode });
    const result = eval_handler.test(node);
    expect(result.preview.code).toBe("x".repeat(80));
  });

  it("test: preview should show full code if less than 80 chars", () => {
    const code = "const x = 1; return x;";
    const node = createMockNode({ code });
    const result = eval_handler.test(node);
    expect(result.preview.code).toBe(code);
  });

  it("execute: should handle missing code (default to empty string)", async () => {
    const node = createMockNode({ code: undefined });
    const ctx = createMockContext();
    const result = await eval_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle missing context (default to empty string)", async () => {
    const node = createMockNode({ code: "1 + 1", context: undefined });
    const ctx = createMockContext();
    const result = await eval_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });
});
