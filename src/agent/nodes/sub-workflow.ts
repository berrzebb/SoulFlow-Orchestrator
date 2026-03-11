/** Sub-workflow (하위 워크플로우 호출) 노드 핸들러. */

import type { NodeHandler, RunnerContext } from "../node-registry.js";
import type { SubWorkflowNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_deep } from "../orche-node-executor.js";
import { error_message } from "../../utils/common.js";
import { with_timeout } from "../../utils/timeouts.js";

export const sub_workflow_handler: NodeHandler = {
  node_type: "sub_workflow",
  icon: "↪",
  color: "#673ab7",
  shape: "rect",
  output_schema: [
    { name: "result", type: "object", description: "Sub-workflow final output" },
    { name: "phases", type: "array",  description: "Phase results array" },
  ],
  input_schema: [
    { name: "variables", type: "object", description: "Input variables for sub-workflow" },
  ],
  create_default: () => ({ workflow_name: "" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as SubWorkflowNodeDefinition;
    const tpl_ctx = { memory: ctx.memory };
    const input_mapping = n.input_mapping
      ? resolve_deep(n.input_mapping, tpl_ctx) as Record<string, string>
      : undefined;

    return {
      output: {
        result: null,
        phases: [],
        _meta: {
          workflow_name: n.workflow_name,
          input_mapping,
          timeout_ms: n.timeout_ms,
          resolved: true,
        },
      },
    };
  },

  async runner_execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext, runner: RunnerContext): Promise<OrcheNodeExecuteResult> {
    const n = node as SubWorkflowNodeDefinition;

    if (!runner.run_sub_workflow) {
      return { output: { result: null, phases: [], error: "sub_workflow execution not available in this context" } };
    }

    if (!n.workflow_name?.trim()) {
      return { output: { result: null, phases: [], error: "workflow_name is required" } };
    }

    const tpl_ctx = { memory: ctx.memory };
    const input = n.input_mapping
      ? resolve_deep(n.input_mapping, tpl_ctx) as Record<string, unknown>
      : {};

    runner.emit({
      type: "node_started",
      workflow_id: runner.state.workflow_id,
      node_id: n.node_id,
      node_type: "sub_workflow",
    });

    try {
      const timeout = n.timeout_ms ?? 300_000;
      const result = await with_timeout(
        runner.run_sub_workflow(n.workflow_name, input),
        timeout,
      );
      return { output: { result: result.result, phases: result.phases } };
    } catch (err) {
      runner.logger.warn("sub_workflow_error", { workflow_name: n.workflow_name, error: error_message(err) });
      return { output: { result: null, phases: [], error: error_message(err) } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as SubWorkflowNodeDefinition;
    const warnings: string[] = [];
    if (!n.workflow_name?.trim()) warnings.push("workflow_name is required");
    return { preview: { workflow_name: n.workflow_name, input_mapping: n.input_mapping }, warnings };
  },
};
