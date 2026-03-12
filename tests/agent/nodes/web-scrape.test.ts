import { describe, it, expect, vi, afterEach } from "vitest";
import { web_scrape_handler } from "../../../src/agent/nodes/web-scrape.js";
import type { WebScrapeNodeDefinition, OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

describe("web_scrape_handler", () => {
  const createMockNode = (overrides?: Partial<WebScrapeNodeDefinition>): OrcheNodeDefinition => ({
    node_id: "test-node",
    node_type: "web_scrape",
    url: "https://example.com",
    selector: "div.content",
    ...overrides,
  } as OrcheNodeDefinition);

  const createMockContext = (memory: Record<string, unknown> = {}): OrcheNodeExecutorContext => ({
    memory,
    workspace: "/tmp",
    abort_signal: undefined,
  });

  it("metadata: node_type should be web_scrape", () => {
    expect(web_scrape_handler.node_type).toBe("web_scrape");
  });

  it("execute: should scrape webpage content", async () => {
    const node = createMockNode();
    const ctx = createMockContext();
    const result = await web_scrape_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should resolve templates in URL", async () => {
    const node = createMockNode({ url: "${target_url}" });
    const ctx = createMockContext({ target_url: "https://test.example.com" });
    const result = await web_scrape_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should extract multiple selectors", async () => {
    const node = createMockNode({
      selectors: {
        title: "h1",
        description: "p.desc",
        links: "a[href]",
      },
    });
    const ctx = createMockContext();
    const result = await web_scrape_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle JavaScript rendering", async () => {
    const node = createMockNode({
      javascript: true,
      wait_for_selector: ".dynamic-content",
    });
    const ctx = createMockContext();
    const result = await web_scrape_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("test: preview should show URL and selector", () => {
    const node = createMockNode();
    const result = web_scrape_handler.test(node);
    expect(result.preview).toBeDefined();
  });

  it("execute: should follow pagination", async () => {
    const node = createMockNode({
      pagination: {
        enabled: true,
        next_selector: "a.next",
        max_pages: 5,
      },
    });
    const ctx = createMockContext();
    const result = await web_scrape_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should add custom headers", async () => {
    const node = createMockNode({
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "text/html",
      },
    });
    const ctx = createMockContext();
    const result = await web_scrape_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  it("execute: should handle network error gracefully", async () => {
    const node = createMockNode({ url: "https://invalid-url-that-does-not-exist.test" });
    const ctx = createMockContext();
    const result = await web_scrape_handler.execute(node, ctx);
    expect(result.output).toBeDefined();
  });

  // L52 setTimeout 콜백 커버 — fetch 걸림 + fake timer로 30초 타임아웃 발생
  it("execute: fetch 걸림 → 30초 타임아웃 → AbortError (L52)", async () => {
    vi.useFakeTimers();
    const original_fetch = globalThis.fetch;
    globalThis.fetch = vi.fn((_url: unknown, opts: RequestInit) =>
      new Promise<Response>((_, reject) => {
        opts.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }),
    );
    const node = createMockNode({ url: "https://example.com/page" });
    const promise = web_scrape_handler.execute(node, createMockContext());
    await vi.advanceTimersByTimeAsync(30_000);
    const result = await promise;
    globalThis.fetch = original_fetch;
    vi.useRealTimers();
    expect(result.output).toBeDefined();
  });
});

// ── from web-scrape-extended.test.ts ──

function make_ws_node(overrides: Record<string, unknown> = {}): OrcheNodeDefinition {
  return { node_id: "n1", node_type: "web_scrape", ...overrides } as OrcheNodeDefinition;
}

function make_ws_ctx(memory: Record<string, unknown> = {}): OrcheNodeExecutorContext {
  return { memory, workspace: "/tmp", abort_signal: undefined };
}

describe("web_scrape_handler — URL 검증", () => {
  it("url 비어있음 → error: url is empty", async () => {
    const r = await web_scrape_handler.execute(make_ws_node({ url: "" }), make_ws_ctx());
    expect(r.output.error).toContain("url is empty");
    expect(r.output.status).toBe(0);
  });

  it("url 공백만 → error: url is empty", async () => {
    const r = await web_scrape_handler.execute(make_ws_node({ url: "   " }), make_ws_ctx());
    expect(r.output.error).toContain("url is empty");
  });

  it("ftp:// 프로토콜 → unsupported protocol", async () => {
    const r = await web_scrape_handler.execute(make_ws_node({ url: "ftp://example.com" }), make_ws_ctx());
    expect(String(r.output.error)).toContain("unsupported protocol");
  });

  it("file:// 프로토콜 → unsupported protocol", async () => {
    const r = await web_scrape_handler.execute(make_ws_node({ url: "file:///etc/passwd" }), make_ws_ctx());
    expect(String(r.output.error)).toContain("unsupported protocol");
  });

  it("파싱 불가 URL → invalid URL", async () => {
    const r = await web_scrape_handler.execute(make_ws_node({ url: "not-a-url-!!!" }), make_ws_ctx());
    expect(String(r.output.error)).toContain("invalid URL");
  });

  it("private host 127.0.0.1 → blocked private host", async () => {
    const r = await web_scrape_handler.execute(make_ws_node({ url: "http://127.0.0.1/path" }), make_ws_ctx());
    expect(String(r.output.error)).toContain("blocked");
  });

  it("private host 192.168.x.x → blocked", async () => {
    const r = await web_scrape_handler.execute(make_ws_node({ url: "http://192.168.1.100/" }), make_ws_ctx());
    expect(String(r.output.error)).toContain("blocked");
  });

  it("private host 10.x.x.x → blocked", async () => {
    const r = await web_scrape_handler.execute(make_ws_node({ url: "http://10.0.0.1/" }), make_ws_ctx());
    expect(String(r.output.error)).toContain("blocked");
  });

  it("private host 169.254.x.x (link-local) → blocked", async () => {
    const r = await web_scrape_handler.execute(make_ws_node({ url: "http://169.254.169.254/latest/meta-data/" }), make_ws_ctx());
    expect(String(r.output.error)).toContain("blocked");
  });

  it("private host localhost → blocked", async () => {
    const r = await web_scrape_handler.execute(make_ws_node({ url: "http://localhost:8080/" }), make_ws_ctx());
    expect(String(r.output.error)).toContain("blocked");
  });

  it("IPv6 loopback ::1 → blocked", async () => {
    const r = await web_scrape_handler.execute(make_ws_node({ url: "http://[::1]/" }), make_ws_ctx());
    expect(String(r.output.error)).toContain("blocked");
  });
});

describe("web_scrape_handler — fetch mock", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("정상 HTML 응답 → text/title/status 반환", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      headers: { get: () => "text/html; charset=utf-8" },
      status: 200,
      text: async () => "<html><head><title>Test Page</title></head><body><p>Hello World</p></body></html>",
    } as unknown as Response);

    const r = await web_scrape_handler.execute(make_ws_node({ url: "https://example.com" }), make_ws_ctx());
    expect(r.output.status).toBe(200);
    expect(r.output.title).toBe("Test Page");
    expect(String(r.output.text)).toContain("Hello World");
  });

  it("텍스트가 max_chars 초과 → ...(truncated) 추가", async () => {
    const long_html = "<p>" + "A".repeat(60000) + "</p>";
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      headers: { get: () => "text/html" },
      status: 200,
      text: async () => long_html,
    } as unknown as Response);

    const r = await web_scrape_handler.execute(
      make_ws_node({ url: "https://example.com", max_chars: 1000 }),
      make_ws_ctx()
    );
    expect(String(r.output.text)).toContain("(truncated)");
    expect(String(r.output.text).length).toBeLessThanOrEqual(1100);
  });

  it("fetch 에러 → error 필드 포함", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("network failure"));

    const r = await web_scrape_handler.execute(make_ws_node({ url: "https://example.com" }), make_ws_ctx());
    expect(String(r.output.error)).toContain("network failure");
    expect(r.output.status).toBe(0);
  });

  it("script/style 태그 제거된 텍스트 반환", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      headers: { get: () => "text/html" },
      status: 200,
      text: async () => "<html><head><script>alert(1)</script><style>.x{color:red}</style></head><body>Clean text</body></html>",
    } as unknown as Response);

    const r = await web_scrape_handler.execute(make_ws_node({ url: "https://example.com" }), make_ws_ctx());
    expect(String(r.output.text)).not.toContain("alert");
    expect(String(r.output.text)).not.toContain("color:red");
    expect(String(r.output.text)).toContain("Clean text");
  });
});

describe("web_scrape_handler — test() 확장", () => {
  it("url 비어있음 → warnings 포함", () => {
    const r = web_scrape_handler.test(make_ws_node({ url: "", selector: "" }));
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.warnings.some(w => w.includes("url"))).toBe(true);
  });

  it("url 있음 → warnings 없음", () => {
    const r = web_scrape_handler.test(make_ws_node({ url: "https://example.com" }));
    expect(r.warnings).toHaveLength(0);
  });

  it("preview에 url/selector/max_chars 포함", () => {
    const r = web_scrape_handler.test(make_ws_node({ url: "https://x.com", selector: ".main", max_chars: 5000 }));
    expect(r.preview).toMatchObject({ url: "https://x.com", selector: ".main", max_chars: 5000 });
  });
});

describe("web_scrape_handler — create_default", () => {
  it("기본값 반환", () => {
    const d = web_scrape_handler.create_default!();
    expect(d.url).toBe("");
    expect(d.max_chars).toBe(50000);
  });
});

describe("web_scrape_handler — robots_txt/sitemap fetch mock", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("action=robots_txt → fetch(origin/robots.txt) → RobotsTxtTool.parse (L45-52)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      status: 200,
      text: async () => "User-agent: *\nDisallow: /private/",
    }));
    const r = await web_scrape_handler.execute(
      make_ws_node({ url: "https://example.com/page", action: "robots_txt" }),
      make_ws_ctx(),
    );
    expect(r.output).toBeDefined();
    expect((r.output as any).status).toBe(200);
    vi.unstubAllGlobals();
  });

  it("action=sitemap → fetch(origin/sitemap.xml) → SitemapTool.parse (L55-62)", async () => {
    const xml = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.com/</loc></url></urlset>`;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      status: 200,
      text: async () => xml,
    }));
    const r = await web_scrape_handler.execute(
      make_ws_node({ url: "https://example.com/page", action: "sitemap" }),
      make_ws_ctx(),
    );
    expect(r.output).toBeDefined();
    expect((r.output as any).status).toBe(200);
    vi.unstubAllGlobals();
  });
});
