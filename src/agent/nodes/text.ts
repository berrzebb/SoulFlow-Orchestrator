/** Text 노드 핸들러 — 워크플로우에서 텍스트 변환. */

import type { NodeHandler } from "../node-registry.js";
import type { TextNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";
import { error_message } from "../../utils/common.js";

export const text_handler: NodeHandler = {
  node_type: "text",
  icon: "\u{1F520}",
  color: "#4e342e",
  shape: "rect",
  output_schema: [
    { name: "result",  type: "string",  description: "Transformed text" },
    { name: "success", type: "boolean", description: "Whether operation succeeded" },
  ],
  input_schema: [
    { name: "operation", type: "string", description: "upper/lower/title/slugify/count/dedup/similarity..." },
    { name: "input",     type: "string", description: "Input text" },
  ],
  create_default: () => ({ operation: "count", input: "", input2: "", max_length: 100, width: 80 }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as TextNodeDefinition;
    try {
      const { TextTool } = await import("../tools/text.js");
      const tool = new TextTool();
      const tpl = { memory: ctx.memory };
      const result = await tool.execute({
        operation: n.operation || "count",
        input: resolve_templates(n.input || "", tpl),
        input2: resolve_templates(n.input2 || "", tpl),
        max_length: n.max_length,
        width: n.width,
      });
      return { output: { result, success: !result.startsWith("Error:") } };
    } catch (err) {
      return { output: { result: error_message(err), success: false } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as TextNodeDefinition;
    const warnings: string[] = [];
    if (!n.input?.trim()) warnings.push("input is required");
    return { preview: { operation: n.operation }, warnings };
  },
};
