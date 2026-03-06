/** Loop (배열 순회) 노드 핸들러. body_nodes를 각 아이템에 대해 반복 실행. */

import type { NodeHandler, RunnerContext } from "../node-registry.js";
import type { LoopNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";
import { is_orche_node } from "../workflow-node.types.js";
import { error_message } from "../../utils/common.js";

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
    const n = node as LoopNodeDefinition;
    const items = resolve_array(n.array_field, ctx.memory);
    return { output: { item: items[0] ?? null, index: 0, total: items.length, results: [] } };
  },

  async runner_execute(node: OrcheNodeDefinition, _ctx: OrcheNodeExecutorContext, runner: RunnerContext): Promise<OrcheNodeExecuteResult> {
    const n = node as LoopNodeDefinition;
    const items = resolve_array(n.array_field, runner.state.memory);
    const body_ids = n.body_nodes || [];
    const max = Math.min(n.max_iterations ?? 100, items.length);
    const results: unknown[] = [];

    for (let i = 0; i < max; i++) {
      runner.state.memory[`${n.node_id}_item`] = items[i];
      runner.state.memory[`${n.node_id}_index`] = i;

      runner.emit({
        type: "loop_iteration",
        workflow_id: runner.state.workflow_id,
        phase_id: "",
        iteration: i + 1,
      });

      let iteration_output: unknown = null;
      for (const body_id of body_ids) {
        const body_node = runner.all_nodes.find((nd) => nd.node_id === body_id);
        if (!body_node || !is_orche_node(body_node)) continue;

        try {
          const result = await runner.execute_node(body_node as OrcheNodeDefinition, {
            memory: runner.state.memory,
            abort_signal: runner.options.abort_signal,
            workspace: undefined,
          });
          runner.state.memory[body_id] = result.output;
          iteration_output = result.output;
        } catch (err) {
          runner.emit({
            type: "node_error",
            workflow_id: runner.state.workflow_id,
            node_id: body_id,
            error: error_message(err),
          });
          break;
        }
      }
      results.push(iteration_output);
    }

    // cleanup
    delete runner.state.memory[`${n.node_id}_item`];
    delete runner.state.memory[`${n.node_id}_index`];

    return { output: { item: items[max - 1] ?? null, index: max - 1, total: items.length, results } };
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

function resolve_array(field: string, memory: Record<string, unknown>): unknown[] {
  const tpl_ctx = { memory };
  const resolved = resolve_templates(field, tpl_ctx);
  const parts = resolved.split(".");
  let arr: unknown = memory;
  for (const p of parts) {
    if (arr && typeof arr === "object") arr = (arr as Record<string, unknown>)[p];
    else { arr = undefined; break; }
  }
  return Array.isArray(arr) ? arr : [];
}
