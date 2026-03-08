/** Document Pptx node handler. */

import type { NodeHandler } from "../node-registry.js";
import type { DocumentPptxNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecuteResult, OrcheNodeTestResult, OrcheNodeExecutorContext } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";

export const document_pptx_handler: NodeHandler = {
  node_type: "document_pptx",
  icon: "📋",
  color: "#e65100",
  shape: "rect",
  output_schema: [
    { name: "output", type: "string", description: "output" },
    { name: "size_bytes", type: "number", description: "size bytes" },
    { name: "success", type: "boolean", description: "success" },
  ],
  input_schema: [
    { name: "content", type: "string", description: "content" },
    { name: "output", type: "string", description: "output" },
    { name: "slide_format", type: "string", description: "slide format" },
  ],
  create_default: () => ({ content: "", output: "", slide_format: "" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as DocumentPptxNodeDefinition;
    try {
      const { DocumentTool } = await import("../tools/document.js");
      const tool = new DocumentTool({ workspace: ctx.workspace });
      const tpl = { memory: ctx.memory };
      const result = await tool.execute({
        action: "create_pptx",
        content: resolve_templates(n.content || "", tpl),
        output: resolve_templates(n.output || "", tpl),
        slide_format: resolve_templates(n.slide_format || "", tpl),
      });
      const parsed = result.startsWith("{") ? JSON.parse(result) : {};
      return { output: { output: parsed.output || "", size_bytes: parsed.size_bytes || 0, success: parsed.success ?? false } };
    } catch {
      return { output: { output: "", size_bytes: 0, success: false } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as DocumentPptxNodeDefinition;
    const warnings: string[] = [];
    if (!n.content) warnings.push("content is required");
    if (!n.output) warnings.push("output is required");
    return { preview: { action: "create_pptx", output: n.output }, warnings };
  },
};
