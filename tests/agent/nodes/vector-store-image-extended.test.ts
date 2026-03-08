/**
 * vector_store_handler + image_handler 확장 커버리지.
 * 미커버 영역: runner_execute (services.vector_store), test(), image execute/test
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { vector_store_handler } from "@src/agent/nodes/vector-store.js";
import { image_handler } from "@src/agent/nodes/image.js";
import type { OrcheNodeDefinition } from "@src/agent/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "@src/agent/orche-node-executor.js";
import type { RunnerContext } from "@src/agent/node-registry.js";

afterEach(() => { vi.restoreAllMocks(); });

// ── 공통 헬퍼 ──

function make_ctx(memory: Record<string, unknown> = {}): OrcheNodeExecutorContext {
  return { memory, workspace: "/tmp", abort_signal: undefined };
}

function make_runner(overrides: Partial<RunnerContext> = {}): RunnerContext {
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

// ══════════════════════════════════════════
// vector_store_handler
// ══════════════════════════════════════════

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
    const ctx = make_ctx({ my_ids: ["id-1", "id-2"] });
    const result = await vector_store_handler.execute(
      make_vs_node({ operation: "delete", ids_field: "my_ids" } as OrcheNodeDefinition),
      ctx,
    );
    expect(result.output.action).toBe("delete");
    expect(result.output.count).toBe(2);
    expect((result.output.ids as string[])).toContain("id-1");
  });

  it("upsert: vectors_field에서 벡터 가져옴", async () => {
    const ctx = make_ctx({ vecs: [[0.1, 0.2], [0.3, 0.4]] });
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
        make_ctx(),
      ),
    ).rejects.toThrow("unknown operation");
  });
});

describe("vector_store_handler — runner_execute: vector_store 서비스 없음", () => {
  it("서비스 없음 → execute() 폴백 (query)", async () => {
    const runner = make_runner({ services: undefined });
    const result = await vector_store_handler.runner_execute!(make_vs_node(), make_ctx(), runner);
    expect(result.output.action).toBe("query");
    expect(result.output.count).toBe(0);
  });
});

describe("vector_store_handler — runner_execute: vector_store 서비스 있음", () => {
  it("query → results 반환", async () => {
    const mock_vs = vi.fn().mockResolvedValue({
      results: [{ id: "doc1", score: 0.9 }, { id: "doc2", score: 0.8 }],
    });
    const runner = make_runner({
      services: { vector_store: mock_vs } as RunnerContext["services"],
    });
    const ctx = make_ctx({ q_vec: [0.1, 0.2] });
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
    const runner = make_runner({
      services: { vector_store: mock_vs } as RunnerContext["services"],
    });
    const ctx = make_ctx({ vecs: [[0.1], [0.2], [0.3]], docs: ["d1", "d2", "d3"] });
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
    const runner = make_runner({
      services: { vector_store: mock_vs } as RunnerContext["services"],
    });
    const ctx = make_ctx({ del_ids: ["x", "y"] });
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
    const runner = make_runner({
      services: { vector_store: mock_vs } as RunnerContext["services"],
    });
    const result = await vector_store_handler.runner_execute!(
      make_vs_node({ operation: "bad_op" } as OrcheNodeDefinition),
      make_ctx(),
      runner,
    );
    expect(result.output.action).toBe("error");
    expect(runner.logger.warn).toHaveBeenCalled();
  });

  it("vector_store 서비스 예외 → error 반환", async () => {
    const mock_vs = vi.fn().mockRejectedValue(new Error("db_connection_failed"));
    const runner = make_runner({
      services: { vector_store: mock_vs } as RunnerContext["services"],
    });
    const result = await vector_store_handler.runner_execute!(make_vs_node(), make_ctx(), runner);
    expect(result.output.action).toBe("error");
    expect(String(result.output.error)).toContain("db_connection_failed");
    expect(runner.logger.warn).toHaveBeenCalled();
  });
});

describe("vector_store_handler — test()", () => {
  it("store_id 없음 → 경고", () => {
    const r = vector_store_handler.test!(make_vs_node({ store_id: "" } as OrcheNodeDefinition), make_ctx());
    expect(r.warnings?.some((w) => w.includes("store_id"))).toBe(true);
  });

  it("collection 없음 → 경고", () => {
    const r = vector_store_handler.test!(make_vs_node({ collection: "" } as OrcheNodeDefinition), make_ctx());
    expect(r.warnings?.some((w) => w.includes("collection"))).toBe(true);
  });

  it("잘못된 operation → 경고", () => {
    const r = vector_store_handler.test!(make_vs_node({ operation: "flush" } as OrcheNodeDefinition), make_ctx());
    expect(r.warnings?.some((w) => w.includes("operation"))).toBe(true);
  });

  it("정상 설정 → 경고 없음", () => {
    const r = vector_store_handler.test!(make_vs_node(), make_ctx());
    expect(r.warnings ?? []).toHaveLength(0);
  });

  it("preview: operation/store_id/collection 포함", () => {
    const r = vector_store_handler.test!(make_vs_node(), make_ctx());
    expect(r.preview).toHaveProperty("operation");
    expect(r.preview).toHaveProperty("store_id");
    expect(r.preview).toHaveProperty("collection");
  });
});

// ══════════════════════════════════════════
// image_handler
// ══════════════════════════════════════════

function make_image_node(overrides?: Partial<OrcheNodeDefinition>): OrcheNodeDefinition {
  return {
    node_id: "img1",
    node_type: "image",
    operation: "info",
    input_path: "/tmp/test.png",
    output_path: "",
    width: 800,
    height: 600,
    format: "png",
    quality: 85,
    ...overrides,
  } as OrcheNodeDefinition;
}

describe("image_handler — 메타데이터", () => {
  it("node_type = image", () => expect(image_handler.node_type).toBe("image"));
  it("create_default: operation/input_path/format 포함", () => {
    const def = image_handler.create_default!();
    expect(def).toHaveProperty("operation");
    expect(def).toHaveProperty("input_path");
    expect(def).toHaveProperty("format");
  });
  it("output_schema에 result/success 포함", () => {
    const names = image_handler.output_schema!.map((s) => s.name);
    expect(names).toContain("result");
    expect(names).toContain("success");
  });
});

describe("image_handler — execute()", () => {
  it("파일 없음 → success=false (Error 포함)", async () => {
    const ctx = make_ctx({ text: "test" });
    const result = await image_handler.execute(
      make_image_node({ input_path: "/nonexistent/file.png" } as OrcheNodeDefinition),
      ctx,
    );
    // ImageTool이 에러 반환하거나 예외 발생 → success=false
    expect(result.output.success).toBe(false);
  });

  it("input_path 템플릿 resolve", async () => {
    const ctx = make_ctx({ img: "test.png" });
    // /nonexistent/test.png → 파일 없음 → success=false
    const result = await image_handler.execute(
      make_image_node({ input_path: "/nonexistent/{{memory.img}}" } as OrcheNodeDefinition),
      ctx,
    );
    expect(result.output.success).toBe(false);
  });
});

describe("image_handler — test()", () => {
  it("input_path 없음 → 경고", () => {
    const r = image_handler.test!(make_image_node({ input_path: "" } as OrcheNodeDefinition), make_ctx());
    expect(r.warnings?.some((w) => w.includes("input_path"))).toBe(true);
  });

  it("input_path 있음 → 경고 없음", () => {
    const r = image_handler.test!(make_image_node(), make_ctx());
    expect(r.warnings ?? []).toHaveLength(0);
  });

  it("preview: operation/format 포함", () => {
    const r = image_handler.test!(make_image_node(), make_ctx());
    expect(r.preview).toHaveProperty("operation");
    expect(r.preview).toHaveProperty("format");
  });
});
