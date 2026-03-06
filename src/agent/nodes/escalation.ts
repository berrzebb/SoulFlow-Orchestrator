/** Escalation (자동 에스컬레이션) 노드 핸들러. 조건 충족 시 상위 채널/사용자에게 알림. */

import type { NodeHandler, RunnerContext } from "../node-registry.js";
import type { EscalationNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";
import { now_iso } from "../../utils/common.js";
import { createContext, runInNewContext } from "node:vm";
import type { ChannelSendRequest } from "../phase-loop.types.js";

export const escalation_handler: NodeHandler = {
  node_type: "escalation",
  icon: "🚨",
  color: "#f44336",
  shape: "rect",
  output_schema: [
    { name: "escalated",    type: "boolean", description: "Whether escalation was triggered" },
    { name: "escalated_to", type: "object",  description: "Escalation target info" },
    { name: "escalated_at", type: "string",  description: "Escalation timestamp" },
    { name: "reason",       type: "string",  description: "Escalation reason" },
  ],
  input_schema: [
    { name: "trigger_data", type: "object", description: "Data that triggered escalation" },
    { name: "context",      type: "object", description: "Additional context" },
  ],
  create_default: () => ({
    condition: "always" as const,
    message: "",
    target_channel: "",
    target_chat_id: "",
    priority: "high" as const,
  }),

  async execute(): Promise<OrcheNodeExecuteResult> {
    return {
      output: { escalated: false, escalated_to: null, escalated_at: new Date().toISOString(), reason: "" },
    };
  },

  async runner_execute(node: OrcheNodeDefinition, _ctx: OrcheNodeExecutorContext, runner: RunnerContext): Promise<OrcheNodeExecuteResult> {
    const n = node as EscalationNodeDefinition;
    const should_escalate = evaluate_condition(n, runner.state.memory);

    if (!should_escalate) {
      return { output: { escalated: false, escalated_to: null, escalated_at: now_iso(), reason: "condition_not_met" } };
    }

    const tpl_ctx = { memory: runner.state.memory };
    const message = resolve_templates(n.message || "", tpl_ctx);

    if (!runner.options.send_message) {
      runner.logger.warn("escalation_no_send_message", { node_id: n.node_id });
      return { output: { escalated: false, escalated_to: null, escalated_at: now_iso(), reason: "no_send_callback" } };
    }

    const req: ChannelSendRequest = {
      target: "specified",
      channel: n.target_channel,
      chat_id: n.target_chat_id,
      content: `[ESCALATION:${n.priority ?? "high"}] ${message}`,
    };
    await runner.options.send_message(req);

    return {
      output: {
        escalated: true,
        escalated_to: { channel: n.target_channel, chat_id: n.target_chat_id },
        escalated_at: now_iso(),
        reason: n.condition,
      },
    };
  },

  test(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): OrcheNodeTestResult {
    const n = node as EscalationNodeDefinition;
    const warnings: string[] = [];
    if (!n.message?.trim()) warnings.push("message is required");
    if (!n.target_channel?.trim()) warnings.push("target_channel is required");
    const tpl_ctx = { memory: ctx.memory };
    const message = resolve_templates(n.message || "", tpl_ctx);
    return {
      preview: { condition: n.condition, priority: n.priority, target_channel: n.target_channel, message: message.slice(0, 100) },
      warnings,
    };
  },
};

function evaluate_condition(node: EscalationNodeDefinition, memory: Record<string, unknown>): boolean {
  switch (node.condition) {
    case "always": return true;
    case "on_timeout": {
      for (const dep_id of node.depends_on ?? []) {
        const dep_out = memory[dep_id];
        if (dep_out && typeof dep_out === "object" && (dep_out as Record<string, unknown>).timed_out === true) return true;
      }
      return false;
    }
    case "on_rejection": {
      for (const dep_id of node.depends_on ?? []) {
        const dep_out = memory[dep_id];
        if (dep_out && typeof dep_out === "object" && (dep_out as Record<string, unknown>).approved === false) return true;
      }
      return false;
    }
    case "custom": {
      if (!node.custom_expression) return false;
      try {
        const sandbox = createContext({ memory });
        return Boolean(runInNewContext(node.custom_expression, sandbox, { timeout: 1_000 }));
      } catch { return false; }
    }
    default: return false;
  }
}
