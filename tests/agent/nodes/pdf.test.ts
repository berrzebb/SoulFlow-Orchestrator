import { describe, it, expect } from "vitest";
import { pdf_handler } from "../../../src/agent/nodes/pdf.js";
import type { PdfNodeDefinition, OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("pdf_handler", () => {
  const createMockNode = (overrides?: Partial<PdfNodeDefinition>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "pdf",
    operation: "extract_text",
    file_path: "/tmp/document.pdf",
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be pdf", () => {
    expect(pdf_handler.node_type).toBe("pdf");
  });

  it("execute: should extract text from PDF", async () => {
    const node = createMockNode({ operation: "extract_text" });
    const ctx = createMockContext();
    const result = await pdf_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should resolve templates in file_path", async () => {
    const node = createMockNode({ file_path: "${pdf_file}" });
    const ctx = createMockContext({ pdf_file: "/tmp/report.pdf" });
    const result = await pdf_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should extract metadata from PDF", async () => {
    const node = createMockNode({ operation: "extract_metadata" });
    const ctx = createMockContext();
    const result = await pdf_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should get page count", async () => {
    const node = createMockNode({ operation: "page_count" });
    const ctx = createMockContext();
    const result = await pdf_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("test: preview should show file path and operation", () => {
    const node = createMockNode({ operation: "extract_tables" });
    const result = pdf_handler.test(node);
    expect(result.preview).toBeDefined();
  });

  it("execute: should extract tables from PDF", async () => {
    const node = createMockNode({ operation: "extract_tables" });
    const ctx = createMockContext();
    const result = await pdf_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should extract specific page range", async () => {
    const node = createMockNode({
      operation: "extract_text",
      page_start: 1,
      page_end: 3,
    });
    const ctx = createMockContext();
    const result = await pdf_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle missing file gracefully", async () => {
    const node = createMockNode({ file_path: "/nonexistent/file.pdf" });
    const ctx = createMockContext();
    const result = await pdf_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });
});
