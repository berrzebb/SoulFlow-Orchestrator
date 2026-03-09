/**
 * SitemapTool — XML sitemap 생성/파싱/검증/URL 추가/인덱스 생성 테스트.
 */
import { describe, it, expect } from "vitest";
import { SitemapTool } from "../../../src/agent/tools/sitemap.js";

const tool = new SitemapTool();

async function exec(params: Record<string, unknown>): Promise<unknown> {
  const result = await tool.execute(params);
  try { return JSON.parse(String(result)); } catch { return result; }
}

const URLS = JSON.stringify([
  { loc: "https://example.com/", lastmod: "2024-01-01", changefreq: "daily", priority: 1.0 },
  { loc: "https://example.com/about", changefreq: "monthly", priority: 0.8 },
]);

describe("SitemapTool — generate", () => {
  it("sitemap XML 생성", async () => {
    const r = String(await exec({ action: "generate", urls: URLS }));
    expect(r).toContain("<?xml version");
    expect(r).toContain("<urlset");
    expect(r).toContain("<loc>https://example.com/</loc>");
    expect(r).toContain("<lastmod>2024-01-01</lastmod>");
    expect(r).toContain("<changefreq>daily</changefreq>");
    expect(r).toContain("<priority>1</priority>");
  });

  it("옵션 필드 없는 URL", async () => {
    const urls = JSON.stringify([{ loc: "https://example.com/page" }]);
    const r = String(await exec({ action: "generate", urls }));
    expect(r).toContain("<loc>https://example.com/page</loc>");
    expect(r).not.toContain("<lastmod>");
  });

  it("잘못된 urls JSON → error", async () => {
    const r = await exec({ action: "generate", urls: "bad" }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
  });

  it("& 문자 이스케이프", async () => {
    const urls = JSON.stringify([{ loc: "https://example.com/?a=1&b=2" }]);
    const r = String(await exec({ action: "generate", urls }));
    expect(r).toContain("&amp;");
  });
});

describe("SitemapTool — parse", () => {
  it("sitemap XML 파싱", async () => {
    const xml = String(await exec({ action: "generate", urls: URLS }));
    const r = await exec({ action: "parse", sitemap: xml }) as { loc: string }[];
    expect(r.length).toBe(2);
    expect(r[0].loc).toBe("https://example.com/");
    expect(r[1].loc).toBe("https://example.com/about");
  });

  it("lastmod/changefreq/priority 파싱", async () => {
    const xml = String(await exec({ action: "generate", urls: URLS }));
    const r = await exec({ action: "parse", sitemap: xml }) as Record<string, unknown>[];
    expect(r[0].lastmod).toBe("2024-01-01");
    expect(r[0].changefreq).toBe("daily");
    expect(r[0].priority).toBe(1);
  });

  it("빈 sitemap → 빈 배열", async () => {
    const r = await exec({ action: "parse", sitemap: "<urlset></urlset>" }) as unknown[];
    expect(r.length).toBe(0);
  });
});

describe("SitemapTool — validate", () => {
  it("유효한 sitemap → valid: true", async () => {
    const xml = String(await exec({ action: "generate", urls: URLS }));
    const r = await exec({ action: "validate", sitemap: xml }) as Record<string, unknown>;
    expect(r.valid).toBe(true);
    expect(r.url_count).toBe(2);
  });

  it("urlset 없음 → error", async () => {
    const r = await exec({ action: "validate", sitemap: "<bad></bad>" }) as Record<string, unknown>;
    expect(r.valid).toBe(false);
    expect((r.errors as string[]).some((e) => e.includes("urlset"))).toBe(true);
  });

  it("xmlns 없음 → error", async () => {
    const r = await exec({ action: "validate", sitemap: "<urlset><url><loc>https://a.com</loc></url></urlset>" }) as Record<string, unknown>;
    expect(r.valid).toBe(false);
    expect((r.errors as string[]).some((e) => e.includes("xmlns"))).toBe(true);
  });
});

describe("SitemapTool — add_url", () => {
  it("기존 sitemap에 URL 추가", async () => {
    const xml = String(await exec({ action: "generate", urls: URLS }));
    const r = String(await exec({ action: "add_url", sitemap: xml, url: "https://example.com/new-page", changefreq: "weekly" }));
    expect(r).toContain("https://example.com/new-page");
    expect(r).toContain("<changefreq>weekly</changefreq>");
  });

  it("sitemap 없을 때 새로 생성", async () => {
    const r = String(await exec({ action: "add_url", url: "https://example.com/page", priority: "0.5" }));
    expect(r).toContain("<urlset");
    expect(r).toContain("https://example.com/page");
  });
});

describe("SitemapTool — to_index", () => {
  it("여러 sitemap으로 인덱스 생성", async () => {
    const sitemaps = JSON.stringify([
      "https://example.com/sitemap1.xml",
      "https://example.com/sitemap2.xml",
    ]);
    const r = String(await exec({ action: "to_index", sitemaps }));
    expect(r).toContain("<sitemapindex");
    expect(r).toContain("https://example.com/sitemap1.xml");
    expect(r).toContain("https://example.com/sitemap2.xml");
  });

  it("잘못된 sitemaps JSON → error", async () => {
    const r = await exec({ action: "to_index", sitemaps: "bad" }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
  });
});

// L69: unknown action → error (default branch)
describe("SitemapTool — unknown action (L69)", () => {
  it("알 수 없는 action → error 반환 (L69)", async () => {
    const r = await exec({ action: "unknown_action" }) as Record<string, unknown>;
    expect(r.error).toContain("unknown action");
  });
});
