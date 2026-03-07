/** Phone 노드 핸들러 — 워크플로우에서 전화번호 처리. */

import type { NodeHandler } from "../node-registry.js";
import type { PhoneNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";

export const phone_handler: NodeHandler = {
  node_type: "phone",
  icon: "\u260E\uFE0F",
  color: "#0288d1",
  shape: "rect",
  output_schema: [
    { name: "result", type: "unknown", description: "Phone operation result" },
    { name: "valid", type: "boolean", description: "Whether phone number is valid" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "parse / format / validate / normalize / country_info / compare" },
    { name: "number", type: "string", description: "Phone number" },
  ],
  create_default: () => ({ action: "validate", number: "", country: "" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as PhoneNodeDefinition;
    try {
      const { PhoneTool } = await import("../tools/phone.js");
      const tool = new PhoneTool();
      const tpl = { memory: ctx.memory };
      const result = await tool.execute({
        action: n.action || "validate",
        number: n.number ? resolve_templates(n.number, tpl) : undefined,
        number2: n.number2 ? resolve_templates(n.number2, tpl) : undefined,
        country: n.country,
        format_type: n.format_type,
      });
      const parsed = JSON.parse(result);
      return { output: { result: parsed, valid: parsed.valid ?? true } };
    } catch {
      return { output: { result: null, valid: false } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as PhoneNodeDefinition;
    const warnings: string[] = [];
    if (!n.number && n.action !== "country_info") warnings.push("number is required");
    return { preview: { action: n.action, country: n.country }, warnings };
  },
};
