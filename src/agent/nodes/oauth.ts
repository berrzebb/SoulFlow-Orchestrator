/** OAuth (토큰 자동 주입 HTTP) 노드 핸들러. */

import type { NodeHandler } from "../node-registry.js";
import type { OauthNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";

export const oauth_handler: NodeHandler = {
  node_type: "oauth",
  icon: "🔑",
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

  async execute(): Promise<OrcheNodeExecuteResult> {
    // 스텁: 실제 OAuth fetch는 추후 구현
    return { output: { status: 200, body: null, headers: {} } };
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
