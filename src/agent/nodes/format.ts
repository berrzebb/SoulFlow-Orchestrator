/** Format 노드 핸들러 — 워크플로우에서 값 포매팅. */

import type { NodeHandler } from "../node-registry.js";
import type { FormatNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";
import { error_message } from "../../utils/common.js";

export const format_handler: NodeHandler = {
  node_type: "format",
  icon: "\u{1F3AF}",
  color: "#00838f",
  shape: "rect",
  output_schema: [
    { name: "result",  type: "string",  description: "Formatted value" },
    { name: "success", type: "boolean", description: "Whether formatting succeeded" },
  ],
  input_schema: [
    { name: "operation", type: "string", description: "number/currency/percent/bytes/relative_time/mask/..." },
    { name: "value",     type: "string", description: "Value to format" },
  ],
  create_default: () => ({ operation: "number", value: "", locale: "en-US", currency: "USD", decimals: 2, mask_type: "custom" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as FormatNodeDefinition;
    try {
      const { FormatTool } = await import("../tools/format.js");
      const tool = new FormatTool();
      const tpl = { memory: ctx.memory };
      const result = await tool.execute({
        operation: n.operation || "number",
        value: resolve_templates(n.value || "", tpl),
        locale: n.locale, currency: n.currency, decimals: n.decimals,
        mask_type: n.mask_type, mask_char: n.mask_char,
        word: n.word, plural_word: n.plural_word,
        width: n.width, fill: n.fill, align: n.align,
        max_length: n.max_length, suffix: n.suffix,
      });
      return { output: { result, success: !result.startsWith("Error:") } };
    } catch (err) {
      return { output: { result: error_message(err), success: false } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as FormatNodeDefinition;
    const warnings: string[] = [];
    if (!n.value?.trim()) warnings.push("value is required");
    return { preview: { operation: n.operation }, warnings };
  },
};
