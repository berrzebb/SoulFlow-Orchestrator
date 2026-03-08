import { describe, it, expect } from "vitest";
import { tool_invoke_handler } from "../../../src/agent/nodes/tool-invoke.js";
import type { OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("tool_invoke_handler", () => {
  const createMockNode = (overrides?: Partial<any>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "tool_invoke",
    tool_id: "test-tool",
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be tool_invoke", () => {
    expect(tool_invoke_handler.node_type).toBe("tool_invoke");
  });

  it("execute: should invoke tool", async () => {
    const node = createMockNode();
    const ctx = createMockContext();
    const result = await tool_invoke_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("test: preview should be defined with context", () => {
    const node = createMockNode({ tool_id: "my-tool" });
    const ctx = createMockContext();
    const result = tool_invoke_handler.test(node, ctx);
    expect(result.preview).toBeDefined();
  });
});
