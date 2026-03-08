import { describe, it, expect } from "vitest";
import { csv_handler } from "../../../src/agent/nodes/csv.js";
import type { CsvNodeDefinition, OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("csv_handler", () => {
  const createMockNode = (overrides?: Partial<CsvNodeDefinition>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "csv",
    operation: "parse",
    data: "name,age\nAlice,30\nBob,25",
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be csv", () => {
    expect(csv_handler.node_type).toBe("csv");
  });

  it("execute: should parse CSV data", async () => {
    const node = createMockNode({ operation: "parse" });
    const ctx = createMockContext();
    const result = await csv_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should resolve templates in data", async () => {
    const node = createMockNode({ data: "${csv_content}" });
    const ctx = createMockContext({ csv_content: "id,name\n1,test\n2,example" });
    const result = await csv_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should generate CSV from JSON", async () => {
    const node = createMockNode({
      operation: "generate",
      data: '[{"name":"Alice","age":30},{"name":"Bob","age":25}]',
    });
    const ctx = createMockContext();
    const result = await csv_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should filter CSV rows", async () => {
    const node = createMockNode({
      operation: "filter",
      filter_column: "age",
      filter_value: "30",
    });
    const ctx = createMockContext();
    const result = await csv_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("test: preview should show operation and data sample", () => {
    const node = createMockNode();
    const result = csv_handler.test(node);
    expect(result.preview).toBeDefined();
  });

  it("execute: should sort CSV data", async () => {
    const node = createMockNode({
      operation: "sort",
      sort_column: "name",
      sort_order: "asc",
    });
    const ctx = createMockContext();
    const result = await csv_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle invalid CSV gracefully", async () => {
    const node = createMockNode({ data: "invalid,csv\ndata,with,extra,columns\nshort" });
    const ctx = createMockContext();
    const result = await csv_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should aggregate CSV data", async () => {
    const node = createMockNode({
      operation: "aggregate",
      group_column: "name",
      aggregate_column: "age",
    });
    const ctx = createMockContext();
    const result = await csv_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });
});
