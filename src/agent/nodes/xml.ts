/** XML 노드 핸들러 — 워크플로우에서 XML 파싱/생성/쿼리. */

import type { NodeHandler } from "../node-registry.js";
import type { XmlNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";

export const xml_handler: NodeHandler = {
  node_type: "xml",
  icon: "\u{1F4DD}",
  color: "#607d8b",
  shape: "rect",
  output_schema: [
    { name: "result", type: "unknown", description: "Parsed JSON or generated XML" },
    { name: "success", type: "boolean", description: "Whether operation succeeded" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "parse / generate / query / validate" },
    { name: "data", type: "string", description: "XML or JSON data" },
  ],
  create_default: () => ({ action: "parse", data: "", path: "" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as XmlNodeDefinition;
    try {
      const { XmlTool } = await import("../tools/xml.js");
      const tool = new XmlTool();
      const tpl = { memory: ctx.memory };
      const result = await tool.execute({
        action: n.action || "parse",
        data: resolve_templates(n.data || "", tpl),
        path: n.path || "",
      });
      const parsed = result.startsWith("{") || result.startsWith("[") ? JSON.parse(result) : result;
      return { output: { result: parsed, success: !String(result).startsWith("Error:") } };
    } catch {
      return { output: { result: null, success: false } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as XmlNodeDefinition;
    const warnings: string[] = [];
    if (!n.data) warnings.push("data is required");
    return { preview: { action: n.action }, warnings };
  },
};
