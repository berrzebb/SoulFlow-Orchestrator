/** Vector Store 노드 핸들러 — 벡터 저장/검색/삭제. */

import type { NodeHandler, RunnerContext } from "../node-registry.js";
import type { VectorStoreNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";
import { error_message } from "../../utils/common.js";

export const vector_store_handler: NodeHandler = {
  node_type: "vector_store",
  icon: "\u{1F5C4}",
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

    switch (op) {
      case "upsert": {
        const vectors = n.vectors_field ? (ctx.memory[n.vectors_field] as number[][] ?? []) : [];
        const ids = vectors.map((_, i) => `vec-${Date.now()}-${i}`);
        return { output: { action: "upsert", results: [], count: vectors.length, ids } };
      }
      case "query":
        return { output: { action: "query", results: [], count: 0, ids: [] } };
      case "delete": {
        const ids = n.ids_field ? (ctx.memory[n.ids_field] as string[] ?? []) : [];
        return { output: { action: "delete", results: [], count: ids.length, ids } };
      }
      default:
        throw new Error(`vector_store: unknown operation "${op}" (store=${store_id}, collection=${collection})`);
    }
  },

  async runner_execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext, runner: RunnerContext): Promise<OrcheNodeExecuteResult> {
    const vs = runner.services?.vector_store;
    if (!vs) return this.execute(node, ctx);

    const n = node as VectorStoreNodeDefinition;
    const op = n.operation || "query";
    const collection = resolve_templates(n.collection || "default", ctx.memory);
    const store_id = resolve_templates(n.store_id || "", ctx.memory);

    try {
      switch (op) {
        case "upsert": {
          const vectors = n.vectors_field ? (ctx.memory[n.vectors_field] as number[][] ?? []) : [];
          const documents = n.documents_field ? (ctx.memory[n.documents_field] as string[] ?? []) : [];
          const result = await vs("upsert", { store_id, collection, vectors, documents, filter: n.filter });
          return { output: { action: "upsert", results: [], count: (result["count"] as number) ?? vectors.length, ids: (result["ids"] as string[]) ?? [] } };
        }
        case "query": {
          const query_vector = n.query_vector_field ? (ctx.memory[n.query_vector_field] as number[] ?? []) : [];
          const result = await vs("query", { store_id, collection, query_vector, top_k: n.top_k ?? 5, min_score: n.min_score ?? 0.0, filter: n.filter });
          const results = (result["results"] ?? []) as unknown[];
          return { output: { action: "query", results, count: results.length, ids: [] } };
        }
        case "delete": {
          const ids = n.ids_field ? (ctx.memory[n.ids_field] as string[] ?? []) : [];
          const result = await vs("delete", { store_id, collection, ids, filter: n.filter });
          return { output: { action: "delete", results: [], count: (result["count"] as number) ?? ids.length, ids } };
        }
        default:
          throw new Error(`vector_store: unknown operation "${op}"`);
      }
    } catch (err) {
      runner.logger.warn("vector_store_node_error", { node_id: n.node_id, error: error_message(err) });
      return { output: { action: "error", results: [], count: 0, ids: [], error: error_message(err) } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
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
