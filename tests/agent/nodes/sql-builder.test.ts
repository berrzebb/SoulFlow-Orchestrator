import { describe, it, expect } from "vitest";
import { sql_builder_handler } from "../../../src/agent/nodes/sql-builder.js";
import type { OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("sql_builder_handler", () => {
  const createMockNode = (overrides?: Partial<any>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "sql_builder",
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be sql_builder", () => {
    expect(sql_builder_handler.node_type).toBe("sql_builder");
  });

  it("execute: should execute handler", async () => {
    const node = createMockNode();
    const ctx = createMockContext();
    const result = await sql_builder_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("test: preview should be defined", () => {
    const node = createMockNode();
    const result = sql_builder_handler.test(node);
    expect(result.preview).toBeDefined();
  });
});
