/** Webhook (수신 대기) 노드 핸들러. */

import type { NodeHandler, RunnerContext } from "../node-registry.js";
import type { WebhookNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { error_message } from "../../utils/common.js";

export const webhook_handler: NodeHandler = {
  node_type: "webhook",
  icon: "\u{1FA9D}",
  color: "#ff9800",
  shape: "rect",
  output_schema: [
    { name: "method",  type: "string", description: "HTTP method of incoming request" },
    { name: "headers", type: "object", description: "Request headers" },
    { name: "body",    type: "object", description: "Request body" },
    { name: "query",   type: "object", description: "Query parameters" },
  ],
  input_schema: [],
  create_default: () => ({ path: "", http_method: "POST", response_mode: "immediate" }),

  async execute(): Promise<OrcheNodeExecuteResult> {
    return { output: { method: "POST", headers: {}, body: {}, query: {} } };
  },

  async runner_execute(node: OrcheNodeDefinition, _ctx: OrcheNodeExecutorContext, runner: RunnerContext): Promise<OrcheNodeExecuteResult> {
    const get_data = runner.services?.get_webhook_data;
    if (!get_data) return this.execute(node, _ctx);

    const n = node as WebhookNodeDefinition;
    const path = n.path?.trim();
    if (!path) {
      return { output: { method: "", headers: {}, body: {}, query: {}, error: "path is required" } };
    }

    try {
      const data = await get_data(path);
      if (!data) {
        return { output: { method: "", headers: {}, body: {}, query: {}, waiting: true } };
      }
      return { output: { method: data.method, headers: data.headers, body: data.body, query: data.query } };
    } catch (err) {
      runner.logger.warn("webhook_node_error", { node_id: n.node_id, error: error_message(err) });
      return { output: { method: "", headers: {}, body: {}, query: {}, error: error_message(err) } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as WebhookNodeDefinition;
    const warnings: string[] = [];
    if (!n.path?.trim()) warnings.push("path is required");
    if (n.path && !n.path.startsWith("/")) warnings.push("path should start with /");
    return { preview: { path: n.path, method: n.http_method, response_mode: n.response_mode }, warnings };
  },
};
