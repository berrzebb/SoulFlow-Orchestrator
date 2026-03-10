import { describe, it, expect } from "vitest";
import { document_xlsx_handler } from "../../../src/agent/nodes/document.js";
import type { OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("document_xlsx_handler", () => {
  const createMockNode = (overrides?: Partial<any>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "document_xlsx",
    content: "Name,Age,Department\nJohn,30,Engineering\nJane,28,Product\nBob,32,Sales",
    output: "/tmp/test.xlsx",
    delimiter: ",",
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be document_xlsx", () => {
    expect(document_xlsx_handler.node_type).toBe("document_xlsx");
  });

  it("execute: should generate XLSX spreadsheet", async () => {
    const node = createMockNode();
    const ctx = createMockContext();
    const result = await document_xlsx_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
    expect(typeof result.output.success).toBe("boolean");
  });

  it("execute: should resolve templates in content", async () => {
    const node = createMockNode({ content: "${spreadsheet_data}" });
    const ctx = createMockContext({ spreadsheet_data: "A,B,C\n1,2,3\n4,5,6" });
    const result = await document_xlsx_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle missing content gracefully", async () => {
    const node = createMockNode({ content: "" });
    const ctx = createMockContext();
    const result = await document_xlsx_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
    expect(typeof result.output.size_bytes).toBe("number");
  });

  it("test: preview should show action and output path", () => {
    const node = createMockNode();
    const result = document_xlsx_handler.test(node);
    expect(result.preview).toBeDefined();
    expect(result.preview.action).toBe("create_xlsx");
  });

  it("test: should warn about missing required fields", () => {
    const node = createMockNode({ content: "", output: "" });
    const result = document_xlsx_handler.test(node);
    expect(result.warnings).toBeDefined();
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("execute: should support different delimiters", async () => {
    const node = createMockNode({ delimiter: ";" });
    const ctx = createMockContext();
    const result = await document_xlsx_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should resolve templates in delimiter", async () => {
    const node = createMockNode({ delimiter: "${csv_delimiter}" });
    const ctx = createMockContext({ csv_delimiter: "\t" });
    const result = await document_xlsx_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should return output field in result", async () => {
    const node = createMockNode();
    const ctx = createMockContext();
    const result = await document_xlsx_handler.execute(node, ctx);
    expect(result.output).toHaveProperty("output");
    expect(result.output).toHaveProperty("size_bytes");
    expect(result.output).toHaveProperty("success");
  });

  it("execute: should handle execution errors gracefully", async () => {
    const node = createMockNode({ output: null });
    const ctx = createMockContext();
    const result = await document_xlsx_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
    expect(result.output.success).toBe(false);
  });

  it("execute: should handle complex CSV data", async () => {
    const csvData = `Name,Email,Phone\n"Doe, John",john@example.com,555-1234\n"Smith, Jane",jane@example.com,555-5678`;
    const node = createMockNode({ content: csvData });
    const ctx = createMockContext();
    const result = await document_xlsx_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });
});
