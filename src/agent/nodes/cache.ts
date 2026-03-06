/** Cache (결과 캐싱) 노드 핸들러. TTL 기반 키-값 캐시로 중복 실행 방지. */

import type { NodeHandler } from "../node-registry.js";
import type { CacheNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";

/** 인메모리 캐시. 프로세스 수명 동안 유지. */
const cache_store = new Map<string, { value: unknown; expires_at: number }>();

export const cache_handler: NodeHandler = {
  node_type: "cache",
  icon: "💾",
  color: "#00bcd4",
  shape: "rect",
  output_schema: [
    { name: "value",    type: "unknown", description: "Cached or computed value" },
    { name: "hit",      type: "boolean", description: "Whether cache was hit" },
    { name: "cache_key", type: "string", description: "Resolved cache key" },
  ],
  input_schema: [
    { name: "value", type: "unknown", description: "Value to cache (on miss)" },
  ],
  create_default: () => ({
    cache_key: "",
    ttl_ms: 300_000,
    operation: "get_or_set" as const,
  }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as CacheNodeDefinition;
    const tpl_ctx = { memory: ctx.memory };
    const key = resolve_templates(n.cache_key || "", tpl_ctx);

    if (n.operation === "invalidate") {
      cache_store.delete(key);
      return { output: { value: null, hit: false, cache_key: key } };
    }

    const now = Date.now();
    const entry = cache_store.get(key);
    if (entry && entry.expires_at > now) {
      return { output: { value: entry.value, hit: true, cache_key: key } };
    }

    // cache miss — 입력에서 value를 가져와 저장
    const deps = n.depends_on || [];
    const value = deps.length > 0
      ? (ctx.memory as Record<string, unknown>)[deps[0]!]
      : null;

    const ttl = Math.max(0, n.ttl_ms ?? 300_000);
    cache_store.set(key, { value, expires_at: now + ttl });
    return { output: { value, hit: false, cache_key: key } };
  },

  test(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): OrcheNodeTestResult {
    const n = node as CacheNodeDefinition;
    const warnings: string[] = [];
    if (!n.cache_key?.trim()) warnings.push("cache_key is required");
    if ((n.ttl_ms ?? 0) <= 0) warnings.push("ttl_ms should be positive");
    const tpl_ctx = { memory: ctx.memory };
    const key = resolve_templates(n.cache_key || "", tpl_ctx);
    return { preview: { cache_key: key, ttl_ms: n.ttl_ms, operation: n.operation }, warnings };
  },
};
