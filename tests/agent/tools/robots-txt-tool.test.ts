/**
 * RobotsTxtTool — robots.txt 생성/파싱/접근 확인/검증 테스트.
 */
import { describe, it, expect } from "vitest";
import { RobotsTxtTool } from "../../../src/agent/tools/robots-txt.js";

const tool = new RobotsTxtTool();

async function exec(params: Record<string, unknown>): Promise<unknown> {
  const result = await tool.execute(params);
  try { return JSON.parse(String(result)); } catch { return result; }
}

const SAMPLE_ROBOTS = `User-agent: *
Allow: /
Disallow: /admin/
Disallow: /private/

User-agent: Googlebot
Allow: /
Crawl-delay: 5

Sitemap: https://example.com/sitemap.xml`;

describe("RobotsTxtTool — generate", () => {
  it("기본 robots.txt 생성", async () => {
    const rules = JSON.stringify([
      { user_agent: "*", allow: ["/"], disallow: ["/admin/", "/private/"] },
    ]);
    const r = String(await exec({ action: "generate", rules }));
    expect(r).toContain("User-agent: *");
    expect(r).toContain("Allow: /");
    expect(r).toContain("Disallow: /admin/");
    expect(r).toContain("Disallow: /private/");
  });

  it("crawl-delay 포함 생성", async () => {
    const rules = JSON.stringify([
      { user_agent: "Googlebot", allow: ["/"], disallow: [], crawl_delay: 10 },
    ]);
    const r = String(await exec({ action: "generate", rules }));
    expect(r).toContain("Crawl-delay: 10");
  });

  it("sitemap URL 포함 생성", async () => {
    const rules = JSON.stringify([{ user_agent: "*", allow: ["/"], disallow: [] }]);
    const r = String(await exec({ action: "generate", rules, sitemap: "https://example.com/sitemap.xml" }));
    expect(r).toContain("Sitemap: https://example.com/sitemap.xml");
  });

  it("기본 규칙 (빈 rules)", async () => {
    const r = String(await exec({ action: "generate" }));
    expect(r).toContain("User-agent: *");
    expect(r).toContain("Allow: /");
  });

  it("잘못된 rules JSON → error", async () => {
    const r = await exec({ action: "generate", rules: "bad" }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
  });
});

describe("RobotsTxtTool — parse", () => {
  it("robots.txt 파싱", async () => {
    const r = await exec({ action: "parse", robots: SAMPLE_ROBOTS }) as Record<string, unknown>;
    const rules = r.rules as { user_agent: string; allow: string[]; disallow: string[] }[];
    expect(rules.length).toBe(2);
    const global_rule = rules.find((r) => r.user_agent === "*");
    expect(global_rule?.disallow).toContain("/admin/");
    expect(global_rule?.allow).toContain("/");
  });

  it("sitemap 파싱", async () => {
    const r = await exec({ action: "parse", robots: SAMPLE_ROBOTS }) as Record<string, unknown>;
    const sitemaps = r.sitemaps as string[];
    expect(sitemaps).toContain("https://example.com/sitemap.xml");
  });

  it("crawl-delay 파싱", async () => {
    const r = await exec({ action: "parse", robots: SAMPLE_ROBOTS }) as Record<string, unknown>;
    const rules = r.rules as { user_agent: string; crawl_delay?: number }[];
    const google = rules.find((r) => r.user_agent === "Googlebot");
    expect(google?.crawl_delay).toBe(5);
  });

  it("주석 무시", async () => {
    const content = "# This is a comment\nUser-agent: *\nDisallow: /secret/";
    const r = await exec({ action: "parse", robots: content }) as Record<string, unknown>;
    const rules = r.rules as { disallow: string[] }[];
    expect(rules[0].disallow).toContain("/secret/");
  });
});

describe("RobotsTxtTool — check", () => {
  it("허용된 경로 → allowed: true", async () => {
    const r = await exec({ action: "check", robots: SAMPLE_ROBOTS, path: "/index.html", user_agent: "*" }) as Record<string, unknown>;
    expect(r.allowed).toBe(true);
  });

  it("차단된 경로 → allowed: false", async () => {
    const r = await exec({ action: "check", robots: SAMPLE_ROBOTS, path: "/admin/dashboard", user_agent: "*" }) as Record<string, unknown>;
    expect(r.allowed).toBe(false);
  });

  it("규칙이 없는 에이전트 → allowed: true (기본)", async () => {
    const robots = "User-agent: Bingbot\nDisallow: /private/";
    const r = await exec({ action: "check", robots, path: "/anything", user_agent: "Googlebot" }) as Record<string, unknown>;
    expect(r.allowed).toBe(true);
  });

  it("allow이 disallow보다 더 구체적 → 허용", async () => {
    const robots = "User-agent: *\nDisallow: /api/\nAllow: /api/public/";
    const r = await exec({ action: "check", robots, path: "/api/public/data", user_agent: "*" }) as Record<string, unknown>;
    expect(r.allowed).toBe(true);
  });
});

describe("RobotsTxtTool — validate", () => {
  it("유효한 robots.txt → valid: true", async () => {
    const r = await exec({ action: "validate", robots: SAMPLE_ROBOTS }) as Record<string, unknown>;
    expect(r.valid).toBe(true);
    expect((r.errors as string[]).length).toBe(0);
  });

  it("콜론 없는 줄 → error", async () => {
    const r = await exec({ action: "validate", robots: "User-agent *\nDisallow /admin" }) as Record<string, unknown>;
    expect(r.valid).toBe(false);
    expect((r.errors as string[]).some((e) => e.includes("colon"))).toBe(true);
  });

  it("User-agent 전에 Disallow → error", async () => {
    const r = await exec({ action: "validate", robots: "Disallow: /secret/" }) as Record<string, unknown>;
    expect(r.valid).toBe(false);
    expect((r.errors as string[]).some((e) => e.includes("before User-agent"))).toBe(true);
  });

  it("알 수 없는 directive → error", async () => {
    const r = await exec({ action: "validate", robots: "User-agent: *\nUnknown: value" }) as Record<string, unknown>;
    expect(r.valid).toBe(false);
  });
});
