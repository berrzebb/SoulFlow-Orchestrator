import { describe, it, expect } from "vitest";
import { math_handler } from "@src/agent/nodes/math.js";
import type { OrcheNodeExecutorContext } from "@src/agent/orche-node-executor.js";

describe("${h^} Node Handler", () => {
  it("should have node_type", () => {
    const ctx: OrcheNodeExecutorContext = { memory: {} };
    const node = { node_id: "n", node_type: "math", label: "Test" };
    expect(math_handler.node_type).toBe("math");
  });

  it("should have output_schema", () => {
    const schema = math_handler.output_schema || [];
    expect(schema.length).toBeGreaterThan(0);
  });

  it("should execute", async () => {
    const ctx: OrcheNodeExecutorContext = { memory: {} };
    const node = { node_id: "n", node_type: "math" };
    const result = await math_handler.execute(node, ctx);
    expect(result).toBeDefined();
  });

  it("should validate", () => {
    const ctx: OrcheNodeExecutorContext = { memory: {} };
    const node = { node_id: "n", node_type: "math" };
    const result = math_handler.test(node, ctx);
    expect(result.preview).toBeDefined();
  });
});
