import { describe, it, expect } from "vitest";
import { queue_handler } from "@src/agent/nodes/queue.js";
import type { OrcheNodeExecutorContext } from "@src/agent/orche-node-executor.js";

describe("${h^} Node Handler", () => {
  it("should have node_type", () => {
    const ctx: OrcheNodeExecutorContext = { memory: {} };
    const node = { node_id: "n", node_type: "queue", label: "Test" };
    expect(queue_handler.node_type).toBe("queue");
  });

  it("should have output_schema", () => {
    const schema = queue_handler.output_schema || [];
    expect(schema.length).toBeGreaterThan(0);
  });

  it("should execute", async () => {
    const ctx: OrcheNodeExecutorContext = { memory: {} };
    const node = { node_id: "n", node_type: "queue" };
    const result = await queue_handler.execute(node, ctx);
    expect(result).toBeDefined();
  });

  it("should validate", () => {
    const ctx: OrcheNodeExecutorContext = { memory: {} };
    const node = { node_id: "n", node_type: "queue" };
    const result = queue_handler.test(node, ctx);
    expect(result.preview).toBeDefined();
  });
});
