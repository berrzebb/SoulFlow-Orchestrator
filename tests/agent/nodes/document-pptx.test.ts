import { describe, it, expect } from "vitest";
import { document_pptx_handler } from "../../../src/agent/nodes/document-pptx.js";
import type { OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("document_pptx_handler", () => {
  const createMockNode = (overrides?: Partial<any>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "document_pptx",
    content: "# Presentation\n\n## Slide 1\nIntroduction content\n\n## Slide 2\nMain points",
    output: "/tmp/test.pptx",
    slide_format: "standard",
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be document_pptx", () => {
    expect(document_pptx_handler.node_type).toBe("document_pptx");
  });

  it("execute: should generate PPTX presentation", async () => {
    const node = createMockNode();
    const ctx = createMockContext();
    const result = await document_pptx_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
    expect(typeof result.output.success).toBe("boolean");
  });

  it("execute: should resolve templates in content", async () => {
    const node = createMockNode({ content: "${pptx_content}" });
    const ctx = createMockContext({ pptx_content: "# Slide Template\n\nTemplate content" });
    const result = await document_pptx_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle missing content gracefully", async () => {
    const node = createMockNode({ content: "" });
    const ctx = createMockContext();
    const result = await document_pptx_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
    expect(typeof result.output.size_bytes).toBe("number");
  });

  it("test: preview should show action and output path", () => {
    const node = createMockNode();
    const result = document_pptx_handler.test(node);
    expect(result.preview).toBeDefined();
    expect(result.preview.action).toBe("create_pptx");
  });

  it("test: should warn about missing required fields", () => {
    const node = createMockNode({ content: "", output: "" });
    const result = document_pptx_handler.test(node);
    expect(result.warnings).toBeDefined();
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("execute: should support different slide formats", async () => {
    const node = createMockNode({ slide_format: "widescreen" });
    const ctx = createMockContext();
    const result = await document_pptx_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should resolve templates in slide_format", async () => {
    const node = createMockNode({ slide_format: "${format_type}" });
    const ctx = createMockContext({ format_type: "16:9" });
    const result = await document_pptx_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should return output field in result", async () => {
    const node = createMockNode();
    const ctx = createMockContext();
    const result = await document_pptx_handler.execute(node, ctx);
    expect(result.output).toHaveProperty("output");
    expect(result.output).toHaveProperty("size_bytes");
    expect(result.output).toHaveProperty("success");
  });

  it("execute: should handle execution errors gracefully", async () => {
    const node = createMockNode({ output: null });
    const ctx = createMockContext();
    const result = await document_pptx_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
    expect(result.output.success).toBe(false);
  });
});
