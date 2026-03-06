/** Retry (재시도) 노드 핸들러. 실패 노드를 backoff 전략으로 재실행. */

import type { NodeHandler, RunnerContext } from "../node-registry.js";
import type { RetryNodeDefinition, BackoffStrategy, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { now_iso, error_message } from "../../utils/common.js";
import { is_orche_node } from "../workflow-node.types.js";

export const retry_handler: NodeHandler = {
  node_type: "retry",
  icon: "🔄",
  color: "#ff5722",
  shape: "rect",
  output_schema: [
    { name: "result",      type: "unknown", description: "Final result (success or last attempt)" },
    { name: "attempts",    type: "number",  description: "Total attempts made" },
    { name: "succeeded",   type: "boolean", description: "Whether any attempt succeeded" },
    { name: "last_error",  type: "string",  description: "Last error message" },
  ],
  input_schema: [
    { name: "target_output", type: "unknown", description: "Output from target node" },
    { name: "target_error",  type: "string",  description: "Error from target node" },
  ],
  create_default: () => ({
    target_node: "",
    max_attempts: 3,
    backoff: "exponential" as const,
    initial_delay_ms: 1000,
    max_delay_ms: 30_000,
  }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as RetryNodeDefinition;
    const target = n.target_node || (n.depends_on || [])[0] || "";
    const result = target ? (ctx.memory as Record<string, unknown>)[target] : null;
    return {
      output: { result, attempts: 1, succeeded: result !== undefined, last_error: "" },
    };
  },

  async runner_execute(node: OrcheNodeDefinition, _ctx: OrcheNodeExecutorContext, runner: RunnerContext): Promise<OrcheNodeExecuteResult> {
    const n = node as RetryNodeDefinition;
    const target_id = n.target_node || (n.depends_on ?? [])[0] || "";
    const target_node = runner.all_nodes.find((nd) => nd.node_id === target_id);

    if (!target_node || !is_orche_node(target_node)) {
      return { output: { result: null, attempts: 0, succeeded: false, last_error: `target node not found: ${target_id}` } };
    }

    const max = n.max_attempts || 3;
    const backoff = n.backoff || "exponential";
    const initial = n.initial_delay_ms ?? 1000;
    const max_delay = n.max_delay_ms ?? 30_000;
    let last_error = "";

    for (let attempt = 1; attempt <= max; attempt++) {
      try {
        const target_state = runner.state.orche_states?.find((s) => s.node_id === target_id);
        if (target_state) {
          target_state.status = "running";
          target_state.error = undefined;
          target_state.result = undefined;
        }

        const result = await runner.execute_node(target_node as OrcheNodeDefinition, {
          memory: runner.state.memory,
          abort_signal: runner.options.abort_signal,
          workspace: undefined,
        });

        runner.state.memory[target_id] = result.output;
        if (target_state) {
          target_state.status = "completed";
          target_state.result = result.output;
          target_state.completed_at = now_iso();
        }

        return { output: { result: result.output, attempts: attempt, succeeded: true, last_error: "" } };
      } catch (err) {
        last_error = error_message(err);
        runner.emit({
          type: "node_retry",
          workflow_id: runner.state.workflow_id,
          node_id: n.node_id,
          attempt,
          max_attempts: max,
          error: last_error,
        });

        if (attempt < max) {
          const delay = compute_backoff_delay(backoff, attempt, initial, max_delay);
          await sleep(delay);
        }
      }
    }

    return { output: { result: null, attempts: max, succeeded: false, last_error } };
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as RetryNodeDefinition;
    const warnings: string[] = [];
    if (!n.target_node?.trim() && !(n.depends_on || []).length) {
      warnings.push("target_node or depends_on is required");
    }
    if ((n.max_attempts ?? 0) < 1) warnings.push("max_attempts must be at least 1");
    if ((n.initial_delay_ms ?? 0) <= 0) warnings.push("initial_delay_ms should be positive");
    return {
      preview: {
        target_node: n.target_node,
        max_attempts: n.max_attempts,
        backoff: n.backoff,
        initial_delay_ms: n.initial_delay_ms,
      },
      warnings,
    };
  },
};

function compute_backoff_delay(strategy: BackoffStrategy, attempt: number, initial: number, max_delay: number): number {
  let delay: number;
  switch (strategy) {
    case "exponential": delay = initial * Math.pow(2, attempt - 1); break;
    case "linear":      delay = initial * attempt; break;
    case "fixed":       delay = initial; break;
    default:            delay = initial;
  }
  return Math.min(delay, max_delay);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
