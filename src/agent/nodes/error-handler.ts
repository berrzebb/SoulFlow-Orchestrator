/** Error Handler (TryCatch) 노드 핸들러. try_nodes를 래핑하여 에러 시 fallback 실행. */

import type { NodeHandler, RunnerContext } from "../node-registry.js";
import type { ErrorHandlerNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { is_orche_node } from "../workflow-node.types.js";
import { error_message } from "../../utils/common.js";

export const error_handler_handler: NodeHandler = {
  node_type: "error_handler",
  icon: "🛡",
  color: "#f44336",
  shape: "rect",
  output_schema: [
    { name: "has_error",  type: "boolean", description: "Whether an error occurred" },
    { name: "error",      type: "string",  description: "Error message (if any)" },
    { name: "error_node", type: "string",  description: "Node that caused the error" },
    { name: "output",     type: "object",  description: "Successful output (if no error)" },
  ],
  input_schema: [
    { name: "data", type: "object", description: "Pass-through data" },
  ],
  create_default: () => ({ try_nodes: [], on_error: "continue" }),

  async execute(): Promise<OrcheNodeExecuteResult> {
    return { output: { has_error: false, error: "", error_node: "", output: null } };
  },

  async runner_execute(node: OrcheNodeDefinition, _ctx: OrcheNodeExecutorContext, runner: RunnerContext): Promise<OrcheNodeExecuteResult> {
    const n = node as ErrorHandlerNodeDefinition;
    const try_ids = n.try_nodes || [];
    let last_output: unknown = null;

    for (const node_id of try_ids) {
      const target = runner.all_nodes.find((nd) => nd.node_id === node_id);
      if (!target || !is_orche_node(target)) continue;

      try {
        const result = await runner.execute_node(target as OrcheNodeDefinition, {
          memory: runner.state.memory,
          abort_signal: runner.options.abort_signal,
          workspace: undefined,
        });
        runner.state.memory[node_id] = result.output;
        last_output = result.output;

        const target_state = runner.state.orche_states?.find((s) => s.node_id === node_id);
        if (target_state) {
          target_state.status = "completed";
          target_state.result = result.output;
        }
      } catch (err) {
        const error_msg = error_message(err);
        runner.emit({
          type: "node_error",
          workflow_id: runner.state.workflow_id,
          node_id: n.node_id,
          error: `try_node ${node_id} failed: ${error_msg}`,
        });

        if (n.on_error === "fallback" && n.fallback_nodes?.length) {
          return run_fallback(n, node_id, error_msg, runner);
        }

        return { output: { has_error: true, error: error_msg, error_node: node_id, output: null } };
      }
    }

    return { output: { has_error: false, error: "", error_node: "", output: last_output } };
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as ErrorHandlerNodeDefinition;
    const warnings: string[] = [];
    if (!n.try_nodes?.length) warnings.push("try_nodes should contain at least one node");
    if (n.on_error === "fallback" && !n.fallback_nodes?.length) warnings.push("fallback_nodes required when on_error is fallback");
    return { preview: { try_nodes: n.try_nodes, on_error: n.on_error, fallback_nodes: n.fallback_nodes }, warnings };
  },
};

/** fallback_nodes를 순차 실행하고 결과 반환. */
async function run_fallback(
  n: ErrorHandlerNodeDefinition,
  error_node_id: string,
  error_msg: string,
  runner: RunnerContext,
): Promise<OrcheNodeExecuteResult> {
  let fallback_output: unknown = null;

  for (const fb_id of n.fallback_nodes!) {
    const fb_node = runner.all_nodes.find((nd) => nd.node_id === fb_id);
    if (!fb_node || !is_orche_node(fb_node)) continue;

    try {
      const result = await runner.execute_node(fb_node as OrcheNodeDefinition, {
        memory: { ...runner.state.memory, _error: { node_id: error_node_id, message: error_msg } },
        abort_signal: runner.options.abort_signal,
        workspace: undefined,
      });
      runner.state.memory[fb_id] = result.output;
      fallback_output = result.output;
    } catch (fb_err) {
      return { output: { has_error: true, error: `fallback ${fb_id} failed: ${error_message(fb_err)}`, error_node: fb_id, output: null } };
    }
  }

  return { output: { has_error: true, error: error_msg, error_node: error_node_id, output: fallback_output } };
}
