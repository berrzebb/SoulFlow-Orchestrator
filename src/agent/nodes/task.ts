/** Task (태스크 실행) 노드 핸들러. */

import type { NodeHandler, RunnerContext } from "../node-registry.js";
import type { TaskNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates, resolve_deep } from "../orche-node-executor.js";
import { error_message } from "../../utils/common.js";

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

    return {
      output: {
        task_id: "", status: "pending", result: {}, exit_reason: null,
        _meta: {
          task_title, objective, channel: n.channel, chat_id: n.chat_id,
          max_turns: n.max_turns ?? 20, initial_memory, resolved: true,
        },
      },
    };
  },

  async runner_execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext, runner: RunnerContext): Promise<OrcheNodeExecuteResult> {
    const create = runner.services?.create_task;
    if (!create) return this.execute(node, ctx);

    const n = node as TaskNodeDefinition;
    const tpl_ctx = { memory: ctx.memory };
    const task_title = resolve_templates(n.task_title, tpl_ctx);
    const objective = resolve_templates(n.objective, tpl_ctx);
    const initial_memory = n.initial_memory
      ? resolve_deep(n.initial_memory, tpl_ctx) as Record<string, unknown>
      : {};

    try {
      const result = await create({
        title: task_title,
        objective,
        channel: n.channel || runner.state.channel,
        chat_id: n.chat_id || runner.state.chat_id,
        max_turns: n.max_turns ?? 20,
        initial_memory,
      });
      return {
        output: {
          task_id: result.task_id,
          status: result.status,
          result: result.result ?? {},
          exit_reason: result.error ?? null,
        },
      };
    } catch (err) {
      runner.logger.warn("task_node_error", { node_id: n.node_id, error: error_message(err) });
      return { output: { task_id: "", status: "failed", result: {}, exit_reason: error_message(err) } };
    }
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
