/** Healthcheck 노드 핸들러 — 워크플로우에서 헬스체크 실행. */

import type { NodeHandler } from "../node-registry.js";
import type { HealthcheckNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";

export const healthcheck_handler: NodeHandler = {
  node_type: "healthcheck",
  icon: "\u{1F3E5}",
  color: "#2e7d32",
  shape: "rect",
  output_schema: [
    { name: "healthy", type: "boolean", description: "Whether target is healthy" },
    { name: "result", type: "unknown", description: "Check details" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "http / tcp / dns / multi / ping" },
    { name: "url", type: "string", description: "URL for HTTP check" },
  ],
  create_default: () => ({ action: "http", url: "", timeout_ms: 5000 }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as HealthcheckNodeDefinition;
    try {
      const { HealthcheckTool } = await import("../tools/healthcheck.js");
      const tool = new HealthcheckTool();
      const tpl = { memory: ctx.memory };
      const result = await tool.execute({
        action: n.action || "http",
        url: n.url ? resolve_templates(n.url, tpl) : undefined,
        host: n.host ? resolve_templates(n.host, tpl) : undefined,
        port: n.port,
        timeout_ms: n.timeout_ms,
        expected_status: n.expected_status,
        endpoints: n.endpoints ? resolve_templates(n.endpoints, tpl) : undefined,
      });
      const parsed = JSON.parse(result);
      return { output: { healthy: parsed.healthy ?? parsed.all_healthy ?? false, result: parsed } };
    } catch {
      return { output: { healthy: false, result: null } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as HealthcheckNodeDefinition;
    const warnings: string[] = [];
    if (n.action === "http" && !n.url) warnings.push("url is required for http check");
    if ((n.action === "tcp" || n.action === "dns") && !n.host) warnings.push("host is required");
    return { preview: { action: n.action, url: n.url, host: n.host }, warnings };
  },
};
