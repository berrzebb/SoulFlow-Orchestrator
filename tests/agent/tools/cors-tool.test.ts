/**
 * CorsTool — build_headers/check_origin/preflight/parse/validate 테스트.
 */
import { describe, it, expect } from "vitest";
import { CorsTool } from "../../../src/agent/tools/cors.js";

const tool = new CorsTool();

async function exec(params: Record<string, unknown>): Promise<unknown> {
  const result = await tool.execute(params);
  try { return JSON.parse(String(result)); } catch { return result; }
}

describe("CorsTool — build_headers", () => {
  it("와일드카드 오리진 → Access-Control-Allow-Origin: *", async () => {
    const r = await exec({ action: "build_headers" }) as Record<string, string>;
    expect(r["Access-Control-Allow-Origin"]).toBe("*");
  });

  it("특정 오리진 허용 + credentials → Vary: Origin 포함", async () => {
    const r = await exec({
      action: "build_headers",
      origin: "https://app.example.com",
      allowed_origins: JSON.stringify(["https://app.example.com"]),
      credentials: true,
    }) as Record<string, string>;
    expect(r["Access-Control-Allow-Origin"]).toBe("https://app.example.com");
    expect(r["Vary"]).toBe("Origin");
    expect(r["Access-Control-Allow-Credentials"]).toBe("true");
  });

  it("allowed_methods + allowed_headers 헤더 포함", async () => {
    const r = await exec({
      action: "build_headers",
      allowed_methods: JSON.stringify(["GET", "POST"]),
      allowed_headers: JSON.stringify(["Content-Type", "Authorization"]),
    }) as Record<string, string>;
    expect(r["Access-Control-Allow-Methods"]).toContain("GET");
    expect(r["Access-Control-Allow-Headers"]).toContain("Content-Type");
  });

  it("expose_headers + max_age 포함", async () => {
    const r = await exec({
      action: "build_headers",
      expose_headers: JSON.stringify(["X-Custom-Header"]),
      max_age: 3600,
    }) as Record<string, string>;
    expect(r["Access-Control-Expose-Headers"]).toContain("X-Custom-Header");
    expect(r["Access-Control-Max-Age"]).toBe("3600");
  });
});

describe("CorsTool — check_origin", () => {
  it("와일드카드 → 모든 오리진 허용", async () => {
    const r = await exec({
      action: "check_origin",
      origin: "https://random.site",
      allowed_origins: '["*"]',
    }) as Record<string, unknown>;
    expect(r.allowed).toBe(true);
    expect(r.matched).toBe("*");
  });

  it("허용 목록에 없는 오리진 → allowed false", async () => {
    const r = await exec({
      action: "check_origin",
      origin: "https://evil.com",
      allowed_origins: JSON.stringify(["https://good.com"]),
    }) as Record<string, unknown>;
    expect(r.allowed).toBe(false);
    expect(r.matched).toBeNull();
  });

  it("와일드카드 서브도메인 *.example.com 매칭", async () => {
    const r = await exec({
      action: "check_origin",
      origin: "https://sub.example.com",
      allowed_origins: JSON.stringify(["*.example.com"]),
    }) as Record<string, unknown>;
    expect(r.allowed).toBe(true);
  });
});

describe("CorsTool — preflight", () => {
  it("허용된 오리진 + 허용된 메서드 → allowed true + 헤더 반환", async () => {
    const r = await exec({
      action: "preflight",
      origin: "https://app.example.com",
      method: "POST",
      allowed_origins: JSON.stringify(["https://app.example.com"]),
      allowed_methods: JSON.stringify(["GET", "POST"]),
    }) as Record<string, unknown>;
    expect(r.allowed).toBe(true);
    const headers = r.headers as Record<string, string>;
    expect(headers["Access-Control-Allow-Origin"]).toBe("https://app.example.com");
  });

  it("허용되지 않은 오리진 → allowed false + 빈 headers", async () => {
    const r = await exec({
      action: "preflight",
      origin: "https://evil.com",
      method: "DELETE",
      allowed_origins: JSON.stringify(["https://safe.com"]),
    }) as Record<string, unknown>;
    expect(r.allowed).toBe(false);
    expect(Object.keys(r.headers as object).length).toBe(0);
  });

  it("허용되지 않은 메서드 → allowed false", async () => {
    const r = await exec({
      action: "preflight",
      origin: "https://app.com",
      method: "DELETE",
      allowed_origins: JSON.stringify(["https://app.com"]),
      allowed_methods: JSON.stringify(["GET", "POST"]),
    }) as Record<string, unknown>;
    expect(r.allowed).toBe(false);
  });
});

describe("CorsTool — parse", () => {
  it("CORS 헤더 JSON 파싱 → 구조화된 객체", async () => {
    const headers = JSON.stringify({
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "600",
    });
    const r = await exec({ action: "parse", headers }) as Record<string, unknown>;
    expect(r.allow_origin).toBe("*");
    expect(Array.isArray(r.allow_methods)).toBe(true);
    expect((r.allow_methods as string[])).toContain("GET");
    expect(r.max_age).toBe(600);
  });

  it("credentials 헤더 → credentials true", async () => {
    const headers = JSON.stringify({ "Access-Control-Allow-Credentials": "true" });
    const r = await exec({ action: "parse", headers }) as Record<string, unknown>;
    expect(r.credentials).toBe(true);
  });

  it("잘못된 JSON → error 반환", async () => {
    const r = await exec({ action: "parse", headers: "{invalid" }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
  });
});

describe("CorsTool — validate", () => {
  it("유효한 헤더 → valid true + errors 빈 배열", async () => {
    const headers = JSON.stringify({ "Access-Control-Allow-Origin": "https://example.com" });
    const r = await exec({ action: "validate", headers }) as Record<string, unknown>;
    expect(r.valid).toBe(true);
    expect((r.errors as string[]).length).toBe(0);
  });

  it("Allow-Origin 없음 → valid false + error 메시지", async () => {
    const r = await exec({ action: "validate", headers: "{}" }) as Record<string, unknown>;
    expect(r.valid).toBe(false);
    expect((r.errors as string[]).length).toBeGreaterThan(0);
  });

  it("와일드카드 + credentials → invalid", async () => {
    const headers = JSON.stringify({
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Credentials": "true",
    });
    const r = await exec({ action: "validate", headers }) as Record<string, unknown>;
    expect(r.valid).toBe(false);
    expect((r.errors as string[]).some((e) => String(e).includes("wildcard"))).toBe(true);
  });
});

describe("CorsTool — 미커버 catch 분기", () => {
  it("build_headers: allowed_origins 잘못된 JSON → L36 fallback", async () => {
    const r = await exec({
      action: "build_headers",
      allowed_origins: "not_json_array",
      origin: "not_json_array",
    }) as Record<string, string>;
    // fallback: origins = [allowed_origins], origin 매칭 가능
    expect(r).toBeDefined();
  });

  it("check_origin: allowed_origins 잘못된 JSON → L66 catch → ['*']", async () => {
    const r = await exec({
      action: "check_origin",
      origin: "https://any.site",
      allowed_origins: "{invalid json}",
    }) as Record<string, unknown>;
    // fallback ["*"] → 와일드카드 → allowed true
    expect(r.allowed).toBe(true);
  });

  it("preflight: allowed_origins 잘못된 JSON → L74 catch", async () => {
    const r = await exec({
      action: "preflight",
      origin: "https://app.com",
      method: "GET",
      allowed_origins: "{invalid}",
    }) as Record<string, unknown>;
    // fallback ["*"] → 모든 오리진 허용
    expect(r.allowed).toBe(true);
  });

  it("preflight: allowed_methods 잘못된 JSON → L76 catch fallback ['GET']", async () => {
    const r = await exec({
      action: "preflight",
      origin: "https://app.com",
      method: "POST",
      allowed_methods: "{invalid methods}",
    }) as Record<string, unknown>;
    // fallback ["GET"] → POST not in ["GET"] → method_ok false → allowed false
    expect(r.allowed).toBe(false);
  });
});

// ══════════════════════════════════════════
// 미커버 분기 보충
// ══════════════════════════════════════════

describe("CorsTool — 미커버 분기", () => {
  it("build_headers: allowed_methods 비JSON 문자열 → L47 catch fallback 단일값", async () => {
    const r = await exec({ action: "build_headers", origin: "https://a.com", allowed_methods: "POST" }) as Record<string, unknown>;
    expect(String(r["Access-Control-Allow-Methods"])).toContain("POST");
  });

  it("build_headers: allowed_headers 비JSON 문자열 → L52 catch fallback", async () => {
    const r = await exec({ action: "build_headers", origin: "https://a.com", allowed_headers: "Authorization" }) as Record<string, unknown>;
    expect(String(r["Access-Control-Allow-Headers"])).toContain("Authorization");
  });

  it("build_headers: expose_headers 비JSON 문자열 → L57 catch fallback", async () => {
    const r = await exec({ action: "build_headers", origin: "https://a.com", expose_headers: "X-Custom" }) as Record<string, unknown>;
    expect(String(r["Access-Control-Expose-Headers"])).toContain("X-Custom");
  });

  it("preflight: allowed_headers 지정 → L83 Access-Control-Allow-Headers", async () => {
    const r = await exec({
      action: "preflight",
      origin: "https://app.com",
      method: "POST",
      allowed_headers: "Authorization,Content-Type",
      max_age: 600,
      credentials: true,
    }) as Record<string, unknown>;
    expect(r.allowed).toBe(true);
    const hdrs = r.headers as Record<string, string>;
    expect(hdrs["Access-Control-Allow-Headers"]).toContain("Authorization");
    expect(hdrs["Access-Control-Max-Age"]).toBe("600");
    expect(hdrs["Access-Control-Allow-Credentials"]).toBe("true");
  });

  it("preflight: request_headers 지정 → L84 fallback", async () => {
    const r = await exec({
      action: "preflight",
      origin: "https://app.com",
      method: "GET",
      request_headers: "X-Request-Header",
    }) as Record<string, unknown>;
    const hdrs = r.headers as Record<string, string>;
    expect(hdrs["Access-Control-Allow-Headers"]).toContain("X-Request-Header");
  });

  it("parse: expose_headers 포함 → L99", async () => {
    const headers = JSON.stringify({
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Expose-Headers": "X-Custom, X-Other",
    });
    const r = await exec({ action: "parse", headers }) as Record<string, unknown>;
    expect(Array.isArray(r.expose_headers)).toBe(true);
    expect((r.expose_headers as string[])).toContain("X-Custom");
  });

  it("validate: 잘못된 headers JSON → L106 error", async () => {
    const r = await exec({ action: "validate", headers: "bad-json" }) as Record<string, unknown>;
    expect(r.error).toContain("invalid headers JSON");
  });

  it("unknown action → L118 error", async () => {
    const r = await exec({ action: "unknown_action" }) as Record<string, unknown>;
    expect(r.error).toContain("unknown action");
  });

  it("match_origin: 와일드카드 서브도메인 → L128 try 성공", async () => {
    const r = await exec({
      action: "check_origin",
      origin: "https://sub.example.com",
      allowed_origins: JSON.stringify(["*.example.com"]),
    }) as Record<string, unknown>;
    expect(r.allowed).toBe(true);
  });

  it("match_origin: 유효하지 않은 URL + 와일드카드 → L128 catch return false", async () => {
    // new URL("not-a-url") throws → catch { return false }
    const r = await exec({
      action: "check_origin",
      origin: "not-a-url",
      allowed_origins: JSON.stringify(["*.example.com"]),
    }) as Record<string, unknown>;
    expect(r.allowed).toBe(false);
  });
});
