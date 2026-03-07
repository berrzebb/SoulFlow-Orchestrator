/** TTL Cache 노드 핸들러 — 워크플로우 TTL 캐시 조작. */

import type { NodeHandler } from "../node-registry.js";
import type { TtlCacheNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";
import { error_message } from "../../utils/common.js";

let shared_tool: InstanceType<typeof import("../tools/ttl-cache.js").CacheTool> | null = null;

export const ttl_cache_handler: NodeHandler = {
  node_type: "ttl_cache",
  icon: "\u{26A1}",
  color: "#ff6f00",
  shape: "rect",
  output_schema: [
    { name: "result",  type: "string",  description: "Cache operation result" },
    { name: "success", type: "boolean", description: "Whether operation succeeded" },
  ],
  input_schema: [
    { name: "operation", type: "string", description: "set/get/invalidate/has/keys/stats/clear" },
    { name: "key",       type: "string", description: "Cache key" },
    { name: "value",     type: "string", description: "Value to cache" },
  ],
  create_default: () => ({ operation: "get", key: "", value: "", ttl_ms: 300000 }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as TtlCacheNodeDefinition;
    try {
      if (!shared_tool) {
        const { CacheTool } = await import("../tools/ttl-cache.js");
        shared_tool = new CacheTool();
      }
      const tpl = { memory: ctx.memory };
      const result = await shared_tool.execute({
        operation: n.operation || "get",
        key: resolve_templates(n.key || "", tpl),
        value: resolve_templates(n.value || "", tpl),
        ttl_ms: n.ttl_ms ?? 300000,
      });
      return { output: { result, success: !result.startsWith("Error:") } };
    } catch (err) {
      return { output: { result: error_message(err), success: false } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as TtlCacheNodeDefinition;
    const warnings: string[] = [];
    if ((n.operation === "set" || n.operation === "get") && !n.key?.trim()) warnings.push("key is required");
    return { preview: { operation: n.operation, ttl_ms: n.ttl_ms }, warnings };
  },
};
