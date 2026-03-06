/** Merge (Join) 노드 핸들러. */

import type { NodeHandler } from "../node-registry.js";
import type { MergeNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";

export const merge_handler: NodeHandler = {
  node_type: "merge",
  icon: "⊕",
  color: "#9b59b6",
  shape: "diamond",
  output_schema: [
    { name: "merged", type: "object", description: "Collected upstream outputs" },
  ],
  input_schema: [],
  create_default: () => ({ merge_mode: "wait_all" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as MergeNodeDefinition;
    const deps = n.depends_on || [];

    if (n.merge_mode === "collect") {
      const collected: unknown[] = [];
      for (const dep_id of deps) {
        if (ctx.memory[dep_id] !== undefined) collected.push(ctx.memory[dep_id]);
      }
      return { output: { merged: collected } };
    }

    const merged: Record<string, unknown> = {};
    for (const dep_id of deps) {
      if (ctx.memory[dep_id] !== undefined) {
        merged[dep_id] = ctx.memory[dep_id];
      }
    }
    return { output: { merged } };
  },

  test(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): OrcheNodeTestResult {
    const n = node as MergeNodeDefinition;
    const warnings: string[] = [];
    const available = (n.depends_on || []).filter((id) => ctx.memory[id] !== undefined);
    const missing = (n.depends_on || []).filter((id) => ctx.memory[id] === undefined);
    if (missing.length) warnings.push(`missing upstream data: ${missing.join(", ")}`);
    return { preview: { available_inputs: available, missing_inputs: missing, merge_mode: n.merge_mode }, warnings };
  },
};
