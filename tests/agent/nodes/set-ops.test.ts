import { describe, it, expect } from "vitest";
import { set_ops_handler } from "../../../src/agent/nodes/set-ops.js";
import type { SetOpsNodeDefinition, OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("set_ops_handler", () => {
  const createMockNode = (overrides?: Partial<SetOpsNodeDefinition>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "set_ops",
    operation: "union",
    a: "[1,2,3]",
    b: "[3,4,5]",
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be set_ops", () => {
    expect(set_ops_handler.node_type).toBe("set_ops");
  });

  it("metadata: output_schema should have result and success", () => {
    expect(set_ops_handler.output_schema).toEqual([
      { name: "result", type: "string", description: "Set operation result" },
      { name: "success", type: "boolean", description: "Whether operation succeeded" },
    ]);
  });

  it("create_default: should return default config", () => {
    const defaults = set_ops_handler.create_default?.();
    expect(defaults).toEqual({ operation: "union", a: "", b: "" });
  });

  it("execute: should handle union operation", async () => {
    const node = createMockNode({ operation: "union", a: "[1,2]", b: "[2,3]" });
    const ctx = createMockContext();
    const result = await set_ops_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
    expect(result.output).toHaveProperty("result");
    expect(result.output).toHaveProperty("success");
  });

  it("execute: should resolve templates in a", async () => {
    const node = createMockNode({ operation: "intersection", a: "${set_a}" });
    const ctx = createMockContext({ set_a: "[1,2,3]" });
    const result = await set_ops_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("test validation: should warn if set a is missing", () => {
    const node = createMockNode({ a: undefined });
    const result = set_ops_handler.test(node);
    expect(result.warnings).toContain("set 'a' is required");
  });

  it("test validation: should warn if set b missing for non-power_set operations", () => {
    const node = createMockNode({ operation: "union", b: undefined });
    const result = set_ops_handler.test(node);
    expect(result.warnings).toContain("set 'b' is required for this operation");
  });

  it("test validation: should not warn if set b missing for power_set", () => {
    const node = createMockNode({ operation: "power_set", a: "[1,2]", b: undefined });
    const result = set_ops_handler.test(node);
    expect(result.warnings.length).toBe(0);
  });

  it("test: preview should contain operation", () => {
    const node = createMockNode({ operation: "difference" });
    const result = set_ops_handler.test(node);
    expect(result.preview).toEqual({ operation: "difference" });
  });

  it("execute: should handle intersection operation", async () => {
    const node = createMockNode({ operation: "intersection" });
    const ctx = createMockContext();
    const result = await set_ops_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });
});
