/** Transform (데이터 변환) 노드 핸들러. */

import { createContext, runInNewContext } from "node:vm";
import type { NodeHandler } from "../node-registry.js";
import type { TransformNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";
import { error_message } from "../../utils/common.js";

export const transform_handler: NodeHandler = {
  node_type: "transform",
  icon: "⇄",
  color: "#2980b9",
  shape: "rect",
  output_schema: [
    { name: "items", type: "array",  description: "Transformed items" },
    { name: "count", type: "number", description: "Item count" },
  ],
  input_schema: [
    { name: "array",      type: "array",  description: "Array to transform" },
    { name: "expression", type: "string", description: "JS expression per item" },
  ],
  create_default: () => ({ expression: "item", array_field: "items" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as TransformNodeDefinition;
    const tpl_ctx = { memory: ctx.memory };
    const field = resolve_templates(n.array_field, tpl_ctx);

    const parts = field.split(".");
    let arr: unknown = ctx.memory;
    for (const p of parts) {
      if (arr && typeof arr === "object") arr = (arr as Record<string, unknown>)[p];
      else { arr = undefined; break; }
    }
    if (!Array.isArray(arr)) {
      return { output: { items: [], count: 0 } };
    }

    const items: unknown[] = [];
    for (const item of arr) {
      const sandbox = createContext({ item, memory: ctx.memory });
      try {
        const result = runInNewContext(n.expression, sandbox, { timeout: 500 });
        items.push(result);
      } catch {
        items.push(null);
      }
    }
    return { output: { items, count: items.length } };
  },

  test(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): OrcheNodeTestResult {
    const n = node as TransformNodeDefinition;
    const warnings: string[] = [];
    try {
      const sandbox = createContext({ item: {}, memory: ctx.memory });
      runInNewContext(n.expression, sandbox, { timeout: 500 });
    } catch (e) {
      warnings.push(`expression syntax error: ${error_message(e)}`);
    }
    return { preview: { expression: n.expression, array_field: n.array_field }, warnings };
  },
};
