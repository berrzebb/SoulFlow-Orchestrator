/** Document Docx node handler. */

import type { NodeHandler } from "../node-registry.js";
import type { DocumentDocxNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecuteResult, OrcheNodeTestResult, OrcheNodeExecutorContext } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";

export const document_docx_handler: NodeHandler = {
  node_type: "document_docx",
  icon: "📝",
  color: "#1565c0",
  shape: "rect",
  output_schema: [
    { name: "output", type: "string", description: "output" },
    { name: "size_bytes", type: "number", description: "size bytes" },
    { name: "success", type: "boolean", description: "success" },
  ],
  input_schema: [
    { name: "content", type: "string", description: "content" },
    { name: "input_format", type: "string", description: "input format" },
    { name: "output", type: "string", description: "output" },
  ],
  create_default: () => ({ content: "", input_format: "", output: "" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as DocumentDocxNodeDefinition;
    try {
      const { DocumentTool } = await import("../tools/document.js");
      const tool = new DocumentTool({ workspace: ctx.workspace });
      const tpl = { memory: ctx.memory };
      const result = await tool.execute({
        action: "create_docx",
        content: resolve_templates(n.content || "", tpl),
        input_format: resolve_templates(n.input_format || "", tpl),
        output: resolve_templates(n.output || "", tpl),
      });
      const parsed = result.startsWith("{") ? JSON.parse(result) : {};
      return { output: { output: parsed.output || "", size_bytes: parsed.size_bytes || 0, success: parsed.success ?? false } };
    } catch {
      return { output: { output: "", size_bytes: 0, success: false } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as DocumentDocxNodeDefinition;
    const warnings: string[] = [];
    if (!n.content) warnings.push("content is required");
    if (!n.output) warnings.push("output is required");
    return { preview: { action: "create_docx", output: n.output }, warnings };
  },
};
