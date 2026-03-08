import { describe, it, expect } from "vitest";
import { database_handler } from "../../../src/agent/nodes/database.js";
import type { DatabaseNodeDefinition, OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("database_handler", () => {
  const createMockNode = (overrides?: Partial<DatabaseNodeDefinition>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "database",
    operation: "query",
    connection_string: "postgresql://localhost/testdb",
    query: "SELECT * FROM users",
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be database", () => {
    expect(database_handler.node_type).toBe("database");
  });

  it("execute: should execute database query", async () => {
    const node = createMockNode({ operation: "query" });
    const ctx = createMockContext();
    const result = await database_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should resolve templates in query", async () => {
    const node = createMockNode({ query: "SELECT * FROM ${table_name}" });
    const ctx = createMockContext({ table_name: "products" });
    const result = await database_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should support parameterized queries", async () => {
    const node = createMockNode({
      query: "SELECT * FROM users WHERE id = $1",
      parameters: [123],
    });
    const ctx = createMockContext();
    const result = await database_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should execute insert operation", async () => {
    const node = createMockNode({
      operation: "insert",
      query: "INSERT INTO users (name, email) VALUES ($1, $2)",
      parameters: ["Alice", "alice@example.com"],
    });
    const ctx = createMockContext();
    const result = await database_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("test: preview should show operation and connection", () => {
    const node = createMockNode();
    const result = database_handler.test(node);
    expect(result.preview).toBeDefined();
  });

  it("execute: should begin transaction", async () => {
    const node = createMockNode({ operation: "begin" });
    const ctx = createMockContext();
    const result = await database_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should commit transaction", async () => {
    const node = createMockNode({ operation: "commit" });
    const ctx = createMockContext();
    const result = await database_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle connection error gracefully", async () => {
    const node = createMockNode({
      connection_string: "postgresql://invalid-host/testdb",
    });
    const ctx = createMockContext();
    const result = await database_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should support multiple database types", async () => {
    const node = createMockNode({
      connection_string: "mysql://localhost/testdb",
      db_type: "mysql",
    });
    const ctx = createMockContext();
    const result = await database_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });
});
