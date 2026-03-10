/** Document 노드 핸들러 팩토리 — PDF/DOCX/XLSX/PPTX 생성. */

import type { NodeHandler } from "../node-registry.js";
import type { OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecuteResult, OrcheNodeTestResult, OrcheNodeExecutorContext } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";

type DocumentHandlerConfig = {
  node_type: string;
  icon: string;
  color: string;
  action: string;
  extra_input: { name: string; key: string; description: string };
};

function make_document_handler(cfg: DocumentHandlerConfig): NodeHandler {
  return {
    node_type: cfg.node_type,
    icon: cfg.icon,
    color: cfg.color,
    shape: "rect",
    output_schema: [
      { name: "output",      type: "string",  description: "output" },
      { name: "size_bytes",  type: "number",  description: "size bytes" },
      { name: "success",     type: "boolean", description: "success" },
    ],
    input_schema: [
      { name: "content", type: "string", description: "content" },
      { name: "output",  type: "string", description: "output" },
      { name: cfg.extra_input.name, type: "string", description: cfg.extra_input.description },
    ],
    create_default: () => ({ content: "", output: "", [cfg.extra_input.key]: "" }),

    async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
      const n = node as unknown as Record<string, string | undefined>;
      try {
        const { DocumentTool } = await import("../tools/document.js");
        const tool = new DocumentTool({ workspace: ctx.workspace });
        const tpl = { memory: ctx.memory };
        const result = await tool.execute({
          action: cfg.action,
          content: resolve_templates(n.content || "", tpl),
          output: resolve_templates(n.output || "", tpl),
          [cfg.extra_input.key]: resolve_templates(n[cfg.extra_input.key] || "", tpl),
        });
        const parsed = result.startsWith("{") ? JSON.parse(result) : {};
        return { output: { output: parsed.output || "", size_bytes: parsed.size_bytes || 0, success: parsed.success ?? false } };
      } catch {
        return { output: { output: "", size_bytes: 0, success: false } };
      }
    },

    test(node: OrcheNodeDefinition): OrcheNodeTestResult {
      const n = node as unknown as Record<string, string | undefined>;
      const warnings: string[] = [];
      if (!n.content) warnings.push("content is required");
      if (!n.output) warnings.push("output is required");
      return { preview: { action: cfg.action, output: n.output }, warnings };
    },
  };
}

export const document_docx_handler = make_document_handler({
  node_type: "document_docx", icon: "📝", color: "#1565c0", action: "create_docx",
  extra_input: { name: "input_format", key: "input_format", description: "input format" },
});

export const document_pdf_handler = make_document_handler({
  node_type: "document_pdf", icon: "📄", color: "#e53935", action: "create_pdf",
  extra_input: { name: "input_format", key: "input_format", description: "input format" },
});

export const document_pptx_handler = make_document_handler({
  node_type: "document_pptx", icon: "📋", color: "#e65100", action: "create_pptx",
  extra_input: { name: "slide_format", key: "slide_format", description: "slide format" },
});

export const document_xlsx_handler = make_document_handler({
  node_type: "document_xlsx", icon: "📊", color: "#2e7d32", action: "create_xlsx",
  extra_input: { name: "delimiter", key: "delimiter", description: "delimiter" },
});
