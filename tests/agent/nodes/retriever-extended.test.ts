/**
 * retriever_handler 확장 커버리지 — http/memory/file/unknown source + runner_execute + test().
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { retriever_handler } from "@src/agent/nodes/retriever.js";
import type { OrcheNodeDefinition } from "@src/agent/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "@src/agent/orche-node-executor.js";
import type { RunnerContext } from "@src/agent/node-registry.js";

function make_ctx(memory: Record<string, unknown> = {}): OrcheNodeExecutorContext {
  return { memory, workspace: "/tmp", abort_signal: undefined };
}

function make_node(overrides?: Partial<OrcheNodeDefinition>): OrcheNodeDefinition {
  return {
    node_id: "r1",
    node_type: "retriever",
    source: "memory",
    query: "test",
    top_k: 5,
    ...overrides,
  } as OrcheNodeDefinition;
}

function make_runner(workspace = "/tmp"): RunnerContext {
  return {
    state: { memory: {} } as RunnerContext["state"],
    options: { workspace } as unknown as RunnerContext["options"],
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as RunnerContext["logger"],
    emit: vi.fn(),
    all_nodes: [],
    skipped_nodes: new Set(),
    execute_node: vi.fn(),
  } as unknown as RunnerContext;
}

describe("retriever_handler — memory source 확장", () => {
  it("top_k 제한 적용", async () => {
    const memory: Record<string, unknown> = {};
    for (let i = 0; i < 10; i++) memory["item_" + i] = "match " + i;
    const ctx = make_ctx(memory);
    const result = await retriever_handler.execute(make_node({ query: "match", top_k: 3 } as OrcheNodeDefinition), ctx);
    expect(result.output.count).toBe(3);
  });

  it("객체 값 JSON.stringify로 검색", async () => {
    const ctx = make_ctx({ obj: { name: "search_target" } });
    const result = await retriever_handler.execute(make_node({ query: "search_target" } as OrcheNodeDefinition), ctx);
    expect(result.output.count).toBe(1);
  });
});

describe("retriever_handler — http source", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("GET 요청 → 배열 결과 반환", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: async () => [{ id: 1 }, { id: 2 }],
    }));
    const node = make_node({ source: "http", url: "https://example.com/search", query: "test" } as OrcheNodeDefinition);
    const result = await retriever_handler.execute(node, make_ctx());
    expect(result.output.count).toBe(2);
  });

  it("POST 요청 → body에 query/top_k 포함", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: async () => [{ id: 1 }],
    }));
    const node = make_node({ source: "http", url: "https://example.com/api", method: "POST", query: "hello", top_k: 3 } as OrcheNodeDefinition);
    await retriever_handler.execute(node, make_ctx());
    const call_args = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call_args[1].method).toBe("POST");
    const body = JSON.parse(call_args[1].body);
    expect(body.query).toBe("hello");
    expect(body.top_k).toBe(3);
  });

  it("비배열 응답 → 단일 결과 래핑", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: async () => ({ data: "single" }),
    }));
    const node = make_node({ source: "http", url: "https://example.com/search", query: "q" } as OrcheNodeDefinition);
    const result = await retriever_handler.execute(node, make_ctx());
    expect(result.output.count).toBe(1);
  });

  it("url 없음 → 예외", async () => {
    const node = make_node({ source: "http", url: "", query: "q" } as OrcheNodeDefinition);
    await expect(retriever_handler.execute(node, make_ctx())).rejects.toThrow("url is required");
  });

  it("localhost → private host 차단", async () => {
    const node = make_node({ source: "http", url: "http://localhost:3000/api", query: "q" } as OrcheNodeDefinition);
    await expect(retriever_handler.execute(node, make_ctx())).rejects.toThrow("private/loopback host blocked");
  });

  it("192.168.x.x → private IP 차단", async () => {
    const node = make_node({ source: "http", url: "http://192.168.1.1/api", query: "q" } as OrcheNodeDefinition);
    await expect(retriever_handler.execute(node, make_ctx())).rejects.toThrow();
  });

  it("GET URL에 쿼리 파라미터 추가", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: async () => [],
    }));
    const node = make_node({ source: "http", url: "https://example.com/search", query: "my query" } as OrcheNodeDefinition);
    await retriever_handler.execute(node, make_ctx());
    const called_url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(called_url).toContain("q=");
    expect(called_url).toContain("my%20query");
  });
});

describe("retriever_handler — file source (execute 기본)", () => {
  it("file source execute → 빈 결과 (stub)", async () => {
    const node = make_node({ source: "file", query: "q", file_path: "data.txt" } as OrcheNodeDefinition);
    const result = await retriever_handler.execute(node, make_ctx());
    expect((result.output.results as unknown[]).length).toBe(0);
  });
});

describe("retriever_handler — unknown source", () => {
  it("알 수 없는 source → 예외", async () => {
    const node = make_node({ source: "ftp", query: "q" } as OrcheNodeDefinition);
    await expect(retriever_handler.execute(node, make_ctx())).rejects.toThrow("unknown source type");
  });
});

describe("retriever_handler — runner_execute: file source", () => {
  it("file source → 파일 내용 라인 검색", async () => {
    const tmpdir_path = mkdtempSync(join(tmpdir(), "retriever-ext-"));
    writeFileSync(join(tmpdir_path, "data.txt"), "hello world\ntest line\nhello again\nno match");
    const runner = make_runner(tmpdir_path);
    const node = make_node({ source: "file", query: "hello", file_path: "data.txt" } as OrcheNodeDefinition);
    const result = await retriever_handler.runner_execute!(node, make_ctx(), runner);
    expect(result.output.count).toBe(2);
    rmSync(tmpdir_path, { recursive: true, force: true });
  });

  it("file_path 없음 → error 필드 반환", async () => {
    const runner = make_runner("/tmp");
    const node = make_node({ source: "file", query: "q", file_path: "" } as OrcheNodeDefinition);
    const result = await retriever_handler.runner_execute!(node, make_ctx(), runner);
    expect(String(result.output.error)).toContain("file_path");
  });

  it("workspace 없음 → error 필드 반환", async () => {
    const runner = make_runner("");
    (runner.options as unknown as Record<string, unknown>).workspace = undefined;
    const node = make_node({ source: "file", query: "q", file_path: "data.txt" } as OrcheNodeDefinition);
    const result = await retriever_handler.runner_execute!(node, make_ctx(), runner);
    expect(String(result.output.error)).toContain("workspace");
  });

  it("경로 순회 시도 → 차단", async () => {
    const runner = make_runner("/tmp");
    const node = make_node({ source: "file", query: "q", file_path: "../../../etc/passwd" } as OrcheNodeDefinition);
    const result = await retriever_handler.runner_execute!(node, make_ctx(), runner);
    expect(String(result.output.error)).toContain("path traversal blocked");
  });

  it("존재하지 않는 파일 → error 반환", async () => {
    const runner = make_runner("/tmp");
    const node = make_node({ source: "file", query: "q", file_path: "nonexistent_xyz.txt" } as OrcheNodeDefinition);
    const result = await retriever_handler.runner_execute!(node, make_ctx(), runner);
    expect(result.output.count).toBe(0);
    expect(result.output.error).toBeTruthy();
  });

  it("non-file source → execute() 위임", async () => {
    const runner = make_runner("/tmp");
    const node = make_node({ source: "memory", query: "hello", top_k: 5 } as OrcheNodeDefinition);
    const ctx = make_ctx({ key: "hello world" });
    const result = await retriever_handler.runner_execute!(node, ctx, runner);
    expect(result.output.count).toBe(1);
  });
});

describe("retriever_handler — test()", () => {
  it("query 없음 → 경고", () => {
    const r = retriever_handler.test!(make_node({ query: "" } as OrcheNodeDefinition), make_ctx());
    expect(r.warnings?.some((w) => w.includes("query"))).toBe(true);
  });

  it("http source + url 없음 → 경고", () => {
    const r = retriever_handler.test!(make_node({ source: "http", url: "", query: "q" } as OrcheNodeDefinition), make_ctx());
    expect(r.warnings?.some((w) => w.includes("url"))).toBe(true);
  });

  it("file source + file_path 없음 → 경고", () => {
    const r = retriever_handler.test!(make_node({ source: "file", file_path: "", query: "q" } as OrcheNodeDefinition), make_ctx());
    expect(r.warnings?.some((w) => w.includes("file_path"))).toBe(true);
  });

  it("정상 설정 → 경고 없음", () => {
    const r = retriever_handler.test!(make_node({ source: "memory", query: "test" } as OrcheNodeDefinition), make_ctx());
    expect(r.warnings ?? []).toHaveLength(0);
  });

  it("preview: source/query/top_k 포함", () => {
    const r = retriever_handler.test!(make_node(), make_ctx());
    expect(r.preview).toHaveProperty("source");
    expect(r.preview).toHaveProperty("query");
    expect(r.preview).toHaveProperty("top_k");
  });
});
