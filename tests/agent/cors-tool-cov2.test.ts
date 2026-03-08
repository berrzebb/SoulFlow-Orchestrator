/**
 * CorsTool — 미커버 분기 보충.
 * build_headers 특정 origin 일치(Vary), credentials, non-JSON 폴백, max_age,
 * preflight 특정 origin/credentials/request_headers/max_age,
 * validate missing origin/wildcard+credentials 에러,
 * match_origin '*.' 와일드카드, check_origin 불일치 케이스.
 */
import { describe, it, expect } from "vitest";
import { CorsTool } from "@src/agent/tools/cors.js";

const tool = new CorsTool();

async function run(params: Record<string, unknown>): Promise<unknown> {
  return JSON.parse(await (tool as any).run(params));
}

// ══════════════════════════════════════════
// build_headers — 특정 origin 일치 → Vary 헤더 포함
// ══════════════════════════════════════════

describe("CorsTool — build_headers: 특정 origin 일치 + Vary", () => {
  it("allowed_origins=['https://example.com'], origin 일치 → Vary 포함", async () => {
    const r = await run({
      action: "build_headers",
      origin: "https://example.com",
      allowed_origins: JSON.stringify(["https://example.com"]),
    }) as Record<string, string>;
    expect(r["Access-Control-Allow-Origin"]).toBe("https://example.com");
    expect(r["Vary"]).toBe("Origin");
  });

  it("origin 불일치 → Access-Control-Allow-Origin 없음", async () => {
    const r = await run({
      action: "build_headers",
      origin: "https://evil.com",
      allowed_origins: JSON.stringify(["https://example.com"]),
    }) as Record<string, string>;
    expect(r["Access-Control-Allow-Origin"]).toBeUndefined();
  });
});

// ══════════════════════════════════════════
// build_headers — credentials
// ══════════════════════════════════════════

describe("CorsTool — build_headers: credentials", () => {
  it("credentials=true + 특정 origin → Allow-Credentials: true", async () => {
    const r = await run({
      action: "build_headers",
      origin: "https://app.com",
      allowed_origins: JSON.stringify(["https://app.com"]),
      credentials: true,
    }) as Record<string, string>;
    expect(r["Access-Control-Allow-Credentials"]).toBe("true");
    expect(r["Vary"]).toBe("Origin");
  });

  it("credentials=true + wildcard → wildcard 비적용, credentials 적용", async () => {
    // wildcard + credentials → origin 특정 매칭 경로
    const r = await run({
      action: "build_headers",
      origin: "https://site.com",
      allowed_origins: JSON.stringify(["*"]),
      credentials: true,
    }) as Record<string, string>;
    // wildcard이지만 credentials가 있으므로 origin 특정 매칭 경로로 진입
    expect(r["Access-Control-Allow-Credentials"]).toBe("true");
  });
});

// ══════════════════════════════════════════
// build_headers — non-JSON 폴백 (methods/headers/expose)
// ══════════════════════════════════════════

describe("CorsTool — build_headers: non-JSON 폴백", () => {
  it("allowed_methods가 non-JSON 문자열 → 그대로 사용", async () => {
    const r = await run({
      action: "build_headers",
      allowed_origins: JSON.stringify(["*"]),
      allowed_methods: "GET, POST",  // JSON 아님
    }) as Record<string, string>;
    expect(r["Access-Control-Allow-Methods"]).toBe("GET, POST");
  });

  it("allowed_headers가 non-JSON 문자열 → 그대로 사용", async () => {
    const r = await run({
      action: "build_headers",
      allowed_origins: JSON.stringify(["*"]),
      allowed_headers: "Content-Type",  // JSON 아님
    }) as Record<string, string>;
    expect(r["Access-Control-Allow-Headers"]).toBe("Content-Type");
  });

  it("expose_headers가 non-JSON 문자열 → 그대로 사용", async () => {
    const r = await run({
      action: "build_headers",
      allowed_origins: JSON.stringify(["*"]),
      expose_headers: "X-Custom-Header",  // JSON 아님
    }) as Record<string, string>;
    expect(r["Access-Control-Expose-Headers"]).toBe("X-Custom-Header");
  });
});

// ══════════════════════════════════════════
// build_headers — max_age
// ══════════════════════════════════════════

describe("CorsTool — build_headers: max_age", () => {
  it("max_age=3600 → Access-Control-Max-Age 헤더 포함", async () => {
    const r = await run({
      action: "build_headers",
      allowed_origins: JSON.stringify(["*"]),
      max_age: 3600,
    }) as Record<string, string>;
    expect(r["Access-Control-Max-Age"]).toBe("3600");
  });
});

// ══════════════════════════════════════════
// preflight — 특정 origin (non-wildcard)
// ══════════════════════════════════════════

describe("CorsTool — preflight: 특정 origin", () => {
  it("특정 origin 일치 → origin echo, allowed=true", async () => {
    const r = await run({
      action: "preflight",
      origin: "https://frontend.com",
      method: "POST",
      allowed_origins: JSON.stringify(["https://frontend.com"]),
      allowed_methods: JSON.stringify(["GET", "POST"]),
    }) as any;
    expect(r.allowed).toBe(true);
    expect(r.headers["Access-Control-Allow-Origin"]).toBe("https://frontend.com");
  });

  it("origin 불일치 → allowed=false, headers 없음", async () => {
    const r = await run({
      action: "preflight",
      origin: "https://attacker.com",
      method: "GET",
      allowed_origins: JSON.stringify(["https://trusted.com"]),
    }) as any;
    expect(r.allowed).toBe(false);
    expect(Object.keys(r.headers)).toHaveLength(0);
  });
});

// ══════════════════════════════════════════
// preflight — credentials + max_age
// ══════════════════════════════════════════

describe("CorsTool — preflight: credentials + max_age", () => {
  it("credentials=true → Allow-Credentials 헤더", async () => {
    const r = await run({
      action: "preflight",
      origin: "https://app.example.com",
      method: "GET",
      allowed_origins: JSON.stringify(["*"]),
      credentials: true,
    }) as any;
    expect(r.headers["Access-Control-Allow-Credentials"]).toBe("true");
  });

  it("max_age=600 → Allow-Max-Age 헤더", async () => {
    const r = await run({
      action: "preflight",
      origin: "https://test.com",
      method: "GET",
      allowed_origins: JSON.stringify(["*"]),
      max_age: 600,
    }) as any;
    expect(r.headers["Access-Control-Max-Age"]).toBe("600");
  });
});

// ══════════════════════════════════════════
// preflight — request_headers 폴백
// ══════════════════════════════════════════

describe("CorsTool — preflight: request_headers 폴백", () => {
  it("allowed_headers 없고 request_headers 있을 때 → request_headers 사용", async () => {
    const r = await run({
      action: "preflight",
      origin: "https://test.com",
      method: "POST",
      allowed_origins: JSON.stringify(["*"]),
      request_headers: "Content-Type, Authorization",
      // allowed_headers 없음
    }) as any;
    expect(r.headers["Access-Control-Allow-Headers"]).toBe("Content-Type, Authorization");
  });

  it("allowed_headers와 request_headers 모두 있을 때 → allowed_headers 우선", async () => {
    const r = await run({
      action: "preflight",
      origin: "https://test.com",
      method: "POST",
      allowed_origins: JSON.stringify(["*"]),
      allowed_headers: "X-API-Key",
      request_headers: "Content-Type",
    }) as any;
    expect(r.headers["Access-Control-Allow-Headers"]).toBe("X-API-Key");
  });
});

// ══════════════════════════════════════════
// validate — 에러 케이스
// ══════════════════════════════════════════

describe("CorsTool — validate: 에러 케이스", () => {
  it("Allow-Origin 없음 → errors에 'missing Access-Control-Allow-Origin'", async () => {
    const r = await run({
      action: "validate",
      headers: JSON.stringify({ "Content-Type": "application/json" }),
    }) as any;
    expect(r.valid).toBe(false);
    expect(r.errors).toContain("missing Access-Control-Allow-Origin");
  });

  it("wildcard + credentials=true → errors에 'wildcard origin with credentials is invalid'", async () => {
    const r = await run({
      action: "validate",
      headers: JSON.stringify({
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Credentials": "true",
      }),
    }) as any;
    expect(r.valid).toBe(false);
    expect(r.errors).toContain("wildcard origin with credentials is invalid");
  });

  it("유효한 헤더 → valid=true, errors=[]", async () => {
    const r = await run({
      action: "validate",
      headers: JSON.stringify({ "Access-Control-Allow-Origin": "https://example.com" }),
    }) as any;
    expect(r.valid).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it("invalid JSON → error 반환", async () => {
    const r = await run({
      action: "validate",
      headers: "not-json",
    }) as any;
    expect(r.error).toBe("invalid headers JSON");
  });
});

// ══════════════════════════════════════════
// check_origin — match_origin '*.' 와일드카드
// ══════════════════════════════════════════

describe("CorsTool — check_origin: '*.' 와일드카드 패턴", () => {
  it("*.example.com 패턴 → sub.example.com 일치", async () => {
    const r = await run({
      action: "check_origin",
      origin: "https://sub.example.com",
      allowed_origins: JSON.stringify(["*.example.com"]),
    }) as any;
    expect(r.allowed).toBe(true);
  });

  it("*.example.com 패턴 → other.org 불일치", async () => {
    const r = await run({
      action: "check_origin",
      origin: "https://other.org",
      allowed_origins: JSON.stringify(["*.example.com"]),
    }) as any;
    expect(r.allowed).toBe(false);
    expect(r.matched).toBeNull();
  });

  it("*.example.com 패턴 → 잘못된 URL 불일치 (에러 격리)", async () => {
    const r = await run({
      action: "check_origin",
      origin: "not-a-url",
      allowed_origins: JSON.stringify(["*.example.com"]),
    }) as any;
    expect(r.allowed).toBe(false);
  });
});

// ══════════════════════════════════════════
// check_origin — wildcard '*'
// ══════════════════════════════════════════

describe("CorsTool — check_origin: wildcard '*'", () => {
  it("allowed_origins=['*'] → 모든 origin 허용", async () => {
    const r = await run({
      action: "check_origin",
      origin: "https://any.com",
      allowed_origins: JSON.stringify(["*"]),
    }) as any;
    expect(r.allowed).toBe(true);
    expect(r.matched).toBe("*");
  });
});

// ══════════════════════════════════════════
// parse — invalid JSON 에러
// ══════════════════════════════════════════

describe("CorsTool — parse: invalid JSON", () => {
  it("invalid JSON → error 반환", async () => {
    const r = await run({
      action: "parse",
      headers: "invalid-json",
    }) as any;
    expect(r.error).toBe("invalid headers JSON");
  });

  it("유효한 CORS 헤더 파싱", async () => {
    const r = await run({
      action: "parse",
      headers: JSON.stringify({
        "Access-Control-Allow-Origin": "https://example.com",
        "Access-Control-Allow-Methods": "GET, POST",
        "Access-Control-Max-Age": "3600",
        "Access-Control-Allow-Credentials": "true",
      }),
    }) as any;
    expect(r.allow_origin).toBe("https://example.com");
    expect(r.allow_methods).toEqual(["GET", "POST"]);
    expect(r.max_age).toBe(3600);
    expect(r.credentials).toBe(true);
  });
});

// ══════════════════════════════════════════
// unknown action
// ══════════════════════════════════════════

describe("CorsTool — unknown action", () => {
  it("알 수 없는 action → error 반환", async () => {
    const r = await run({ action: "nonexistent" }) as any;
    expect(r.error).toContain("unknown action");
  });
});
