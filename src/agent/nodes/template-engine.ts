/** TemplateEngine 노드 핸들러 — Mustache 스타일 템플릿 렌더링. */

import type { NodeHandler } from "../node-registry.js";
import type { TemplateEngineNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";
import { error_message } from "../../utils/common.js";

export const template_engine_handler: NodeHandler = {
  node_type: "template_engine",
  icon: "\u{1F4C4}",
  color: "#00695c",
  shape: "rect",
  output_schema: [
    { name: "result",  type: "string",  description: "Rendered template output" },
    { name: "success", type: "boolean", description: "Whether rendering succeeded" },
  ],
  input_schema: [
    { name: "template", type: "string", description: "Template string" },
    { name: "data",     type: "string", description: "Template variables (JSON)" },
  ],
  create_default: () => ({ template: "", data: "{}", partials: "{}" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as TemplateEngineNodeDefinition;
    try {
      const { TemplateTool } = await import("../tools/template-engine.js");
      const tool = new TemplateTool();
      const data_str = resolve_templates(n.data || "{}", { memory: ctx.memory });
      const result = await tool.execute({ template: n.template || "", data: data_str, partials: n.partials || "{}" });
      return { output: { result, success: !result.startsWith("Error:") } };
    } catch (err) {
      return { output: { result: error_message(err), success: false } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as TemplateEngineNodeDefinition;
    const warnings: string[] = [];
    if (!n.template?.trim()) warnings.push("template is required");
    return { preview: { template_length: n.template?.length || 0 }, warnings };
  },
};
