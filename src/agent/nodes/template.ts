/** Template (텍스트 렌더링) 노드 핸들러. */

import type { NodeHandler } from "../node-registry.js";
import type { TemplateNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";

export const template_handler: NodeHandler = {
  node_type: "template",
  icon: "{ }",
  color: "#00bcd4",
  shape: "rect",
  output_schema: [
    { name: "text", type: "string", description: "Rendered template output" },
  ],
  input_schema: [
    { name: "input", type: "object", description: "Template variables" },
  ],
  create_default: () => ({ template: "{{input}}" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as TemplateNodeDefinition;
    const tpl_ctx = { memory: ctx.memory };
    const text = resolve_templates(n.template || "", tpl_ctx);
    return { output: { text } };
  },

  test(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): OrcheNodeTestResult {
    const n = node as TemplateNodeDefinition;
    const warnings: string[] = [];
    if (!n.template?.trim()) warnings.push("template is empty");
    const tpl_ctx = { memory: ctx.memory };
    const rendered = resolve_templates(n.template || "", tpl_ctx);
    return { preview: { template_length: n.template?.length || 0, rendered_preview: rendered.slice(0, 200) }, warnings };
  },
};
