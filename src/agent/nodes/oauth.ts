/** OAuth (토큰 자동 주입 HTTP) 노드 핸들러. */

import type { NodeHandler, RunnerContext } from "../node-registry.js";
import type { OauthNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates, resolve_deep } from "../orche-node-executor.js";
import { error_message } from "../../utils/common.js";

export const oauth_handler: NodeHandler = {
  node_type: "oauth",
  icon: "\u{1F511}",
  color: "#ff5722",
  shape: "rect",
  output_schema: [
    { name: "status",  type: "number", description: "HTTP status code" },
    { name: "body",    type: "object", description: "Response body" },
    { name: "headers", type: "object", description: "Response headers" },
  ],
  input_schema: [
    { name: "url",     type: "string", description: "Request URL (override)" },
    { name: "headers", type: "object", description: "Additional headers" },
    { name: "body",    type: "object", description: "Request body" },
  ],
  create_default: () => ({ service_id: "", url: "", method: "GET" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as OauthNodeDefinition;
    const tpl_ctx = { memory: ctx.memory };
    const url = resolve_templates(n.url || "", tpl_ctx);
    return {
      output: {
        status: 0, body: null, headers: {},
        _meta: { service_id: n.service_id, method: n.method, url, resolved: true },
      },
    };
  },

  async runner_execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext, runner: RunnerContext): Promise<OrcheNodeExecuteResult> {
    const oauth_fetch = runner.services?.oauth_fetch;
    if (!oauth_fetch) return this.execute(node, ctx);

    const n = node as OauthNodeDefinition;
    const tpl_ctx = { memory: ctx.memory };
    const url = resolve_templates(n.url || "", tpl_ctx);
    const method = n.method || "GET";
    const headers = n.headers
      ? resolve_deep(n.headers, tpl_ctx) as Record<string, string>
      : undefined;
    const body = n.body ? resolve_deep(n.body, tpl_ctx) : undefined;

    if (!n.service_id?.trim()) {
      return { output: { status: 0, body: null, headers: {}, error: "service_id is required" } };
    }
    if (!url) {
      return { output: { status: 0, body: null, headers: {}, error: "url is required" } };
    }

    try {
      const result = await oauth_fetch(n.service_id, { url, method, headers, body });
      return { output: { status: result.status, body: result.body, headers: result.headers } };
    } catch (err) {
      runner.logger.warn("oauth_node_error", { node_id: n.node_id, error: error_message(err) });
      return { output: { status: 0, body: null, headers: {}, error: error_message(err) } };
    }
  },

  test(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): OrcheNodeTestResult {
    const n = node as OauthNodeDefinition;
    const warnings: string[] = [];
    if (!n.service_id?.trim()) warnings.push("service_id is required");
    if (!n.url?.trim()) warnings.push("url is required");
    const tpl_ctx = { memory: ctx.memory };
    const url = resolve_templates(n.url || "", tpl_ctx);
    return { preview: { service_id: n.service_id, method: n.method, url }, warnings };
  },
};
