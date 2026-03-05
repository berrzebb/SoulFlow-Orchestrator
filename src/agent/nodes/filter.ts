/** Filter (조건 필터링) 노드 핸들러. */

import { createContext, runInNewContext } from "node:vm";
import type { NodeHandler } from "../node-registry.js";
import type { FilterNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";
import { error_message } from "../../utils/common.js";

export const filter_handler: NodeHandler = {
  node_type: "filter",
  icon: "⊳",
  color: "#1abc9c",
  shape: "rect",
  output_schema: [
    { name: "items",    type: "array",  description: "Filtered items" },
    { name: "count",    type: "number", description: "Filtered item count" },
    { name: "rejected", type: "number", description: "Rejected item count" },
  ],
  input_schema: [
    { name: "array", type: "array",   description: "Array to filter" },
    { name: "condition", type: "string", description: "JS condition per item" },
  ],
  create_default: () => ({ condition: "true", array_field: "items" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as FilterNodeDefinition;
    const tpl_ctx = { memory: ctx.memory };
    const field = resolve_templates(n.array_field, tpl_ctx);

    // memory에서 배열 조회
    const parts = field.split(".");
    let arr: unknown = ctx.memory;
    for (const p of parts) {
      if (arr && typeof arr === "object") arr = (arr as Record<string, unknown>)[p];
      else { arr = undefined; break; }
    }
    if (!Array.isArray(arr)) {
      return { output: { items: [], count: 0, rejected: 0 } };
    }

    const items: unknown[] = [];
    for (const item of arr) {
      const sandbox = createContext({ item, memory: ctx.memory });
      try {
        const result = runInNewContext(n.condition, sandbox, { timeout: 500 });
        if (result) items.push(item);
      } catch { /* condition 실패 → 제외 */ }
    }
    return { output: { items, count: items.length, rejected: arr.length - items.length } };
  },

  test(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): OrcheNodeTestResult {
    const n = node as FilterNodeDefinition;
    const warnings: string[] = [];
    try {
      const sandbox = createContext({ item: {}, memory: ctx.memory });
      runInNewContext(n.condition, sandbox, { timeout: 500 });
    } catch (e) {
      warnings.push(`condition syntax error: ${error_message(e)}`);
    }
    return { preview: { condition: n.condition, array_field: n.array_field }, warnings };
  },
};
