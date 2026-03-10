/**
 * web_scrape_handler — URL 검증 / private host 차단 / fetch mock 기반 추가 커버리지.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { web_scrape_handler } from "../../../src/agent/nodes/web-scrape.js";
import type { OrcheNodeDefinition } from "../../../src/agent/nodes/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "../../../src/agent/nodes/orche-node-executor.js";

afterEach(() => {
  vi.restoreAllMocks();
});

function make_node(overrides: Record<string, unknown> = {}): OrcheNodeDefinition {
  return { node_id: "n1", node_type: "web_scrape", ...overrides } as OrcheNodeDefinition;
}

function make_ctx(memory: Record<string, unknown> = {}): OrcheNodeExecutorContext {
  return { memory, workspace: "/tmp", abort_signal: undefined };
}

// ══════════════════════════════════════════
// URL 검증 (네트워크 없이)
// ══════════════════════════════════════════

describe("web_scrape_handler — URL 검증", () => {
  it("url 비어있음 → error: url is empty", async () => {
    const r = await web_scrape_handler.execute(make_node({ url: "" }), make_ctx());
    expect(r.output.error).toContain("url is empty");
    expect(r.output.status).toBe(0);
  });

  it("url 공백만 → error: url is empty", async () => {
    const r = await web_scrape_handler.execute(make_node({ url: "   " }), make_ctx());
    expect(r.output.error).toContain("url is empty");
  });

  it("ftp:// 프로토콜 → unsupported protocol", async () => {
    const r = await web_scrape_handler.execute(make_node({ url: "ftp://example.com" }), make_ctx());
    expect(String(r.output.error)).toContain("unsupported protocol");
  });

  it("file:// 프로토콜 → unsupported protocol", async () => {
    const r = await web_scrape_handler.execute(make_node({ url: "file:///etc/passwd" }), make_ctx());
    expect(String(r.output.error)).toContain("unsupported protocol");
  });

  it("파싱 불가 URL → invalid URL", async () => {
    const r = await web_scrape_handler.execute(make_node({ url: "not-a-url-!!!" }), make_ctx());
    expect(String(r.output.error)).toContain("invalid URL");
  });

  it("private host 127.0.0.1 → blocked private host", async () => {
    const r = await web_scrape_handler.execute(make_node({ url: "http://127.0.0.1/path" }), make_ctx());
    expect(String(r.output.error)).toContain("blocked");
  });

  it("private host 192.168.x.x → blocked", async () => {
    const r = await web_scrape_handler.execute(make_node({ url: "http://192.168.1.100/" }), make_ctx());
    expect(String(r.output.error)).toContain("blocked");
  });

  it("private host 10.x.x.x → blocked", async () => {
    const r = await web_scrape_handler.execute(make_node({ url: "http://10.0.0.1/" }), make_ctx());
    expect(String(r.output.error)).toContain("blocked");
  });

  it("private host 169.254.x.x (link-local) → blocked", async () => {
    const r = await web_scrape_handler.execute(make_node({ url: "http://169.254.169.254/latest/meta-data/" }), make_ctx());
    expect(String(r.output.error)).toContain("blocked");
  });

  it("private host localhost → blocked", async () => {
    const r = await web_scrape_handler.execute(make_node({ url: "http://localhost:8080/" }), make_ctx());
    expect(String(r.output.error)).toContain("blocked");
  });

  it("IPv6 loopback ::1 → blocked", async () => {
    const r = await web_scrape_handler.execute(make_node({ url: "http://[::1]/" }), make_ctx());
    expect(String(r.output.error)).toContain("blocked");
  });
});

// ══════════════════════════════════════════
// fetch mock — 정상 응답 / 잘라내기
// ══════════════════════════════════════════

describe("web_scrape_handler — fetch mock", () => {
  it("정상 HTML 응답 → text/title/status 반환", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      headers: { get: () => "text/html; charset=utf-8" },
      status: 200,
      text: async () => "<html><head><title>Test Page</title></head><body><p>Hello World</p></body></html>",
    } as unknown as Response);

    const r = await web_scrape_handler.execute(make_node({ url: "https://example.com" }), make_ctx());
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
      make_node({ url: "https://example.com", max_chars: 1000 }),
      make_ctx()
    );
    expect(String(r.output.text)).toContain("(truncated)");
    expect(String(r.output.text).length).toBeLessThanOrEqual(1100); // 1000 + 조금
  });

  it("fetch 에러 → error 필드 포함", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("network failure"));

    const r = await web_scrape_handler.execute(make_node({ url: "https://example.com" }), make_ctx());
    expect(String(r.output.error)).toContain("network failure");
    expect(r.output.status).toBe(0);
  });

  it("script/style 태그 제거된 텍스트 반환", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      headers: { get: () => "text/html" },
      status: 200,
      text: async () => "<html><head><script>alert(1)</script><style>.x{color:red}</style></head><body>Clean text</body></html>",
    } as unknown as Response);

    const r = await web_scrape_handler.execute(make_node({ url: "https://example.com" }), make_ctx());
    expect(String(r.output.text)).not.toContain("alert");
    expect(String(r.output.text)).not.toContain("color:red");
    expect(String(r.output.text)).toContain("Clean text");
  });
});

// ══════════════════════════════════════════
// test() 함수
// ══════════════════════════════════════════

describe("web_scrape_handler — test()", () => {
  it("url 비어있음 → warnings 포함", () => {
    const r = web_scrape_handler.test(make_node({ url: "", selector: "" }));
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.warnings.some(w => w.includes("url"))).toBe(true);
  });

  it("url 있음 → warnings 없음", () => {
    const r = web_scrape_handler.test(make_node({ url: "https://example.com" }));
    expect(r.warnings).toHaveLength(0);
  });

  it("preview에 url/selector/max_chars 포함", () => {
    const r = web_scrape_handler.test(make_node({ url: "https://x.com", selector: ".main", max_chars: 5000 }));
    expect(r.preview).toMatchObject({ url: "https://x.com", selector: ".main", max_chars: 5000 });
  });
});

// ══════════════════════════════════════════
// create_default
// ══════════════════════════════════════════

describe("web_scrape_handler — create_default", () => {
  it("기본값 반환", () => {
    const d = web_scrape_handler.create_default!();
    expect(d.url).toBe("");
    expect(d.max_chars).toBe(50000);
  });
});
