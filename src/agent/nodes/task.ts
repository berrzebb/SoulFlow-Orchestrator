/** Task (태스크 실행) 노드 핸들러. */

import type { NodeHandler } from "../node-registry.js";
import type { TaskNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates, resolve_deep } from "../orche-node-executor.js";

export const task_handler: NodeHandler = {
  node_type: "task",
  icon: "☑",
  color: "#4caf50",
  shape: "rect",
  output_schema: [
    { name: "task_id",   type: "string",  description: "Created task ID" },
    { name: "status",    type: "string",  description: "Task completion status" },
    { name: "result",    type: "object",  description: "Task memory at completion" },
    { name: "exit_reason", type: "string", description: "Exit reason" },
  ],
  input_schema: [
    { name: "task_title", type: "string", description: "Task title" },
    { name: "objective",  type: "string", description: "Task objective" },
    { name: "channel",    type: "string", description: "Execution channel" },
  ],
  create_default: () => ({ task_title: "", objective: "", max_turns: 20 }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as TaskNodeDefinition;
    const tpl_ctx = { memory: ctx.memory };
    const task_title = resolve_templates(n.task_title, tpl_ctx);
    const objective = resolve_templates(n.objective, tpl_ctx);
    const initial_memory = n.initial_memory
      ? resolve_deep(n.initial_memory, tpl_ctx) as Record<string, unknown>
      : {};

    // 실제 TaskLoop 실행은 phase-loop-runner가 TaskLoop를 생성하여 처리.
    return {
      output: {
        task_id: "",
        status: "pending",
        result: {},
        exit_reason: null,
        _meta: {
          task_title,
          objective,
          channel: n.channel,
          chat_id: n.chat_id,
          max_turns: n.max_turns ?? 20,
          initial_memory,
          resolved: true,
        },
      },
    };
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as TaskNodeDefinition;
    const warnings: string[] = [];
    if (!n.task_title) warnings.push("task_title is empty");
    if (!n.objective) warnings.push("objective is empty");
    if ((n.max_turns ?? 20) > 100) warnings.push("max_turns > 100 may be expensive");
    return {
      preview: { task_title: n.task_title, objective: n.objective, max_turns: n.max_turns ?? 20 },
      warnings,
    };
  },
};
