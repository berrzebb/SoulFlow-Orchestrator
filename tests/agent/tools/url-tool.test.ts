/**
 * UrlTool — parse/build/resolve/encode/decode/query_params/join/normalize 테스트.
 */
import { describe, it, expect } from "vitest";
import { UrlTool } from "../../../src/agent/tools/url.js";

const tool = new UrlTool();

async function exec(params: Record<string, unknown>): Promise<unknown> {
  const result = await tool.execute(params);
  try { return JSON.parse(String(result)); } catch { return result; }
}

describe("UrlTool — parse", () => {
  it("완전한 URL 파싱 → 모든 필드 반환", async () => {
    const r = await exec({ action: "parse", url: "https://user:pass@example.com:8080/path?foo=bar#hash" }) as Record<string, unknown>;
    expect(r.protocol).toBe("https:");
    expect(r.host).toBe("example.com:8080");
    expect(r.pathname).toBe("/path");
    expect(r.hash).toBe("#hash");
    expect((r.query as Record<string, string>).foo).toBe("bar");
    expect(r.username).toBe("user");
    expect(r.password).toBe("pass");
  });

  it("쿼리 없는 URL → query 빈 객체", async () => {
    const r = await exec({ action: "parse", url: "https://example.com/" }) as Record<string, unknown>;
    expect(r.query).toEqual({});
    expect(r.search).toBe("");
  });

  it("잘못된 URL → error 필드 반환", async () => {
    const r = await exec({ action: "parse", url: "not-a-url" }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
  });
});

describe("UrlTool — build", () => {
  it("parts JSON으로 URL 조립", async () => {
    const r = await exec({
      action: "build",
      parts: JSON.stringify({ protocol: "https:", host: "example.com", pathname: "/api" }),
    }) as Record<string, unknown>;
    expect(String(r.url)).toContain("https://example.com/api");
  });

  it("parts + params로 쿼리스트링 추가", async () => {
    const r = await exec({
      action: "build",
      parts: JSON.stringify({ protocol: "http:", host: "localhost", pathname: "/" }),
      params: JSON.stringify({ page: "2", limit: "10" }),
    }) as Record<string, unknown>;
    expect(String(r.url)).toContain("page=2");
    expect(String(r.url)).toContain("limit=10");
  });

  it("잘못된 parts JSON → Error", async () => {
    const r = await exec({ action: "build", parts: "{invalid" });
    expect(String(r)).toContain("Error");
  });
});

describe("UrlTool — resolve", () => {
  it("상대 URL → 절대 URL 반환", async () => {
    const r = await exec({ action: "resolve", base: "https://example.com/a/b/", url: "../c" }) as Record<string, unknown>;
    expect(String(r.url)).toContain("example.com");
    expect(String(r.url)).toContain("/a/c");
  });

  it("base 없으면 Error", async () => {
    const r = await exec({ action: "resolve", url: "/path" });
    expect(String(r)).toContain("Error");
  });
});

describe("UrlTool — encode / decode", () => {
  it("encode component (기본) → 특수문자 인코딩", async () => {
    const r = await exec({ action: "encode", url: "hello world & more" }) as Record<string, unknown>;
    expect(String(r.encoded)).toBe("hello%20world%20%26%20more");
  });

  it("encode full → encodeURI 적용", async () => {
    const r = await exec({ action: "encode", url: "https://example.com/path?a=b&c=d", component: "full" }) as Record<string, unknown>;
    expect(String(r.encoded)).toContain("https://");
  });

  it("decode component → 원래 문자열 복원", async () => {
    const r = await exec({ action: "decode", url: "hello%20world%20%26%20more" }) as Record<string, unknown>;
    expect(r.decoded).toBe("hello world & more");
  });

  it("잘못된 인코딩 → error 반환", async () => {
    const r = await exec({ action: "decode", url: "%zz" }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
  });
});

describe("UrlTool — query_params", () => {
  it("params 없이 호출 → 기존 파라미터 목록 반환", async () => {
    const r = await exec({ action: "query_params", url: "https://example.com/?a=1&b=2" }) as Record<string, unknown>;
    expect((r.params as Record<string, string>).a).toBe("1");
    expect(r.count).toBe(2);
  });

  it("params 전달 → 쿼리 수정된 URL 반환", async () => {
    const r = await exec({
      action: "query_params",
      url: "https://example.com/?a=1",
      params: JSON.stringify({ a: "99", b: "new" }),
    }) as Record<string, unknown>;
    expect(String(r.url)).toContain("a=99");
    expect(String(r.url)).toContain("b=new");
  });

  it("null 값 → 해당 파라미터 삭제", async () => {
    const r = await exec({
      action: "query_params",
      url: "https://example.com/?a=1&b=2",
      params: JSON.stringify({ a: null }),
    }) as Record<string, unknown>;
    expect(String(r.url)).not.toContain("a=");
    expect(String(r.url)).toContain("b=2");
  });
});

describe("UrlTool — join", () => {
  it("세그먼트 배열 → 경로 결합", async () => {
    const r = await exec({ action: "join", segments: JSON.stringify(["/api", "v1", "users"]) }) as Record<string, unknown>;
    expect(r.path).toBe("/api/v1/users");
  });

  it("중간 슬래시 중복 제거", async () => {
    const r = await exec({ action: "join", segments: JSON.stringify(["https://example.com", "/api/", "/v2"]) }) as Record<string, unknown>;
    expect(String(r.path)).toBe("https://example.com/api/v2");
  });

  it("잘못된 JSON → Error", async () => {
    const r = await exec({ action: "join", segments: "not-json" });
    expect(String(r)).toContain("Error");
  });
});

describe("UrlTool — normalize", () => {
  it("쿼리스트링 정렬 + 후행 슬래시 제거", async () => {
    // normalize: 쿼리 파라미터 알파벳 정렬, URL 끝 슬래시 제거
    const r = await exec({ action: "normalize", url: "https://example.com/path?z=9&a=1" }) as Record<string, unknown>;
    expect(String(r.url)).toMatch(/a=1.*z=9/);
    expect(String(r.url)).not.toContain("z=9&a=1");
  });

  it("잘못된 URL → error 반환", async () => {
    const r = await exec({ action: "normalize", url: "not-a-url" }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
  });
});

// ══════════════════════════════════════════
// 미커버 분기
// ══════════════════════════════════════════

describe("UrlTool — 미커버 분기", () => {
  it("build: parts.search 사용 (params 없음, L68)", async () => {
    const r = await exec({
      action: "build",
      parts: JSON.stringify({ host: "example.com", search: "?foo=bar" }),
    }) as Record<string, unknown>;
    expect(String(r.url)).toContain("foo=bar");
  });

  it("resolve: 잘못된 base + relative → L81 error", async () => {
    const r = await exec({ action: "resolve", base: "not-a-url", url: "relative" }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
  });

  it("query_params: 잘못된 URL → L116 error", async () => {
    const r = await exec({ action: "query_params", url: "not-a-url" }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
  });

  it("unsupported action → L140 Error", async () => {
    const r = await exec({ action: "unknown_op" });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("unsupported");
  });
});
