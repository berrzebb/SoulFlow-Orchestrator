/** HITL (Human-in-the-Loop) 노드 핸들러. 채널로 사용자에게 질문하고 응답을 수신. */

import type { NodeHandler, RunnerContext } from "../node-registry.js";
import type { HitlNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates, build_channel_req } from "../orche-node-executor.js";
import { now_iso } from "../../utils/common.js";

export const hitl_handler: NodeHandler = {
  node_type: "hitl",
  icon: "🙋",
  color: "#e91e63",
  shape: "rect",
  output_schema: [
    { name: "response",   type: "string",  description: "User response text" },
    { name: "responded_by", type: "object", description: "Responder info (user, channel)" },
    { name: "responded_at", type: "string", description: "Response timestamp" },
    { name: "timed_out",  type: "boolean", description: "Whether the request timed out" },
  ],
  input_schema: [
    { name: "prompt",  type: "string", description: "Question to ask (override)" },
    { name: "context", type: "object", description: "Additional context data" },
  ],
  create_default: () => ({
    prompt: "",
    target: "origin" as const,
    timeout_ms: 300_000,
  }),

  async execute(): Promise<OrcheNodeExecuteResult> {
    return {
      output: { response: "", responded_by: null, responded_at: new Date().toISOString(), timed_out: false },
    };
  },

  async runner_execute(node: OrcheNodeDefinition, _ctx: OrcheNodeExecutorContext, runner: RunnerContext): Promise<OrcheNodeExecuteResult> {
    const n = node as HitlNodeDefinition;
    const tpl_ctx = { memory: runner.state.memory };
    const prompt = resolve_templates(n.prompt || "", tpl_ctx);
    const timeout = n.timeout_ms ?? 300_000;

    if (!runner.options.ask_channel) {
      runner.logger.warn("hitl_no_ask_channel", { node_id: n.node_id });
      return { output: { response: n.fallback_value ?? "", responded_by: null, responded_at: now_iso(), timed_out: true } };
    }

    runner.emit({ type: "node_waiting", workflow_id: runner.state.workflow_id, node_id: n.node_id, node_type: "hitl", reason: "waiting_user_response" });

    const req = build_channel_req(n.target, prompt, n.channel, n.chat_id, runner.state);
    const res = await runner.options.ask_channel(req, timeout);

    if (res.timed_out && n.fallback_value !== undefined) {
      return { output: { response: n.fallback_value, responded_by: null, responded_at: now_iso(), timed_out: true } };
    }

    return {
      output: { response: res.response, responded_by: res.responded_by ?? null, responded_at: res.responded_at, timed_out: res.timed_out },
    };
  },

  test(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): OrcheNodeTestResult {
    const n = node as HitlNodeDefinition;
    const warnings: string[] = [];
    if (!n.prompt?.trim()) warnings.push("prompt is required");
    if (n.target === "specified" && !n.channel) warnings.push("channel is required when target is 'specified'");
    const tpl_ctx = { memory: ctx.memory };
    const prompt = resolve_templates(n.prompt || "", tpl_ctx);
    return {
      preview: { target: n.target, channel: n.channel, prompt: prompt.slice(0, 100), timeout_ms: n.timeout_ms },
      warnings,
    };
  },
};
