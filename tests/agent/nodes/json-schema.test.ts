import { describe, it, expect } from "vitest";
import { json_schema_handler } from "../../../src/agent/nodes/json-schema.js";
import type { OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("json_schema_handler", () => {
  const createMockNode = (overrides?: Partial<any>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "json_schema",
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be json_schema", () => {
    expect(json_schema_handler.node_type).toBe("json_schema");
  });

  it("execute: should execute handler", async () => {
    const node = createMockNode();
    const ctx = createMockContext();
    const result = await json_schema_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("test: preview should be defined", () => {
    const node = createMockNode();
    const result = json_schema_handler.test(node);
    expect(result.preview).toBeDefined();
  });
});
