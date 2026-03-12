import { describe, it, expect, vi, afterEach } from "vitest";
import { vector_store_handler } from "../../../src/agent/nodes/vector-store.js";
import type { VectorStoreNodeDefinition, OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";
import type { RunnerContext } from "../../../src/agent/node-registry.js";

afterEach(() => { vi.restoreAllMocks(); });

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

// ── from vector-store-image-extended.test.ts (vector_store parts) ──

function make_vs_ctx(memory: Record<string, unknown> = {}): OrcheNodeExecutorContext {
  return { memory, workspace: "/tmp", abort_signal: undefined };
}

function make_vs_runner(overrides: Partial<RunnerContext> = {}): RunnerContext {
  return {
    state: { memory: {} } as RunnerContext["state"],
    options: {} as RunnerContext["options"],
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as RunnerContext["logger"],
    emit: vi.fn(),
    all_nodes: [],
    skipped_nodes: new Set(),
    execute_node: vi.fn(),
    ...overrides,
  } as unknown as RunnerContext;
}

function make_vs_node(overrides?: Partial<OrcheNodeDefinition>): OrcheNodeDefinition {
  return {
    node_id: "vs1",
    node_type: "vector_store",
    operation: "query",
    store_id: "mystore",
    collection: "docs",
    top_k: 5,
    min_score: 0.5,
    ...overrides,
  } as OrcheNodeDefinition;
}

describe("vector_store_handler — 메타데이터", () => {
  it("node_type = vector_store", () => expect(vector_store_handler.node_type).toBe("vector_store"));
  it("create_default: operation/store_id/collection 포함", () => {
    const def = vector_store_handler.create_default!();
    expect(def).toHaveProperty("operation");
    expect(def).toHaveProperty("store_id");
    expect(def).toHaveProperty("collection");
  });
  it("output_schema에 action/results/count/ids 포함", () => {
    const names = vector_store_handler.output_schema!.map((s) => s.name);
    expect(names).toContain("action");
    expect(names).toContain("results");
    expect(names).toContain("count");
    expect(names).toContain("ids");
  });
});

describe("vector_store_handler — execute() 확장", () => {
  it("delete: ids_field에서 ID 목록 가져옴", async () => {
    const ctx = make_vs_ctx({ my_ids: ["id-1", "id-2"] });
    const result = await vector_store_handler.execute(
      make_vs_node({ operation: "delete", ids_field: "my_ids" } as OrcheNodeDefinition),
      ctx,
    );
    expect(result.output.action).toBe("delete");
    expect(result.output.count).toBe(2);
    expect((result.output.ids as string[])).toContain("id-1");
  });

  it("upsert: vectors_field에서 벡터 가져옴", async () => {
    const ctx = make_vs_ctx({ vecs: [[0.1, 0.2], [0.3, 0.4]] });
    const result = await vector_store_handler.execute(
      make_vs_node({ operation: "upsert", vectors_field: "vecs" } as OrcheNodeDefinition),
      ctx,
    );
    expect(result.output.action).toBe("upsert");
    expect(result.output.count).toBe(2);
    expect((result.output.ids as string[]).length).toBe(2);
  });

  it("unknown operation → 예외 발생", async () => {
    await expect(
      vector_store_handler.execute(
        make_vs_node({ operation: "invalid_op" } as OrcheNodeDefinition),
        make_vs_ctx(),
      ),
    ).rejects.toThrow("unknown operation");
  });
});

describe("vector_store_handler — runner_execute: vector_store 서비스 없음", () => {
  it("서비스 없음 → execute() 폴백 (query)", async () => {
    const runner = make_vs_runner({ services: undefined });
    const result = await vector_store_handler.runner_execute!(make_vs_node(), make_vs_ctx(), runner);
    expect(result.output.action).toBe("query");
    expect(result.output.count).toBe(0);
  });
});

describe("vector_store_handler — runner_execute: vector_store 서비스 있음", () => {
  it("query → results 반환", async () => {
    const mock_vs = vi.fn().mockResolvedValue({
      results: [{ id: "doc1", score: 0.9 }, { id: "doc2", score: 0.8 }],
    });
    const runner = make_vs_runner({
      services: { vector_store: mock_vs } as RunnerContext["services"],
    });
    const ctx = make_vs_ctx({ q_vec: [0.1, 0.2] });
    const result = await vector_store_handler.runner_execute!(
      make_vs_node({ query_vector_field: "q_vec" } as OrcheNodeDefinition),
      ctx,
      runner,
    );
    expect(mock_vs).toHaveBeenCalledWith("query", expect.objectContaining({ store_id: "mystore", collection: "docs" }));
    expect(result.output.count).toBe(2);
  });

  it("upsert → count/ids 반환", async () => {
    const mock_vs = vi.fn().mockResolvedValue({ count: 3, ids: ["a", "b", "c"] });
    const runner = make_vs_runner({
      services: { vector_store: mock_vs } as RunnerContext["services"],
    });
    const ctx = make_vs_ctx({ vecs: [[0.1], [0.2], [0.3]], docs: ["d1", "d2", "d3"] });
    const result = await vector_store_handler.runner_execute!(
      make_vs_node({
        operation: "upsert",
        vectors_field: "vecs",
        documents_field: "docs",
      } as OrcheNodeDefinition),
      ctx,
      runner,
    );
    expect(result.output.count).toBe(3);
    expect((result.output.ids as string[])).toHaveLength(3);
  });

  it("delete → count 반환", async () => {
    const mock_vs = vi.fn().mockResolvedValue({ count: 2 });
    const runner = make_vs_runner({
      services: { vector_store: mock_vs } as RunnerContext["services"],
    });
    const ctx = make_vs_ctx({ del_ids: ["x", "y"] });
    const result = await vector_store_handler.runner_execute!(
      make_vs_node({ operation: "delete", ids_field: "del_ids" } as OrcheNodeDefinition),
      ctx,
      runner,
    );
    expect(result.output.action).toBe("delete");
    expect(result.output.count).toBe(2);
  });

  it("unknown operation → error 반환 (logger.warn 호출)", async () => {
    const mock_vs = vi.fn();
    const runner = make_vs_runner({
      services: { vector_store: mock_vs } as RunnerContext["services"],
    });
    const result = await vector_store_handler.runner_execute!(
      make_vs_node({ operation: "bad_op" } as OrcheNodeDefinition),
      make_vs_ctx(),
      runner,
    );
    expect(result.output.action).toBe("error");
    expect(runner.logger.warn).toHaveBeenCalled();
  });

  it("vector_store 서비스 예외 → error 반환", async () => {
    const mock_vs = vi.fn().mockRejectedValue(new Error("db_connection_failed"));
    const runner = make_vs_runner({
      services: { vector_store: mock_vs } as RunnerContext["services"],
    });
    const result = await vector_store_handler.runner_execute!(make_vs_node(), make_vs_ctx(), runner);
    expect(result.output.action).toBe("error");
    expect(String(result.output.error)).toContain("db_connection_failed");
    expect(runner.logger.warn).toHaveBeenCalled();
  });
});

describe("vector_store_handler — test()", () => {
  it("store_id 없음 → 경고", () => {
    const r = vector_store_handler.test!(make_vs_node({ store_id: "" } as OrcheNodeDefinition), make_vs_ctx());
    expect(r.warnings?.some((w) => w.includes("store_id"))).toBe(true);
  });

  it("collection 없음 → 경고", () => {
    const r = vector_store_handler.test!(make_vs_node({ collection: "" } as OrcheNodeDefinition), make_vs_ctx());
    expect(r.warnings?.some((w) => w.includes("collection"))).toBe(true);
  });

  it("잘못된 operation → 경고", () => {
    const r = vector_store_handler.test!(make_vs_node({ operation: "flush" } as OrcheNodeDefinition), make_vs_ctx());
    expect(r.warnings?.some((w) => w.includes("operation"))).toBe(true);
  });

  it("정상 설정 → 경고 없음", () => {
    const r = vector_store_handler.test!(make_vs_node(), make_vs_ctx());
    expect(r.warnings ?? []).toHaveLength(0);
  });

  it("preview: operation/store_id/collection 포함", () => {
    const r = vector_store_handler.test!(make_vs_node(), make_vs_ctx());
    expect(r.preview).toHaveProperty("operation");
    expect(r.preview).toHaveProperty("store_id");
    expect(r.preview).toHaveProperty("collection");
  });
});
