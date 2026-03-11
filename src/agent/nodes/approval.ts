/** Approval (승인/거절) 노드 핸들러. 버튼 기반 이진 결정 + 다중 승인자. */

import type { NodeHandler, RunnerContext } from "../node-registry.js";
import type { ApprovalNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates, build_channel_req } from "../orche-node-executor.js";
import { now_iso } from "../../utils/common.js";

export const approval_handler: NodeHandler = {
  node_type: "approval",
  icon: "✅",
  color: "#4caf50",
  shape: "rect",
  output_schema: [
    { name: "approved",     type: "boolean", description: "Whether approved" },
    { name: "comment",      type: "string",  description: "Approver comment" },
    { name: "approved_by",  type: "object",  description: "Approver info" },
    { name: "approved_at",  type: "string",  description: "Decision timestamp" },
    { name: "votes",        type: "array",   description: "All votes (multi-approver)" },
  ],
  input_schema: [
    { name: "message", type: "string", description: "Approval message (override)" },
    { name: "context", type: "object", description: "Additional context data" },
  ],
  create_default: () => ({
    message: "",
    target: "origin" as const,
    require_comment: false,
    quorum: 1,
    timeout_ms: 600_000,
  }),

  async execute(): Promise<OrcheNodeExecuteResult> {
    return {
      output: { approved: false, comment: "", approved_by: null, approved_at: now_iso(), votes: [] },
    };
  },

  async runner_execute(node: OrcheNodeDefinition, _ctx: OrcheNodeExecutorContext, runner: RunnerContext): Promise<OrcheNodeExecuteResult> {
    const n = node as ApprovalNodeDefinition;
    const tpl_ctx = { memory: runner.state.memory };
    const message = resolve_templates(n.message || "", tpl_ctx);

    if (!runner.options.ask_channel) {
      runner.logger.warn("approval_no_ask_channel", { node_id: n.node_id });
      return { output: { approved: false, comment: "", approved_by: null, approved_at: now_iso(), votes: [] } };
    }

    runner.emit({ type: "node_waiting", workflow_id: runner.state.workflow_id, node_id: n.node_id, node_type: "approval", reason: "waiting_approval" });

    const req = build_channel_req(n.target, message, n.channel, n.chat_id, runner.state, {
      type: "approval",
      payload: { quorum: n.quorum ?? 1, require_comment: n.require_comment ?? false },
    });
    const res = await runner.options.ask_channel(req, n.timeout_ms ?? 600_000);

    return {
      output: {
        approved: res.approved ?? false,
        comment: res.comment ?? "",
        approved_by: res.responded_by ?? null,
        approved_at: res.responded_at,
        votes: res.votes ?? [],
      },
    };
  },

  test(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): OrcheNodeTestResult {
    const n = node as ApprovalNodeDefinition;
    const warnings: string[] = [];
    if (!n.message?.trim()) warnings.push("message is required");
    if (n.target === "specified" && !n.channel) warnings.push("channel is required when target is 'specified'");
    if ((n.quorum ?? 1) < 1) warnings.push("quorum must be at least 1");
    const tpl_ctx = { memory: ctx.memory };
    const message = resolve_templates(n.message || "", tpl_ctx);
    return {
      preview: { target: n.target, quorum: n.quorum, message: message.slice(0, 100) },
      warnings,
    };
  },
};
