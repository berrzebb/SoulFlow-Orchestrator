/**
 * CspTool — Content-Security-Policy 빌드/파싱/검증/병합/소스 체크 테스트.
 */
import { describe, it, expect } from "vitest";
import { CspTool } from "../../../src/agent/tools/csp.js";

const tool = new CspTool();

async function exec(params: Record<string, unknown>): Promise<unknown> {
  const result = await tool.execute(params);
  try { return JSON.parse(String(result)); } catch { return result; }
}

const SAMPLE_POLICY = "default-src 'self'; script-src 'self' https://cdn.example.com; img-src *";

describe("CspTool — build", () => {
  it("directives JSON → CSP 문자열", async () => {
    const directives = JSON.stringify({
      "default-src": ["'self'"],
      "script-src": ["'self'", "https://cdn.example.com"],
    });
    const r = String(await exec({ action: "build", directives }));
    expect(r).toContain("default-src 'self'");
    expect(r).toContain("script-src 'self' https://cdn.example.com");
  });

  it("빈 directives → 빈 문자열", async () => {
    const r = String(await exec({ action: "build", directives: "{}" }));
    expect(r).toBe("");
  });

  it("잘못된 directives JSON → error", async () => {
    const r = await exec({ action: "build", directives: "bad" }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
  });

  it("소스 없는 directive (flag-like)", async () => {
    const directives = JSON.stringify({ "upgrade-insecure-requests": [] });
    const r = String(await exec({ action: "build", directives }));
    expect(r).toContain("upgrade-insecure-requests");
  });
});

describe("CspTool — parse", () => {
  it("CSP 문자열 파싱", async () => {
    const r = await exec({ action: "parse", policy: SAMPLE_POLICY }) as Record<string, unknown>;
    expect(r.directive_count).toBe(3);
    const directives = r.directives as Record<string, string[]>;
    expect(directives["default-src"]).toContain("'self'");
    expect(directives["script-src"]).toContain("https://cdn.example.com");
    expect(directives["img-src"]).toContain("*");
  });

  it("빈 policy → 0 directives", async () => {
    const r = await exec({ action: "parse", policy: "" }) as Record<string, unknown>;
    expect(r.directive_count).toBe(0);
  });
});

describe("CspTool — validate", () => {
  it("유효한 CSP → valid: true", async () => {
    const policy = "default-src 'self'; img-src 'self' https:";
    const r = await exec({ action: "validate", policy }) as Record<string, unknown>;
    expect(r.valid).toBe(true);
    expect((r.errors as string[]).length).toBe(0);
  });

  it("알 수 없는 directive → error", async () => {
    const r = await exec({ action: "validate", policy: "unknown-directive 'self'" }) as Record<string, unknown>;
    expect(r.valid).toBe(false);
    expect((r.errors as string[]).some((e) => e.includes("unknown directive"))).toBe(true);
  });

  it("unsafe-inline → warning", async () => {
    const r = await exec({ action: "validate", policy: "script-src 'self' 'unsafe-inline'" }) as Record<string, unknown>;
    expect((r.warnings as string[]).some((w) => w.includes("unsafe-inline"))).toBe(true);
  });

  it("unsafe-eval → warning", async () => {
    const r = await exec({ action: "validate", policy: "script-src 'self' 'unsafe-eval'" }) as Record<string, unknown>;
    expect((r.warnings as string[]).some((w) => w.includes("unsafe-eval"))).toBe(true);
  });

  it("와일드카드(*) → warning", async () => {
    const r = await exec({ action: "validate", policy: "img-src *" }) as Record<string, unknown>;
    expect((r.warnings as string[]).some((w) => w.includes("wildcard"))).toBe(true);
  });

  it("default-src 없음 → warning", async () => {
    const r = await exec({ action: "validate", policy: "img-src 'self'" }) as Record<string, unknown>;
    expect((r.warnings as string[]).some((w) => w.includes("default-src"))).toBe(true);
  });
});

describe("CspTool — merge", () => {
  it("두 CSP 정책 병합 (소스 합집합)", async () => {
    const policy = "default-src 'self'; script-src 'self'";
    const policy2 = "script-src https://cdn.example.com; style-src 'self'";
    const r = String(await exec({ action: "merge", policy, policy2 }));
    expect(r).toContain("default-src");
    expect(r).toContain("https://cdn.example.com");
    expect(r).toContain("style-src");
  });

  it("중복 소스 제거", async () => {
    const policy = "script-src 'self' https://a.com";
    const policy2 = "script-src 'self' https://b.com";
    const r = String(await exec({ action: "merge", policy, policy2 }));
    // 'self'는 한 번만 등장
    const matches = r.match(/'self'/g);
    expect(matches?.length).toBe(1);
  });
});

describe("CspTool — check_source", () => {
  it("허용된 소스 → allowed: true", async () => {
    const r = await exec({ action: "check_source", policy: SAMPLE_POLICY, directive: "script-src", source: "https://cdn.example.com" }) as Record<string, unknown>;
    expect(r.allowed).toBe(true);
  });

  it("허용되지 않은 소스 → allowed: false", async () => {
    const r = await exec({ action: "check_source", policy: "script-src 'self'", directive: "script-src", source: "https://evil.com" }) as Record<string, unknown>;
    expect(r.allowed).toBe(false);
  });

  it("와일드카드 → 모든 소스 허용", async () => {
    const r = await exec({ action: "check_source", policy: "img-src *", directive: "img-src", source: "https://any.com" }) as Record<string, unknown>;
    expect(r.allowed).toBe(true);
  });

  it("directive 없을 때 default-src 폴백", async () => {
    const r = await exec({ action: "check_source", policy: "default-src 'self'", directive: "script-src", source: "'self'" }) as Record<string, unknown>;
    expect(r.allowed).toBe(true);
  });

  it("와일드카드 서브도메인 매칭", async () => {
    const r = await exec({ action: "check_source", policy: "img-src *.example.com", directive: "img-src", source: "cdn.example.com" }) as Record<string, unknown>;
    expect(r.allowed).toBe(true);
  });
});
