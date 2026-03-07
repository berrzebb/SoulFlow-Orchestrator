/** PDF 노드 핸들러 — 워크플로우에서 PDF 텍스트 추출/정보 조회. */

import type { NodeHandler } from "../node-registry.js";
import type { PdfNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";

export const pdf_handler: NodeHandler = {
  node_type: "pdf",
  icon: "\u{1F4C4}",
  color: "#e53935",
  shape: "rect",
  output_schema: [
    { name: "text", type: "string", description: "Extracted text" },
    { name: "pages", type: "number", description: "Page count" },
    { name: "success", type: "boolean", description: "Whether operation succeeded" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "extract_text / info / page_count" },
    { name: "path", type: "string", description: "PDF file path" },
  ],
  create_default: () => ({ action: "extract_text", path: "", pages: "", max_chars: 50000 }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as PdfNodeDefinition;
    try {
      const { PdfTool } = await import("../tools/pdf.js");
      const tool = new PdfTool({ workspace: ctx.workspace });
      const tpl = { memory: ctx.memory };
      const result = await tool.execute({
        action: n.action || "extract_text",
        path: resolve_templates(n.path || "", tpl),
        pages: n.pages || "",
        max_chars: n.max_chars || 50000,
      });
      const parsed = result.startsWith("{") ? JSON.parse(result) : {};
      return { output: { text: parsed.text || "", pages: parsed.pages || 0, success: !result.startsWith("Error:") } };
    } catch {
      return { output: { text: "", pages: 0, success: false } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as PdfNodeDefinition;
    const warnings: string[] = [];
    if (!n.path) warnings.push("path is required");
    return { preview: { action: n.action, path: n.path }, warnings };
  },
};
