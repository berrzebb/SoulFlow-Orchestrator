/** CodeDiagram 노드 핸들러 — 워크플로우에서 소스 코드 분석 → 다이어그램 생성. */

import type { NodeHandler } from "../node-registry.js";
import type { CodeDiagramNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";

export const code_diagram_handler: NodeHandler = {
  node_type: "code_diagram",
  icon: "\u{1F4CA}",
  color: "#6a1b9a",
  shape: "rect",
  output_schema: [
    { name: "diagram", type: "string", description: "Generated Mermaid diagram source" },
    { name: "diagram_type", type: "string", description: "Diagram type (classDiagram, sequenceDiagram, etc.)" },
    { name: "result", type: "unknown", description: "Full analysis result" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "class_diagram / sequence_diagram / flowchart / dependency_graph / er_diagram / call_graph / component_diagram" },
    { name: "source", type: "string", description: "Source code text" },
  ],
  create_default: () => ({ action: "class_diagram", source: "" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as CodeDiagramNodeDefinition;
    try {
      const { CodeDiagramTool } = await import("../tools/code-diagram.js");
      const tool = new CodeDiagramTool();
      const tpl = { memory: ctx.memory };
      const result = await tool.execute({
        action: n.action || "class_diagram",
        source: n.source ? resolve_templates(n.source, tpl) : undefined,
        sources: n.sources ? resolve_templates(n.sources, tpl) : undefined,
        function_name: n.function_name ? resolve_templates(n.function_name, tpl) : undefined,
        direction: n.direction,
        show_private: n.show_private,
        group_by_folder: n.group_by_folder,
        actors: n.actors ? resolve_templates(n.actors, tpl) : undefined,
        messages: n.messages ? resolve_templates(n.messages, tpl) : undefined,
      });
      const parsed = JSON.parse(result);
      return { output: { diagram: parsed.diagram || "", diagram_type: parsed.diagram_type || "", result: parsed } };
    } catch {
      return { output: { diagram: "", diagram_type: "", result: null } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as CodeDiagramNodeDefinition;
    const warnings: string[] = [];
    if (!n.action) warnings.push("action is required");
    if (!n.source && !n.sources) warnings.push("source or sources is required");
    return { preview: { action: n.action, direction: n.direction }, warnings };
  },
};
