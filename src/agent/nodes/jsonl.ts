/** JSONL 노드 핸들러 — JSON Lines 파싱/생성/필터/통계. */

import type { NodeHandler } from "../node-registry.js";
import type { OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";
import { error_message } from "../../utils/common.js";

interface JsonlNodeDefinition extends OrcheNodeDefinition {
  action?: string;
  input?: string;
  data?: string;
  field?: string;
  value?: string;
  count?: number;
  expression?: string;
}

export const jsonl_handler: NodeHandler = {
  node_type: "jsonl",
  icon: "\u{1F4CA}",
  color: "#795548",
  shape: "rect",
  output_schema: [
    { name: "records", type: "array",  description: "Parsed records" },
    { name: "count",   type: "number", description: "Record count" },
    { name: "matched", type: "array",  description: "Filtered records" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "parse/generate/filter/count/head/tail/map/unique" },
    { name: "input",  type: "string", description: "JSONL string (one JSON per line)" },
  ],
  create_default: () => ({ action: "parse", input: "", data: "", field: "", value: "", count: 10, expression: "" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as JsonlNodeDefinition;
    const tpl = { memory: ctx.memory };
    try {
      const { JsonlTool } = await import("../tools/jsonl.js");
      const tool = new JsonlTool();
      const raw = await tool.execute({
        action:     n.action || "parse",
        input:      resolve_templates(n.input || "", tpl),
        data:       resolve_templates(n.data || "", tpl) || undefined,
        field:      n.field || undefined,
        value:      n.value || undefined,
        count:      n.count,
        expression: n.expression || undefined,
      });
      // output은 JSON 또는 raw JSONL 문자열
      const parsed = (() => { try { return JSON.parse(raw) as Record<string, unknown>; } catch { return { result: raw }; } })();
      return { output: parsed };
    } catch (err) {
      return { output: { error: error_message(err) } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as JsonlNodeDefinition;
    const warnings: string[] = [];
    if (n.action !== "generate" && !n.input?.trim()) warnings.push("input is required");
    if (n.action === "generate" && !n.data?.trim()) warnings.push("data (JSON array) is required for generate");
    return { preview: { action: n.action }, warnings };
  },
};
