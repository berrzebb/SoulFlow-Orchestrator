/** Rate Limit 노드 핸들러 — 워크플로우에서 속도 제한 적용. */

import type { NodeHandler } from "../node-registry.js";
import type { RateLimitNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";

export const rate_limit_handler: NodeHandler = {
  node_type: "rate_limit",
  icon: "\u{23F1}",
  color: "#795548",
  shape: "diamond",
  output_schema: [
    { name: "allowed", type: "boolean", description: "Whether request is allowed" },
    { name: "remaining", type: "number", description: "Remaining tokens/requests" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "check / consume" },
    { name: "key", type: "string", description: "Rate limit bucket key" },
  ],
  create_default: () => ({ action: "consume", key: "", max_requests: 60, window_ms: 60000 }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as RateLimitNodeDefinition;
    try {
      const { RateLimitTool } = await import("../tools/rate-limit.js");
      const tool = new RateLimitTool();
      const tpl = { memory: ctx.memory };
      const result = await tool.execute({
        action: n.action || "consume",
        key: resolve_templates(n.key || "default", tpl),
        max_requests: n.max_requests || 60,
        window_ms: n.window_ms || 60000,
      });
      const parsed = JSON.parse(result);
      return { output: { allowed: parsed.allowed ?? parsed.consumed ?? false, remaining: parsed.remaining ?? 0 } };
    } catch {
      return { output: { allowed: false, remaining: 0 } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as RateLimitNodeDefinition;
    const warnings: string[] = [];
    if (!n.key) warnings.push("key is required");
    return { preview: { action: n.action, key: n.key, max_requests: n.max_requests }, warnings };
  },
};
