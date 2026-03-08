import { describe, it, expect } from "vitest";
import { hitl_handler } from "@src/agent/nodes/hitl.js";
import type { HITLNodeDefinition } from "@src/agent/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "@src/agent/orche-node-executor.js";

const createMockNode = (overrides?: Partial<HITLNodeDefinition>): HITLNodeDefinition => ({
  node_id: "hitl-1",
  label: "Test HITL",
  node_type: "hitl",
  message: "Awaiting input",
  ...overrides,
});

const createMockContext = (overrides?: Partial<OrcheNodeExecutorContext>): OrcheNodeExecutorContext => ({
  memory: { agent_id: "agent-1" },
  ...overrides,
});

describe("HITL Node Handler", () => {
  describe("metadata", () => {
    it("should have correct node_type", () => {
      expect(hitl_handler.node_type).toBe("hitl");
    });

    it("should have output_schema", () => {
      const schema = hitl_handler.output_schema || [];
      expect(schema.length).toBeGreaterThan(0);
    });
  });

  describe("execute", () => {
    it("should return valid output", async () => {
      const node = createMockNode();
      const ctx = createMockContext();
      const result = await hitl_handler.execute(node, ctx);
      expect(result.output).toBeDefined();
    });
  });

  describe("test", () => {
    it("should validate message", () => {
      const node = createMockNode({ message: "User approval needed" });
      const ctx = createMockContext();
      const result = hitl_handler.test(node, ctx);
      expect(result.preview).toBeDefined();
    });
  });
});
