import { describe, it, expect } from "vitest";
import { data_format_handler } from "../../../src/agent/nodes/data-format.js";
import type { OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("data_format_handler", () => {
  const createMockNode = (overrides?: Partial<any>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "data_format",
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be data_format", () => {
    expect(data_format_handler.node_type).toBe("data_format");
  });

  it("execute: should execute handler", async () => {
    const node = createMockNode();
    const ctx = createMockContext();
    const result = await data_format_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("test: preview should be defined", () => {
    const node = createMockNode();
    const result = data_format_handler.test(node);
    expect(result.preview).toBeDefined();
  });
});
