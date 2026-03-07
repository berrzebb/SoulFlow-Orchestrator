/** Redis 노드 핸들러 — 워크플로우에서 Redis 키-값 연산. */

import type { NodeHandler } from "../node-registry.js";
import type { RedisNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";

export const redis_handler: NodeHandler = {
  node_type: "redis",
  icon: "\u{1F534}",
  color: "#dc382d",
  shape: "rect",
  output_schema: [
    { name: "result", type: "unknown", description: "Redis operation result" },
    { name: "success", type: "boolean", description: "Whether operation succeeded" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "get / set / del / keys / info / ..." },
    { name: "host", type: "string", description: "Redis host" },
    { name: "key", type: "string", description: "Redis key" },
  ],
  create_default: () => ({ action: "get", host: "localhost", port: 6379, key: "" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as RedisNodeDefinition;
    try {
      const { RedisTool } = await import("../tools/redis.js");
      const tool = new RedisTool();
      const tpl = { memory: ctx.memory };
      const result = await tool.execute({
        action: n.action || "get",
        host: resolve_templates(n.host || "localhost", tpl),
        port: n.port || 6379,
        key: n.key ? resolve_templates(n.key, tpl) : undefined,
        value: n.value ? resolve_templates(n.value, tpl) : undefined,
        field: n.field ? resolve_templates(n.field, tpl) : undefined,
        password: n.password ? resolve_templates(n.password, tpl) : undefined,
        ttl: n.ttl,
      });
      const parsed = result.startsWith("{") ? JSON.parse(result) : { data: result };
      return { output: { result: parsed, success: parsed.success !== false } };
    } catch {
      return { output: { result: null, success: false } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as RedisNodeDefinition;
    const warnings: string[] = [];
    if (!n.host) warnings.push("host is required");
    return { preview: { action: n.action, host: n.host, key: n.key }, warnings };
  },
};
