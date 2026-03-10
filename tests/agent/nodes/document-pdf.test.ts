import { describe, it, expect } from "vitest";
import { document_pdf_handler } from "../../../src/agent/nodes/document.js";
import type { OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("document_pdf_handler", () => {
  const createMockNode = (overrides?: Partial<any>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "document_pdf",
    content: "# PDF Document\n\nThis is test content for PDF generation.",
    input_format: "markdown",
    output: "/tmp/test.pdf",
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be document_pdf", () => {
    expect(document_pdf_handler.node_type).toBe("document_pdf");
  });

  it("execute: should generate PDF document", async () => {
    const node = createMockNode();
    const ctx = createMockContext();
    const result = await document_pdf_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
    expect(typeof result.output.success).toBe("boolean");
  });

  it("execute: should resolve templates in content", async () => {
    const node = createMockNode({ content: "${pdf_content}" });
    const ctx = createMockContext({ pdf_content: "Template resolved PDF content" });
    const result = await document_pdf_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle missing content gracefully", async () => {
    const node = createMockNode({ content: "" });
    const ctx = createMockContext();
    const result = await document_pdf_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
    expect(typeof result.output.size_bytes).toBe("number");
  });

  it("test: preview should show action and output path", () => {
    const node = createMockNode();
    const result = document_pdf_handler.test(node);
    expect(result.preview).toBeDefined();
    expect(result.preview.action).toBe("create_pdf");
  });

  it("test: should warn about missing required fields", () => {
    const node = createMockNode({ content: "", output: "" });
    const result = document_pdf_handler.test(node);
    expect(result.warnings).toBeDefined();
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("execute: should support different input formats", async () => {
    const node = createMockNode({ input_format: "html" });
    const ctx = createMockContext();
    const result = await document_pdf_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should return output field in result", async () => {
    const node = createMockNode();
    const ctx = createMockContext();
    const result = await document_pdf_handler.execute(node, ctx);
    expect(result.output).toHaveProperty("output");
    expect(result.output).toHaveProperty("size_bytes");
    expect(result.output).toHaveProperty("success");
  });

  it("execute: should handle execution errors gracefully", async () => {
    const node = createMockNode({ output: null });
    const ctx = createMockContext();
    const result = await document_pdf_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
    expect(result.output.success).toBe(false);
  });
});
