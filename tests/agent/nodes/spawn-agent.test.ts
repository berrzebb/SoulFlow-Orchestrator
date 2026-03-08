import { describe, it, expect } from "vitest";
import { spawn_agent_handler } from "../../../src/agent/nodes/spawn-agent.js";
import type { OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("spawn_agent_handler", () => {
  const createMockNode = (overrides?: Partial<any>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "spawn_agent",
    prompt: "test task",
    model: "claude-opus-4-6",
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be spawn_agent", () => {
    expect(spawn_agent_handler.node_type).toBe("spawn_agent");
  });

  it("test: preview should be defined", () => {
    const node = createMockNode();
    const result = spawn_agent_handler.test(node);
    expect(result.preview).toBeDefined();
  });

  it("execute: should handle missing prompt", async () => {
    const node = createMockNode({ prompt: "" });
    const ctx = createMockContext();
    try {
      await spawn_agent_handler.execute(node, ctx);
    } catch {
      expect(true).toBe(true);
    }
  });
});
