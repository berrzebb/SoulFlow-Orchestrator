/**
 * web_search_handler — 미커버 분기 보충.
 * test(): 빈 query → warning.
 * execute(): ctx.abort_signal 있을 때 AbortSignal.any() 경로.
 * extract_search_results(): HTML 파싱 — Google 결과 링크 추출.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { web_search_handler } from "@src/agent/nodes/web-search.js";

// ══════════════════════════════════════════
// test() — 빈 query warning
// ══════════════════════════════════════════

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

// ══════════════════════════════════════════
// execute() — fetch mock 기반 단위 테스트
// ══════════════════════════════════════════

// Google 검색 결과 HTML 샘플 (extract_search_results 정규식에 맞는 구조)
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
    // HTTP 링크 3개만 포함 (ftp:// 제외)
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
    // abort하지 않았으므로 성공
    expect((result.output as any).query).toBe("abort test");
  });

  it("ctx.abort_signal로 중단하면 → error 반환", async () => {
    const abort_ctrl = new AbortController();
    abort_ctrl.abort(); // 즉시 abort

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

    // 0은 falsy라 n.max_results || 5 = 5가 되므로 -1(truthy) 사용
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
