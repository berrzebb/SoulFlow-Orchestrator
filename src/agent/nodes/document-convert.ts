/** Document Convert node handler. */

import type { NodeHandler } from "../node-registry.js";
import type { DocumentConvertNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecuteResult, OrcheNodeTestResult, OrcheNodeExecutorContext } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";

export const document_convert_handler: NodeHandler = {
  node_type: "document_convert",
  icon: "🔄",
  color: "#6a1b9a",
  shape: "rect",
  output_schema: [
    { name: "output", type: "string", description: "output" },
    { name: "success", type: "boolean", description: "success" },
  ],
  input_schema: [
    { name: "input", type: "string", description: "input" },
    { name: "to", type: "string", description: "to" },
  ],
  create_default: () => ({ input: "", to: "" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as DocumentConvertNodeDefinition;
    try {
      const { DocumentTool } = await import("../tools/document.js");
      const tool = new DocumentTool({ workspace: ctx.workspace });
      const tpl = { memory: ctx.memory };
      const result = await tool.execute({
        action: "convert",
        input: resolve_templates(n.input || "", tpl),
        to: resolve_templates(n.to || "", tpl),
      });
      const parsed = result.startsWith("{") ? JSON.parse(result) : {};
      return { output: { output: parsed.output || "", success: parsed.success ?? false } };
    } catch {
      return { output: { output: "", success: false } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as DocumentConvertNodeDefinition;
    const warnings: string[] = [];
    if (!n.input) warnings.push("input is required");
    if (!n.to) warnings.push("to is required");
    return { preview: { action: "convert", input: n.input, to: n.to }, warnings };
  },
};
