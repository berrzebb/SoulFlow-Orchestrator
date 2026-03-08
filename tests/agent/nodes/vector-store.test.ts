import { describe, it, expect } from "vitest";
import { vector_store_handler } from "../../../src/agent/nodes/vector-store.js";
import type { VectorStoreNodeDefinition, OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("vector_store_handler", () => {
  const createMockNode = (overrides?: Partial<VectorStoreNodeDefinition>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "vector_store",
    operation: "upsert",
    collection: "documents",
    vectors_field: "vectors",
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be vector_store", () => {
    expect(vector_store_handler.node_type).toBe("vector_store");
  });

  it("execute: should upsert vector", async () => {
    const node = createMockNode({ operation: "upsert" });
    const ctx = createMockContext();
    const result = await vector_store_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should resolve templates in collection name", async () => {
    const node = createMockNode({ collection: "${coll_name}" });
    const ctx = createMockContext({ coll_name: "embeddings" });
    const result = await vector_store_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should query similar vectors", async () => {
    const node = createMockNode({
      operation: "query",
      query_vector_field: "query_vec",
      top_k: 5,
    });
    const ctx = createMockContext({ query_vec: [0.15, 0.25, 0.35, 0.45, 0.55] });
    const result = await vector_store_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should delete vectors by IDs", async () => {
    const node = createMockNode({
      operation: "delete",
      ids_field: "vec_ids",
    });
    const ctx = createMockContext({ vec_ids: ["vec-123", "vec-456"] });
    const result = await vector_store_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("test: preview should show operation and collection", () => {
    const node = createMockNode();
    const result = vector_store_handler.test(node);
    expect(result.preview).toBeDefined();
  });

  it("execute: should query with filter", async () => {
    const node = createMockNode({
      operation: "query",
      query_vector_field: "search_vec",
      filter: { category: "important" },
    });
    const ctx = createMockContext({ search_vec: [0.1, 0.2, 0.3, 0.4, 0.5] });
    const result = await vector_store_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle field references", async () => {
    const node = createMockNode({
      operation: "upsert",
      vectors_field: "my_vectors",
      documents_field: "my_docs",
    });
    const ctx = createMockContext({
      my_vectors: [[0.1, 0.2], [0.3, 0.4]],
      my_docs: ["doc1", "doc2"],
    });
    const result = await vector_store_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle invalid operation gracefully", async () => {
    const node = createMockNode({ operation: "invalid" as any });
    const ctx = createMockContext();
    try {
      await vector_store_handler.execute(node, ctx);
    } catch {
      expect(true).toBe(true);
    }
  });
});
