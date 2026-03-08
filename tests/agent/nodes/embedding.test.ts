import { describe, it, expect } from "vitest";
import { embedding_handler } from "@src/agent/nodes/embedding.js";
import type { OrcheNodeExecutorContext } from "@src/agent/orche-node-executor.js";

const createMockContext = (): OrcheNodeExecutorContext => ({
  memory: { agent_id: "agent-1" },
});

describe("Embedding Node Handler", () => {
  it("should have correct node_type", () => {
    expect(embedding_handler.node_type).toBe("embedding");
  });

  it("should have output_schema", () => {
    const schema = embedding_handler.output_schema || [];
    expect(schema.length).toBeGreaterThan(0);
  });

  it("should execute", async () => {
    const node = { node_id: "n-1", node_type: "embedding", label: "Test" };
    const ctx = createMockContext();
    const result = await embedding_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("should validate", () => {
    const node = { node_id: "n-1", node_type: "embedding" };
    const ctx = createMockContext();
    const result = embedding_handler.test(node, ctx);
    expect(result.preview).toBeDefined();
  });
});
