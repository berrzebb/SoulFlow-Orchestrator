/** DataMask 노드 핸들러 — 워크플로우에서 PII 자동 마스킹. */

import type { NodeHandler } from "../node-registry.js";
import type { DataMaskNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";

export const data_mask_handler: NodeHandler = {
  node_type: "data_mask",
  icon: "\u{1F3AD}",
  color: "#b71c1c",
  shape: "rect",
  output_schema: [
    { name: "masked", type: "string", description: "Masked text" },
    { name: "count", type: "number", description: "Number of items masked" },
    { name: "result", type: "unknown", description: "Full result" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "mask_email / mask_phone / mask_card / mask_ip / detect_pii / redact / custom_mask" },
    { name: "text", type: "string", description: "Input text" },
  ],
  create_default: () => ({ action: "redact", text: "" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as DataMaskNodeDefinition;
    try {
      const { DataMaskTool } = await import("../tools/data-mask.js");
      const tool = new DataMaskTool();
      const tpl = { memory: ctx.memory };
      const result = await tool.execute({
        action: n.action || "redact",
        text: n.text ? resolve_templates(n.text, tpl) : "",
        pattern: n.pattern ? resolve_templates(n.pattern, tpl) : undefined,
        replacement: n.replacement,
      });
      const parsed = JSON.parse(result);
      return { output: { masked: parsed.masked || parsed.redacted || "", count: parsed.count || parsed.total || 0, result: parsed } };
    } catch {
      return { output: { masked: "", count: 0, result: null } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as DataMaskNodeDefinition;
    const warnings: string[] = [];
    if (!n.text) warnings.push("text is required");
    return { preview: { action: n.action }, warnings };
  },
};
