/** Form (구조화 입력 수집) 노드 핸들러. 스키마 기반 필드를 채널에 렌더링. */

import type { NodeHandler, RunnerContext } from "../node-registry.js";
import type { FormNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates, build_channel_req } from "../orche-node-executor.js";
import { now_iso } from "../../utils/common.js";

export const form_handler: NodeHandler = {
  node_type: "form",
  icon: "📋",
  color: "#ff9800",
  shape: "rect",
  output_schema: [
    { name: "fields",       type: "object",  description: "Submitted field values" },
    { name: "submitted_by", type: "object",  description: "Submitter info" },
    { name: "submitted_at", type: "string",  description: "Submission timestamp" },
    { name: "timed_out",    type: "boolean", description: "Whether the form timed out" },
  ],
  input_schema: [
    { name: "prefill", type: "object", description: "Pre-fill values (override)" },
    { name: "context", type: "object", description: "Additional context data" },
  ],
  create_default: () => ({
    title: "",
    description: "",
    target: "origin" as const,
    fields: [] as Array<Record<string, unknown>>,
    timeout_ms: 600_000,
  }),

  async execute(): Promise<OrcheNodeExecuteResult> {
    return {
      output: { fields: {}, submitted_by: null, submitted_at: now_iso(), timed_out: false },
    };
  },

  async runner_execute(node: OrcheNodeDefinition, _ctx: OrcheNodeExecutorContext, runner: RunnerContext): Promise<OrcheNodeExecuteResult> {
    const n = node as FormNodeDefinition;
    const tpl_ctx = { memory: runner.state.memory };
    const title = resolve_templates(n.title || "", tpl_ctx);
    const description = resolve_templates(n.description || "", tpl_ctx);

    if (!runner.options.ask_channel) {
      runner.logger.warn("form_no_ask_channel", { node_id: n.node_id });
      return { output: { fields: {}, submitted_by: null, submitted_at: now_iso(), timed_out: true } };
    }

    runner.emit({ type: "node_waiting", workflow_id: runner.state.workflow_id, node_id: n.node_id, node_type: "form", reason: "waiting_form_submission" });

    const req = build_channel_req(n.target, `${title}\n${description}`, n.channel, n.chat_id, runner.state, {
      type: "form",
      payload: { title, description, fields: n.fields },
    });
    const res = await runner.options.ask_channel(req, n.timeout_ms ?? 600_000);

    return {
      output: { fields: res.fields ?? {}, submitted_by: res.responded_by ?? null, submitted_at: res.responded_at, timed_out: res.timed_out },
    };
  },

  test(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): OrcheNodeTestResult {
    const n = node as FormNodeDefinition;
    const warnings: string[] = [];
    if (!n.fields?.length) warnings.push("at least one field is required");
    for (const f of n.fields || []) {
      if (!f.name?.trim()) warnings.push("field name is required");
    }
    if (n.target === "specified" && !n.channel) warnings.push("channel is required when target is 'specified'");
    const tpl_ctx = { memory: ctx.memory };
    const title = resolve_templates(n.title || "", tpl_ctx);
    return {
      preview: { target: n.target, title, field_count: (n.fields || []).length },
      warnings,
    };
  },
};
