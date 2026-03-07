/** Eval 노드 핸들러 — 워크플로우에서 JS 표현식 평가. */

import type { NodeHandler } from "../node-registry.js";
import type { EvalNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";
import { error_message } from "../../utils/common.js";

export const eval_handler: NodeHandler = {
  node_type: "eval",
  icon: "\u{1F4BB}",
  color: "#4a148c",
  shape: "rect",
  output_schema: [
    { name: "result",  type: "string",  description: "Evaluation result" },
    { name: "success", type: "boolean", description: "Whether evaluation succeeded" },
  ],
  input_schema: [
    { name: "code",    type: "string", description: "JavaScript code to evaluate" },
    { name: "context", type: "string", description: "JSON context variables" },
  ],
  create_default: () => ({ code: "", context: "" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as EvalNodeDefinition;
    try {
      const { EvalTool } = await import("../tools/eval.js");
      const tool = new EvalTool();
      const tpl = { memory: ctx.memory };
      const result = await tool.execute({
        code: resolve_templates(n.code || "", tpl),
        context: resolve_templates(n.context || "", tpl),
      });
      return { output: { result, success: !result.startsWith("Error:") } };
    } catch (err) {
      return { output: { result: error_message(err), success: false } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as EvalNodeDefinition;
    const warnings: string[] = [];
    if (!n.code?.trim()) warnings.push("code is required");
    return { preview: { code: (n.code || "").slice(0, 80) }, warnings };
  },
};
