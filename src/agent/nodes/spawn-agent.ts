/** Spawn Agent (에이전트 동적 생성) 노드 핸들러. */

import type { NodeHandler } from "../node-registry.js";
import type { SpawnAgentNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";

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
    role: "assistant",
    await_completion: true,
    max_iterations: 10,
  }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as SpawnAgentNodeDefinition;
    const tpl_ctx = { memory: ctx.memory };
    const task = resolve_templates(n.task, tpl_ctx);

    // 실제 에이전트 스폰은 phase-loop-runner가 SubagentManager를 통해 처리.
    return {
      output: {
        agent_id: "",
        status: "pending",
        result: null,
        _meta: {
          task,
          role: n.role || "assistant",
          model: n.model,
          origin_channel: n.origin_channel,
          origin_chat_id: n.origin_chat_id,
          await_completion: n.await_completion ?? true,
          max_iterations: n.max_iterations ?? 10,
          resolved: true,
        },
      },
    };
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as SpawnAgentNodeDefinition;
    const warnings: string[] = [];
    if (!n.task) warnings.push("task is empty");
    if ((n.max_iterations ?? 10) > 50) warnings.push("max_iterations > 50 may be expensive");
    return {
      preview: {
        task: n.task,
        role: n.role || "assistant",
        model: n.model || "auto",
        await: n.await_completion ?? true,
      },
      warnings,
    };
  },
};
