/** Notify (채널 메시지 전송) 노드 핸들러. */

import type { NodeHandler, RunnerContext } from "../node-registry.js";
import type { NotifyNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates, build_channel_req } from "../orche-node-executor.js";

export const notify_handler: NodeHandler = {
  node_type: "notify",
  icon: "📢",
  color: "#4caf50",
  shape: "rect",
  output_schema: [
    { name: "ok",         type: "boolean", description: "Send success" },
    { name: "message_id", type: "string",  description: "Sent message ID" },
  ],
  input_schema: [
    { name: "content", type: "string", description: "Message content (override)" },
    { name: "channel", type: "string", description: "Target channel (override)" },
    { name: "chat_id", type: "string", description: "Target chat ID (override)" },
  ],
  create_default: () => ({ content: "", target: "origin" }),

  async execute(): Promise<OrcheNodeExecuteResult> {
    return { output: { ok: true, message_id: "" } };
  },

  async runner_execute(node: OrcheNodeDefinition, _ctx: OrcheNodeExecutorContext, runner: RunnerContext): Promise<OrcheNodeExecuteResult> {
    const n = node as NotifyNodeDefinition;
    const tpl_ctx = { memory: runner.state.memory };
    const content = resolve_templates(n.content || "", tpl_ctx);

    if (!runner.options.send_message) {
      return { output: { ok: false, message_id: "" } };
    }

    const req = build_channel_req(n.target, content, n.channel, n.chat_id, runner.state, undefined, n.parse_mode);
    const res = await runner.options.send_message(req);
    return { output: { ok: res.ok, message_id: res.message_id ?? "" } };
  },

  test(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): OrcheNodeTestResult {
    const n = node as NotifyNodeDefinition;
    const warnings: string[] = [];
    if (!n.content?.trim()) warnings.push("content is required");
    const tpl_ctx = { memory: ctx.memory };
    const content = resolve_templates(n.content || "", tpl_ctx);
    return { preview: { target: n.target, channel: n.channel, content: content.slice(0, 100) }, warnings };
  },
};
