/** Batch (병렬 배치 처리) 노드 핸들러. 배열을 동시성 제한으로 병렬 처리. */

import type { NodeHandler, RunnerContext } from "../node-registry.js";
import type { BatchNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { error_message } from "../../utils/common.js";
import { is_orche_node } from "../workflow-node.types.js";

export const batch_handler: NodeHandler = {
  node_type: "batch",
  icon: "⚡",
  color: "#673ab7",
  shape: "rect",
  output_schema: [
    { name: "results",    type: "array",   description: "Results for each item" },
    { name: "total",      type: "number",  description: "Total items processed" },
    { name: "succeeded",  type: "number",  description: "Successfully processed count" },
    { name: "failed",     type: "number",  description: "Failed count" },
    { name: "errors",     type: "array",   description: "Error details for failed items" },
  ],
  input_schema: [
    { name: "items",       type: "array",  description: "Items to process" },
    { name: "concurrency", type: "number", description: "Max parallel executions (override)" },
  ],
  create_default: () => ({
    array_field: "",
    concurrency: 5,
    body_node: "",
    on_item_error: "continue" as const,
  }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as BatchNodeDefinition;
    const items = get_array(ctx.memory, n.array_field || "");
    return {
      output: { results: [], total: items.length, succeeded: 0, failed: 0, errors: [] },
    };
  },

  async runner_execute(node: OrcheNodeDefinition, _ctx: OrcheNodeExecutorContext, runner: RunnerContext): Promise<OrcheNodeExecuteResult> {
    const n = node as BatchNodeDefinition;
    const items = get_array(runner.state.memory, n.array_field || "");
    const body_node = runner.all_nodes.find((nd) => nd.node_id === n.body_node);
    const concurrency = n.concurrency ?? 5;
    const on_error = n.on_item_error ?? "continue";

    if (!body_node || !is_orche_node(body_node)) {
      return { output: { results: [], total: items.length, succeeded: 0, failed: items.length, errors: [`body node not found: ${n.body_node}`] } };
    }

    const results: unknown[] = [];
    const errors: Array<{ index: number; error: string }> = [];
    let succeeded = 0;
    let failed = 0;
    let halted = false;

    for (let i = 0; i < items.length && !halted; i += concurrency) {
      const chunk = items.slice(i, i + concurrency);
      const chunk_promises = chunk.map(async (item, offset) => {
        const idx = i + offset;
        const item_memory = { ...runner.state.memory, _batch_item: item, _batch_index: idx };
        try {
          const result = await runner.execute_node(body_node as OrcheNodeDefinition, {
            memory: item_memory,
            abort_signal: runner.options.abort_signal,
            workspace: undefined,
          });
          return { idx, output: result.output, error: null };
        } catch (err) {
          return { idx, output: null, error: error_message(err) };
        }
      });

      const chunk_results = await Promise.all(chunk_promises);
      for (const r of chunk_results) {
        if (r.error) {
          failed++;
          errors.push({ index: r.idx, error: r.error });
          results.push(null);
          if (on_error === "halt") { halted = true; break; }
        } else {
          succeeded++;
          results.push(r.output);
        }
      }
    }

    return { output: { results, total: items.length, succeeded, failed, errors } };
  },

  test(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): OrcheNodeTestResult {
    const n = node as BatchNodeDefinition;
    const warnings: string[] = [];
    if (!n.array_field?.trim()) warnings.push("array_field is required");
    if (!n.body_node?.trim()) warnings.push("body_node is required");
    if ((n.concurrency ?? 0) < 1) warnings.push("concurrency must be at least 1");
    const items = get_array(ctx.memory, n.array_field || "");
    return {
      preview: {
        array_field: n.array_field,
        item_count: items.length,
        concurrency: n.concurrency,
        body_node: n.body_node,
      },
      warnings,
    };
  },
};

function get_array(memory: Record<string, unknown>, path: string): unknown[] {
  const parts = path.split(".");
  let current: unknown = memory;
  for (const p of parts) {
    if (current == null || typeof current !== "object") return [];
    current = (current as Record<string, unknown>)[p];
  }
  return Array.isArray(current) ? current : [];
}
