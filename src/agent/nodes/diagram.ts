/** Diagram 노드 핸들러 — 워크플로우에서 다이어그램 렌더링. */

import type { NodeHandler } from "../node-registry.js";
import type { DiagramNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";
import { error_message } from "../../utils/common.js";

export const diagram_handler: NodeHandler = {
  node_type: "diagram",
  icon: "\u{1F4CA}",
  color: "#00897b",
  shape: "rect",
  output_schema: [
    { name: "output", type: "string", description: "Rendered diagram output" },
    { name: "format", type: "string", description: "Output format" },
    { name: "success", type: "boolean", description: "Whether render succeeded" },
  ],
  input_schema: [
    { name: "source", type: "string", description: "Diagram source (Mermaid/PlantUML)" },
    { name: "type", type: "string", description: "Diagram type" },
  ],
  create_default: () => ({ source: "", type: "mermaid", output_format: "svg" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as DiagramNodeDefinition;
    try {
      const { DiagramRenderTool } = await import("../tools/diagram.js");
      const tool = new DiagramRenderTool();
      const tpl = { memory: ctx.memory };
      const result = await tool.execute({
        source: resolve_templates(n.source || "", tpl),
        type: n.type || "mermaid",
        output_format: n.output_format || "svg",
      });
      return { output: { output: result, format: n.output_format || "svg", success: !result.startsWith("Error:") } };
    } catch (err) {
      return { output: { output: error_message(err), format: "", success: false } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as DiagramNodeDefinition;
    return { preview: { type: n.type, source_length: (n.source || "").length }, warnings: [] };
  },
};
