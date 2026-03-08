import { describe, it, expect } from "vitest";
import { tokenizer_handler } from "@src/agent/nodes/tokenizer.js";
import type { OrcheNodeExecutorContext } from "@src/agent/orche-node-executor.js";

const createMockContext = (): OrcheNodeExecutorContext => ({
  memory: { agent_id: "agent-1" },
});

describe("Tokenizer Node Handler", () => {
  it("should have correct node_type", () => {
    expect(tokenizer_handler.node_type).toBe("tokenizer");
  });

  it("should have output_schema", () => {
    const schema = tokenizer_handler.output_schema || [];
    expect(schema.length).toBeGreaterThan(0);
  });

  it("should execute", async () => {
    const node = { node_id: "n-1", node_type: "tokenizer", label: "Test" };
    const ctx = createMockContext();
    const result = await tokenizer_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("should validate", () => {
    const node = { node_id: "n-1", node_type: "tokenizer" };
    const ctx = createMockContext();
    const result = tokenizer_handler.test(node, ctx);
    expect(result.preview).toBeDefined();
  });
});
