/** Random 노드 핸들러 — 난수/무작위 선택/셔플/비밀번호 생성. */

import type { NodeHandler } from "../node-registry.js";
import type { OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";
import { error_message } from "../../utils/common.js";

type RandomNodeDefinition = OrcheNodeDefinition & {
  action?: string;
  min?: number;
  max?: number;
  items?: string;
  count?: number;
  length?: number;
  charset?: string;
  sides?: number;
}

export const random_handler: NodeHandler = {
  node_type: "random",
  icon: "\u{1F3B2}",
  color: "#7b1fa2",
  shape: "rect",
  output_schema: [
    { name: "value",  type: "string",  description: "Random value (integer/float/choice/coin)" },
    { name: "result", type: "array",   description: "Result array (shuffle/sample/dice)" },
    { name: "password", type: "string", description: "Generated password" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "integer/float/choice/shuffle/sample/password/bytes/coin/dice" },
    { name: "items",  type: "string", description: "JSON array or CSV for choice/shuffle/sample" },
  ],
  create_default: () => ({ action: "integer", min: 0, max: 100, items: "", count: 1, length: 16, charset: "symbols", sides: 6 }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as RandomNodeDefinition;
    const tpl = { memory: ctx.memory };
    try {
      const { RandomTool } = await import("../tools/random.js");
      const tool = new RandomTool();
      const raw = await tool.execute({
        action:  n.action || "integer",
        min:     n.min,
        max:     n.max,
        items:   resolve_templates(n.items || "", tpl) || undefined,
        count:   n.count,
        length:  n.length,
        charset: n.charset,
        sides:   n.sides,
      });
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return { output: parsed };
    } catch (err) {
      return { output: { error: error_message(err) } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as RandomNodeDefinition;
    const warnings: string[] = [];
    const needs_items = ["choice", "shuffle", "sample"];
    if (needs_items.includes(n.action || "") && !n.items?.trim()) warnings.push("items is required for this action");
    return { preview: { action: n.action }, warnings };
  },
};
