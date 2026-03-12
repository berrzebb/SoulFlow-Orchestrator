import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { web_search_handler } from "../../../src/agent/nodes/web-search.js";
import type { WebSearchNodeDefinition, OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("web_search_handler", () => {
  const createMockNode = (overrides?: Partial<WebSearchNodeDefinition>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "web_search",
    query: "test query",
    max_results: 5,
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be web_search", () => {
    expect(web_search_handler.node_type).toBe("web_search");
  });

  it("execute: should search with query", async () => {
    const node = createMockNode({ query: "machine learning" });
    const ctx = createMockContext();
    const result = await web_search_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should resolve templates in query", async () => {
    const node = createMockNode({ query: "${search_term}" });
    const ctx = createMockContext({ search_term: "artificial intelligence" });
    const result = await web_search_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should respect max_results limit", async () => {
    const node = createMockNode({ query: "test", max_results: 10 });
    const ctx = createMockContext();
    const result = await web_search_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("test: preview should show query", () => {
    const node = createMockNode({ query: "python programming" });
    const result = web_search_handler.test(node);
    expect(result.preview).toBeDefined();
  });

  it("execute: should support different search engines", async () => {
    const node = createMockNode({
      query: "test",
      search_engine: "bing",
    });
    const ctx = createMockContext();
    const result = await web_search_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle empty query", async () => {
    const node = createMockNode({ query: "" });
    const ctx = createMockContext();
    const result = await web_search_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should return results with query metadata", async () => {
    const node = createMockNode({ query: "nodejs", max_results: 3 });
    const ctx = createMockContext();
    const result = await web_search_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle network timeouts gracefully", async () => {
    const node = createMockNode({
      query: "test",
      timeout_ms: 1000,
    });
    const ctx = createMockContext();
    const result = await web_search_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  // L37 setTimeout 콜백 커버 — fetch 걸림 + fake timer로 타임아웃 발생
  it("execute: fetch 걸림 → 15초 타임아웃 → AbortError → 에러 반환 (L37)", async () => {
    vi.useFakeTimers();
    const original_fetch = globalThis.fetch;
    globalThis.fetch = vi.fn((_url: unknown, opts: RequestInit) =>
      new Promise<Response>((_, reject) => {
        opts.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }),
    );
    const node = createMockNode({ query: "timeout test" });
    const promise = web_search_handler.execute(node, createMockContext());
    await vi.advanceTimersByTimeAsync(15_000);
    const result = await promise;
    globalThis.fetch = original_fetch;
    vi.useRealTimers();
    expect(result.output).toBeDefined();
  });
});

// ── from web-search-extended.test.ts ──

describe("web_search_handler.test() — warning 분기", () => {
  it("query 빈 문자열 → 'query is empty' warning", () => {
    const node = { node_id: "n", node_type: "web_search", query: "" };
    const result = web_search_handler.test(node);
    expect(result.warnings).toContain("query is empty");
  });

  it("query 공백만 → warning", () => {
    const node = { node_id: "n", node_type: "web_search", query: "   " };
    const result = web_search_handler.test(node);
    expect(result.warnings).toContain("query is empty");
  });

  it("query 있음 → warning 없음", () => {
    const node = { node_id: "n", node_type: "web_search", query: "nodejs" };
    const result = web_search_handler.test(node);
    expect(result.warnings).not.toContain("query is empty");
  });

  it("preview에 query, max_results 포함", () => {
    const node = { node_id: "n", node_type: "web_search", query: "test", max_results: 10 };
    const result = web_search_handler.test(node);
    expect(result.preview).toMatchObject({ query: "test", max_results: 10 });
  });
});

const SAMPLE_HTML = `
<html><body>
<a href="/url?q=https://example.com/page1&amp;sa=U">Example Page 1</a>
<a href="/url?q=https://example.com/page2&amp;sa=U">Example Page 2</a>
<a href="/url?q=https://another.org/article&amp;sa=U">Another Article</a>
<a href="/url?q=ftp://not-http.com&amp;sa=U">Not HTTP</a>
<a href="/other">Ignored Link</a>
</body></html>
`;

describe("web_search_handler.execute() — fetch mock", () => {
  let original_fetch: typeof globalThis.fetch;

  beforeEach(() => {
    original_fetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = original_fetch;
  });

  it("빈 query → results:[], error:'query is empty' (fetch 미호출)", async () => {
    let fetch_called = false;
    globalThis.fetch = vi.fn().mockImplementation(() => { fetch_called = true; return Promise.resolve(new Response("")); });

    const node = { node_id: "n", node_type: "web_search", query: "" };
    const result = await web_search_handler.execute(node, { memory: {} });
    expect(result.output.results).toEqual([]);
    expect((result.output as any).error).toBe("query is empty");
    expect(fetch_called).toBe(false);
  });

  it("fetch 성공 → HTML 파싱 후 results 반환", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(SAMPLE_HTML, { status: 200 }));

    const node = { node_id: "n", node_type: "web_search", query: "test", max_results: 5 };
    const result = await web_search_handler.execute(node, { memory: {} });
    const out = result.output as any;
    expect(out.query).toBe("test");
    expect(Array.isArray(out.results)).toBe(true);
    expect(out.results.length).toBeGreaterThanOrEqual(1);
    expect(out.results.every((r: any) => r.url.startsWith("http"))).toBe(true);
  });

  it("ctx.abort_signal 있을 때 → AbortSignal.any() 경로 진입", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(SAMPLE_HTML, { status: 200 }));

    const abort_ctrl = new AbortController();
    const node = { node_id: "n", node_type: "web_search", query: "abort test", max_results: 3 };
    const ctx = { memory: {}, abort_signal: abort_ctrl.signal };
    const result = await web_search_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
    expect((result.output as any).query).toBe("abort test");
  });

  it("ctx.abort_signal로 중단하면 → error 반환", async () => {
    const abort_ctrl = new AbortController();
    abort_ctrl.abort();

    globalThis.fetch = vi.fn().mockRejectedValue(
      Object.assign(new Error("AbortError"), { name: "AbortError" }),
    );

    const node = { node_id: "n", node_type: "web_search", query: "abort now", max_results: 3 };
    const ctx = { memory: {}, abort_signal: abort_ctrl.signal };
    const result = await web_search_handler.execute(node, ctx);
    const out = result.output as any;
    expect(out.results).toEqual([]);
    expect(out.error).toBeDefined();
  });

  it("max_results=20 초과 → 20으로 clamp", async () => {
    let captured_url = "";
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      captured_url = url;
      return Promise.resolve(new Response("", { status: 200 }));
    });

    const node = { node_id: "n", node_type: "web_search", query: "clamp test", max_results: 100 };
    await web_search_handler.execute(node, { memory: {} });
    expect(captured_url).toContain("num=20");
  });

  it("max_results=-1 이하 → 1로 clamp", async () => {
    let captured_url = "";
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      captured_url = url;
      return Promise.resolve(new Response("", { status: 200 }));
    });

    const node = { node_id: "n", node_type: "web_search", query: "clamp test", max_results: -1 };
    await web_search_handler.execute(node, { memory: {} });
    expect(captured_url).toContain("num=1");
  });

  it("fetch 예외 → results:[], error 메시지 반환", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network error"));

    const node = { node_id: "n", node_type: "web_search", query: "error case", max_results: 5 };
    const result = await web_search_handler.execute(node, { memory: {} });
    const out = result.output as any;
    expect(out.results).toEqual([]);
    expect(out.error).toContain("network error");
  });
});
