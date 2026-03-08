/** Document Xlsx node handler. */

import type { NodeHandler } from "../node-registry.js";
import type { DocumentXlsxNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecuteResult, OrcheNodeTestResult, OrcheNodeExecutorContext } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";

export const document_xlsx_handler: NodeHandler = {
  node_type: "document_xlsx",
  icon: "📊",
  color: "#2e7d32",
  shape: "rect",
  output_schema: [
    { name: "output", type: "string", description: "output" },
    { name: "size_bytes", type: "number", description: "size bytes" },
    { name: "success", type: "boolean", description: "success" },
  ],
  input_schema: [
    { name: "content", type: "string", description: "content" },
    { name: "output", type: "string", description: "output" },
    { name: "delimiter", type: "string", description: "delimiter" },
  ],
  create_default: () => ({ content: "", output: "", delimiter: "" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as DocumentXlsxNodeDefinition;
    try {
      const { DocumentTool } = await import("../tools/document.js");
      const tool = new DocumentTool({ workspace: ctx.workspace });
      const tpl = { memory: ctx.memory };
      const result = await tool.execute({
        action: "create_xlsx",
        content: resolve_templates(n.content || "", tpl),
        output: resolve_templates(n.output || "", tpl),
        delimiter: resolve_templates(n.delimiter || "", tpl),
      });
      const parsed = result.startsWith("{") ? JSON.parse(result) : {};
      return { output: { output: parsed.output || "", size_bytes: parsed.size_bytes || 0, success: parsed.success ?? false } };
    } catch {
      return { output: { output: "", size_bytes: 0, success: false } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as DocumentXlsxNodeDefinition;
    const warnings: string[] = [];
    if (!n.content) warnings.push("content is required");
    if (!n.output) warnings.push("output is required");
    return { preview: { action: "create_xlsx", output: n.output }, warnings };
  },
};
