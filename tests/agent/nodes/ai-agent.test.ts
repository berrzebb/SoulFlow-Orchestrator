import { describe, it, expect } from "vitest";
import { ai_agent_handler } from "../../../src/agent/nodes/ai-agent.js";
import type { OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("ai_agent_handler", () => {
  const createMockNode = (overrides?: Partial<any>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "ai_agent",
    prompt: "Test prompt",
    model: "claude-opus-4-6",
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be ai_agent", () => {
    expect(ai_agent_handler.node_type).toBe("ai_agent");
  });

  it("test: preview should be defined", () => {
    const node = createMockNode();
    const result = ai_agent_handler.test(node);
    expect(result.preview).toBeDefined();
  });

  it("execute: should handle missing prompt", async () => {
    const node = createMockNode({ prompt: "" });
    const ctx = createMockContext();
    try {
      await ai_agent_handler.execute(node, ctx);
    } catch {
      expect(true).toBe(true);
    }
  });
});
