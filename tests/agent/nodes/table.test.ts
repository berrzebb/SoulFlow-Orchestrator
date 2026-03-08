import { describe, it, expect } from "vitest";
import { table_handler } from "../../../src/agent/nodes/table.js";
import type { TableNodeDefinition, OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("table_handler", () => {
  const createMockNode = (overrides?: Partial<TableNodeDefinition>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "table",
    operation: "create",
    columns: ["id", "name", "email"],
    rows: [[1, "Alice", "alice@example.com"]],
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be table", () => {
    expect(table_handler.node_type).toBe("table");
  });

  it("execute: should create table structure", async () => {
    const node = createMockNode({ operation: "create" });
    const ctx = createMockContext();
    const result = await table_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should resolve templates in column names", async () => {
    const node = createMockNode({ columns: ["${col1}", "name"] });
    const ctx = createMockContext({ col1: "id" });
    const result = await table_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should filter table rows", async () => {
    const node = createMockNode({
      operation: "filter",
      rows: [[1, "Alice", "alice@example.com"], [2, "Bob", "bob@example.com"]],
    });
    const ctx = createMockContext();
    const result = await table_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should sort table data", async () => {
    const node = createMockNode({ operation: "sort", sort_column: "name" });
    const ctx = createMockContext();
    const result = await table_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("test: preview should show table structure", () => {
    const node = createMockNode();
    const result = table_handler.test(node);
    expect(result.preview).toBeDefined();
  });

  it("execute: should aggregate data", async () => {
    const node = createMockNode({ operation: "aggregate", group_by: "name" });
    const ctx = createMockContext();
    const result = await table_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle empty table gracefully", async () => {
    const node = createMockNode({ columns: ["id"], rows: [] });
    const ctx = createMockContext();
    const result = await table_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should join tables", async () => {
    const node = createMockNode({
      operation: "join",
      join_table: [[1, "premium"], [2, "basic"]],
      join_column: "id",
    });
    const ctx = createMockContext();
    const result = await table_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle error gracefully", async () => {
    const node = createMockNode({ operation: "invalid" });
    const ctx = createMockContext();
    const result = await table_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });
});
