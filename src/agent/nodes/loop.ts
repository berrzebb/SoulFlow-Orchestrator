/** Loop (배열 순회) 노드 핸들러. */

import type { NodeHandler } from "../node-registry.js";
import type { LoopNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";

export const loop_handler: NodeHandler = {
  node_type: "loop",
  icon: "⟳",
  color: "#8e44ad",
  shape: "rect",
  output_schema: [
    { name: "item",       type: "unknown", description: "Current iteration item" },
    { name: "index",      type: "number",  description: "Current iteration index" },
    { name: "total",      type: "number",  description: "Total item count" },
    { name: "results",    type: "array",   description: "Collected results from body" },
  ],
  input_schema: [
    { name: "array", type: "array", description: "Array to iterate over" },
  ],
  create_default: () => ({ array_field: "items", body_nodes: [], max_iterations: 100 }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    // 실제 반복 실행은 phase-loop-runner가 body_nodes를 순회하며 처리.
    // 여기서는 배열 정보만 반환.
    const n = node as LoopNodeDefinition;
    const tpl_ctx = { memory: ctx.memory };
    const field = resolve_templates(n.array_field, tpl_ctx);

    const parts = field.split(".");
    let arr: unknown = ctx.memory;
    for (const p of parts) {
      if (arr && typeof arr === "object") arr = (arr as Record<string, unknown>)[p];
      else { arr = undefined; break; }
    }
    const items = Array.isArray(arr) ? arr : [];
    return { output: { item: items[0] ?? null, index: 0, total: items.length, results: [] } };
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as LoopNodeDefinition;
    const warnings: string[] = [];
    if ((n.max_iterations ?? 100) > 1000) warnings.push("max_iterations > 1000 may be slow");
    if (!n.array_field) warnings.push("array_field is empty");
    return {
      preview: { array_field: n.array_field, body_nodes: n.body_nodes || [], max_iterations: n.max_iterations ?? 100 },
      warnings,
    };
  },
};
