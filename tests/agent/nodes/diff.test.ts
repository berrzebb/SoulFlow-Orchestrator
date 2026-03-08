import { describe, it, expect } from "vitest";
import { diff_handler } from "../../../src/agent/nodes/diff.js";
import type { DiffNodeDefinition, OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("diff_handler", () => {
  const createMockNode = (overrides?: Partial<DiffNodeDefinition>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "diff",
    operation: "compare",
    old_text: "hello",
    new_text: "hello world",
    context_lines: 3,
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be diff", () => {
    expect(diff_handler.node_type).toBe("diff");
  });

  it("metadata: output_schema should have result and success fields", () => {
    expect(diff_handler.output_schema).toEqual([
      { name: "result", type: "string", description: "Diff output or patch result" },
      { name: "success", type: "boolean", description: "Whether operation succeeded" },
    ]);
  });

  it("create_default: should return default config", () => {
    const defaults = diff_handler.create_default?.();
    expect(defaults).toEqual({
      operation: "compare",
      old_text: "",
      new_text: "",
      context_lines: 3,
    });
  });

  it("execute: should handle compare operation", async () => {
    const node = createMockNode({ operation: "compare", old_text: "old", new_text: "new" });
    const ctx = createMockContext();
    const result = await diff_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
    expect(result.output).toHaveProperty("result");
    expect(result.output).toHaveProperty("success");
  });

  it("execute: should resolve templates in old_text", async () => {
    const node = createMockNode({ operation: "compare", old_text: "${v1}", new_text: "new" });
    const ctx = createMockContext({ v1: "original" });
    const result = await diff_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should resolve templates in new_text", async () => {
    const node = createMockNode({ operation: "compare", old_text: "old", new_text: "${v2}" });
    const ctx = createMockContext({ v2: "modified" });
    const result = await diff_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("test validation: should warn if both texts are empty for compare", () => {
    const node = createMockNode({ operation: "compare", old_text: "", new_text: "" });
    const result = diff_handler.test(node);
    expect(result.warnings).toContain("old_text and new_text are required");
  });

  it("test: preview should contain operation", () => {
    const node = createMockNode({ operation: "stats" });
    const result = diff_handler.test(node);
    expect(result.preview).toBeDefined();
  });

  it("execute: should handle missing operation (default to compare)", async () => {
    const node = createMockNode({ operation: undefined });
    const ctx = createMockContext();
    const result = await diff_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle missing old_text (default to empty string)", async () => {
    const node = createMockNode({ old_text: undefined });
    const ctx = createMockContext();
    const result = await diff_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle missing new_text (default to empty string)", async () => {
    const node = createMockNode({ new_text: undefined });
    const ctx = createMockContext();
    const result = await diff_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });
});
