/** Send File (파일 전송) 노드 핸들러. */

import type { NodeHandler, RunnerContext } from "../node-registry.js";
import type { SendFileNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates, build_channel_req } from "../orche-node-executor.js";

export const send_file_handler: NodeHandler = {
  node_type: "send_file",
  icon: "📎",
  color: "#00bcd4",
  shape: "rect",
  output_schema: [
    { name: "ok",         type: "boolean", description: "Send success" },
    { name: "message_id", type: "string",  description: "Sent message ID" },
    { name: "file_name",  type: "string",  description: "File name sent" },
  ],
  input_schema: [
    { name: "file_path", type: "string", description: "File path (override)" },
    { name: "channel",   type: "string", description: "Target channel (override)" },
    { name: "chat_id",   type: "string", description: "Target chat ID (override)" },
  ],
  create_default: () => ({ file_path: "", target: "origin" }),

  async execute(): Promise<OrcheNodeExecuteResult> {
    return { output: { ok: true, message_id: "", file_name: "" } };
  },

  async runner_execute(node: OrcheNodeDefinition, _ctx: OrcheNodeExecutorContext, runner: RunnerContext): Promise<OrcheNodeExecuteResult> {
    const n = node as SendFileNodeDefinition;
    const tpl_ctx = { memory: runner.state.memory };
    const file_path = resolve_templates(n.file_path || "", tpl_ctx);
    const caption = resolve_templates(n.caption || "", tpl_ctx);
    const content = caption ? `[file:${file_path}] ${caption}` : `[file:${file_path}]`;

    if (!runner.options.send_message) {
      return { output: { ok: false, message_id: "", file_name: "" } };
    }

    const req = build_channel_req(n.target, content, n.channel, n.chat_id, runner.state);
    const res = await runner.options.send_message(req);
    const file_name = file_path.split("/").pop() || file_path.split("\\").pop() || file_path;
    return { output: { ok: res.ok, message_id: res.message_id ?? "", file_name } };
  },

  test(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): OrcheNodeTestResult {
    const n = node as SendFileNodeDefinition;
    const warnings: string[] = [];
    if (!n.file_path?.trim()) warnings.push("file_path is required");
    const tpl_ctx = { memory: ctx.memory };
    const file_path = resolve_templates(n.file_path || "", tpl_ctx);
    return { preview: { target: n.target, file_path, caption: n.caption }, warnings };
  },
};
