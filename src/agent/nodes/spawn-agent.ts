/** Spawn Agent (에이전트 동적 생성) 노드 핸들러. */

import type { NodeHandler, RunnerContext } from "../node-registry.js";
import type { SpawnAgentNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";
import { error_message } from "../../utils/common.js";

export const spawn_agent_handler: NodeHandler = {
  node_type: "spawn_agent",
  icon: "⚡",
  color: "#ff9800",
  shape: "rect",
  output_schema: [
    { name: "agent_id", type: "string", description: "Spawned agent ID" },
    { name: "status",   type: "string", description: "Agent status" },
    { name: "result",   type: "string", description: "Agent result (if awaited)" },
  ],
  input_schema: [
    { name: "task",  type: "string", description: "Task for the agent" },
    { name: "role",  type: "string", description: "Agent role" },
    { name: "model", type: "string", description: "LLM model" },
  ],
  create_default: () => ({
    task: "",
    role: "generalist",
    await_completion: true,
    max_iterations: 10,
  }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as SpawnAgentNodeDefinition;
    const tpl_ctx = { memory: ctx.memory };
    const task = resolve_templates(n.task, tpl_ctx);

    return {
      output: {
        agent_id: "",
        status: "pending",
        result: null,
        _meta: {
          task, role: n.role || "generalist", model: n.model,
          origin_channel: n.origin_channel, origin_chat_id: n.origin_chat_id,
          await_completion: n.await_completion ?? true,
          max_iterations: n.max_iterations ?? 10, resolved: true,
        },
      },
    };
  },

  async runner_execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext, runner: RunnerContext): Promise<OrcheNodeExecuteResult> {
    const spawn = runner.services?.spawn_agent;
    if (!spawn) return this.execute(node, ctx);

    const n = node as SpawnAgentNodeDefinition;
    const tpl_ctx = { memory: ctx.memory };
    const task = resolve_templates(n.task, tpl_ctx);
    const should_await = n.await_completion ?? true;

    try {
      const { agent_id, status } = await spawn({
        task,
        role: n.role || "generalist",
        model: n.model,
        max_iterations: n.max_iterations ?? 10,
        origin_channel: n.origin_channel || runner.state.channel,
        origin_chat_id: n.origin_chat_id || runner.state.chat_id,
        parent_id: `workflow:${runner.state.workflow_id}`,
      });

      if (!should_await) {
        return { output: { agent_id, status, result: null } };
      }

      const wait = runner.services?.wait_agent;
      if (!wait) {
        return { output: { agent_id, status, result: null } };
      }

      const completion = await wait(agent_id, (n.max_iterations ?? 10) * 30_000);
      return {
        output: {
          agent_id,
          status: completion.status,
          result: completion.result ?? completion.error ?? null,
        },
      };
    } catch (err) {
      runner.logger.warn("spawn_agent_node_error", { node_id: n.node_id, error: error_message(err) });
      return { output: { agent_id: "", status: "failed", result: null, error: error_message(err) } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as SpawnAgentNodeDefinition;
    const warnings: string[] = [];
    if (!n.task) warnings.push("task is empty");
    if ((n.max_iterations ?? 10) > 50) warnings.push("max_iterations > 50 may be expensive");
    return {
      preview: {
        task: n.task,
        role: n.role || "generalist",
        model: n.model || "auto",
        await: n.await_completion ?? true,
      },
      warnings,
    };
  },
};
