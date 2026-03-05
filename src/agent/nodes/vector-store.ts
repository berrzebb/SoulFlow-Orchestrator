/** Vector Store 노드 핸들러 — sqlite-vec 기반 벡터 저장/검색/삭제. */

import type { NodeHandler } from "../node-registry.js";
import type { VectorStoreNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";

export const vector_store_handler: NodeHandler = {
  node_type: "vector_store",
  icon: "🗄",
  color: "#00897b",
  shape: "rect",
  output_schema: [
    { name: "action",  type: "string", description: "Operation performed" },
    { name: "results", type: "array",  description: "Query results (with score)" },
    { name: "count",   type: "number", description: "Affected/returned count" },
    { name: "ids",     type: "array",  description: "Upserted/deleted IDs" },
  ],
  input_schema: [
    { name: "operation",  type: "string", description: "upsert | query | delete" },
    { name: "store_id",   type: "string", description: "Vector store datasource ID" },
    { name: "collection", type: "string", description: "Collection/index name" },
    { name: "top_k",      type: "number", description: "Results to return (query)" },
  ],
  create_default: () => ({
    operation: "query", store_id: "", collection: "default",
    top_k: 5, min_score: 0.0,
  }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as VectorStoreNodeDefinition;
    const op = n.operation || "query";
    const collection = resolve_templates(n.collection || "default", ctx.memory);
    const store_id = resolve_templates(n.store_id || "", ctx.memory);

    // 서비스 연동 지점 — memory에 vector_store 함수가 주입되었으면 사용
    const vs_fn = ctx.memory["__vector_store_fn"] as
      | ((op: string, opts: Record<string, unknown>) => Promise<Record<string, unknown>>)
      | undefined;

    switch (op) {
      case "upsert": {
        const vectors = n.vectors_field ? (ctx.memory[n.vectors_field] as number[][] ?? []) : [];
        const documents = n.documents_field ? (ctx.memory[n.documents_field] as string[] ?? []) : [];

        if (vs_fn) {
          const result = await vs_fn("upsert", {
            store_id, collection, vectors, documents, filter: n.filter,
          });
          return { output: { action: "upsert", results: [], count: result["count"] ?? vectors.length, ids: result["ids"] ?? [] } };
        }
        // 폴백: 성공 시뮬레이션
        const ids = vectors.map((_, i) => `vec-${Date.now()}-${i}`);
        return { output: { action: "upsert", results: [], count: vectors.length, ids } };
      }

      case "query": {
        const query_vector = n.query_vector_field ? (ctx.memory[n.query_vector_field] as number[] ?? []) : [];
        const top_k = n.top_k ?? 5;
        const min_score = n.min_score ?? 0.0;

        if (vs_fn) {
          const result = await vs_fn("query", {
            store_id, collection, query_vector, top_k, min_score, filter: n.filter,
          });
          const results = (result["results"] ?? []) as unknown[];
          return { output: { action: "query", results, count: results.length, ids: [] } };
        }
        return { output: { action: "query", results: [], count: 0, ids: [] } };
      }

      case "delete": {
        const ids = n.ids_field ? (ctx.memory[n.ids_field] as string[] ?? []) : [];

        if (vs_fn) {
          const result = await vs_fn("delete", {
            store_id, collection, ids, filter: n.filter,
          });
          return { output: { action: "delete", results: [], count: result["count"] ?? ids.length, ids } };
        }
        return { output: { action: "delete", results: [], count: ids.length, ids } };
      }

      default:
        throw new Error(`vector_store: unknown operation "${op}"`);
    }
  },

  test(node: OrcheNodeDefinition, _ctx: OrcheNodeExecutorContext): OrcheNodeTestResult {
    const n = node as VectorStoreNodeDefinition;
    const warnings: string[] = [];
    if (!n.store_id) warnings.push("store_id is required");
    if (!n.collection) warnings.push("collection is required");
    if (!["upsert", "query", "delete"].includes(n.operation)) {
      warnings.push(`invalid operation: ${n.operation}`);
    }
    return { preview: { operation: n.operation, store_id: n.store_id, collection: n.collection }, warnings };
  },
};
