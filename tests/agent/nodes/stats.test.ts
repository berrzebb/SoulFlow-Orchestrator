import { describe, it, expect } from "vitest";
import { stats_handler } from "@src/agent/nodes/stats.js";
import type { OrcheNodeExecutorContext } from "@src/agent/orche-node-executor.js";

describe("${h^} Node Handler", () => {
  it("should have node_type", () => {
    const ctx: OrcheNodeExecutorContext = { memory: {} };
    const node = { node_id: "n", node_type: "stats", label: "Test" };
    expect(stats_handler.node_type).toBe("stats");
  });

  it("should have output_schema", () => {
    const schema = stats_handler.output_schema || [];
    expect(schema.length).toBeGreaterThan(0);
  });

  it("should execute", async () => {
    const ctx: OrcheNodeExecutorContext = { memory: {} };
    const node = { node_id: "n", node_type: "stats" };
    const result = await stats_handler.execute(node, ctx);
    expect(result).toBeDefined();
  });

  it("should validate", () => {
    const ctx: OrcheNodeExecutorContext = { memory: {} };
    const node = { node_id: "n", node_type: "stats" };
    const result = stats_handler.test(node, ctx);
    expect(result.preview).toBeDefined();
  });
});
