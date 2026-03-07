/** YAML 노드 핸들러 — 워크플로우에서 YAML 파싱/생성/머지. */

import type { NodeHandler } from "../node-registry.js";
import type { YamlNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";

export const yaml_handler: NodeHandler = {
  node_type: "yaml",
  icon: "\u{1F4C3}",
  color: "#9e9e9e",
  shape: "rect",
  output_schema: [
    { name: "result", type: "unknown", description: "Parsed JSON or generated YAML" },
    { name: "success", type: "boolean", description: "Whether operation succeeded" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "parse / generate / merge / validate / query" },
    { name: "data", type: "string", description: "YAML or JSON data" },
  ],
  create_default: () => ({ action: "parse", data: "", data2: "", path: "", indent: 2 }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as YamlNodeDefinition;
    try {
      const { YamlTool } = await import("../tools/yaml.js");
      const tool = new YamlTool();
      const tpl = { memory: ctx.memory };
      const result = await tool.execute({
        action: n.action || "parse",
        data: resolve_templates(n.data || "", tpl),
        data2: resolve_templates(n.data2 || "", tpl),
        path: n.path || "",
        indent: n.indent || 2,
      });
      const parsed = result.startsWith("{") || result.startsWith("[") ? JSON.parse(result) : result;
      return { output: { result: parsed, success: !String(result).startsWith("Error:") } };
    } catch {
      return { output: { result: null, success: false } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as YamlNodeDefinition;
    const warnings: string[] = [];
    if (!n.data) warnings.push("data is required");
    return { preview: { action: n.action }, warnings };
  },
};
