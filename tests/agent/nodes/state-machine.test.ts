import { describe, it, expect } from "vitest";
import { state_machine_handler } from "@src/agent/nodes/state-machine.js";
import type { StateMachineNodeDefinition } from "@src/agent/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "@src/agent/orche-node-executor.js";

const createMockNode = (overrides?: Partial<StateMachineNodeDefinition>): StateMachineNodeDefinition => ({
  node_id: "sm-1",
  label: "Test SM",
  node_type: "state_machine",
  states: [{ name: "start", transitions: [] }],
  ...overrides,
});

const createMockContext = (overrides?: Partial<OrcheNodeExecutorContext>): OrcheNodeExecutorContext => ({
  memory: { agent_id: "agent-1" },
  ...overrides,
});

describe("State Machine Node Handler", () => {
  describe("metadata", () => {
    it("should have correct node_type", () => {
      expect(state_machine_handler.node_type).toBe("state_machine");
    });

    it("should have output_schema", () => {
      const schema = state_machine_handler.output_schema || [];
      expect(schema.length).toBeGreaterThan(0);
    });
  });

  describe("execute", () => {
    it("should return valid output", async () => {
      const node = createMockNode();
      const ctx = createMockContext();
      const result = await state_machine_handler.execute(node, ctx);
      expect(result.output).toBeDefined();
    });
  });

  describe("test", () => {
    it("should validate config", () => {
      const node = createMockNode();
      const ctx = createMockContext();
      const result = state_machine_handler.test(node, ctx);
      expect(result.preview).toBeDefined();
    });
  });
});
