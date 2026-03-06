/** Tool Invoke (동적 도구 호출) 노드 핸들러. 런타임에 도구 ID를 결정하여 실행. */

import type { NodeHandler, RunnerContext } from "../node-registry.js";
import type { ToolInvokeNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates, resolve_deep } from "../orche-node-executor.js";
import { error_message } from "../../utils/common.js";

export const tool_invoke_handler: NodeHandler = {
  node_type: "tool_invoke",
  icon: "🔧",
  color: "#795548",
  shape: "rect",
  output_schema: [
    { name: "result",    type: "unknown", description: "Tool execution result" },
    { name: "tool_id",   type: "string",  description: "Resolved tool ID" },
    { name: "duration",  type: "number",  description: "Execution duration (ms)" },
    { name: "ok",        type: "boolean", description: "Whether execution succeeded" },
    { name: "error",     type: "string",  description: "Error message if failed" },
  ],
  input_schema: [
    { name: "tool_id", type: "string", description: "Tool ID (override)" },
    { name: "params",  type: "object", description: "Tool parameters (override)" },
  ],
  create_default: () => ({
    tool_id: "",
    params: {},
    timeout_ms: 30_000,
  }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as ToolInvokeNodeDefinition;
    const tpl_ctx = { memory: ctx.memory };
    const tool_id = resolve_templates(n.tool_id || "", tpl_ctx);

    if (!tool_id) {
      return { output: { result: null, tool_id: "", duration: 0, ok: false, error: "tool_id is empty" } };
    }

    return { output: { result: null, tool_id, duration: 0, ok: true, error: "" } };
  },

  async runner_execute(node: OrcheNodeDefinition, _ctx: OrcheNodeExecutorContext, runner: RunnerContext): Promise<OrcheNodeExecuteResult> {
    const n = node as ToolInvokeNodeDefinition;
    const tpl_ctx = { memory: runner.state.memory };
    const tool_id = resolve_templates(n.tool_id || "", tpl_ctx);
    const params = resolve_deep(n.params || {}, tpl_ctx) as Record<string, unknown>;

    if (!tool_id) {
      return { output: { result: null, tool_id: "", duration: 0, ok: false, error: "tool_id is empty" } };
    }

    if (!runner.options.invoke_tool) {
      runner.logger.warn("tool_invoke_no_callback", { node_id: n.node_id, tool_id });
      return { output: { result: null, tool_id, duration: 0, ok: false, error: "invoke_tool callback not provided" } };
    }

    const start = Date.now();
    try {
      const result = await runner.options.invoke_tool(tool_id, params);
      return { output: { result, tool_id, duration: Date.now() - start, ok: true, error: "" } };
    } catch (err) {
      return { output: { result: null, tool_id, duration: Date.now() - start, ok: false, error: error_message(err) } };
    }
  },

  test(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): OrcheNodeTestResult {
    const n = node as ToolInvokeNodeDefinition;
    const warnings: string[] = [];
    if (!n.tool_id?.trim()) warnings.push("tool_id is required");
    const tpl_ctx = { memory: ctx.memory };
    const tool_id = resolve_templates(n.tool_id || "", tpl_ctx);
    return {
      preview: { tool_id, params: n.params, timeout_ms: n.timeout_ms },
      warnings,
    };
  },
};
