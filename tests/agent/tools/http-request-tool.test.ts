/**
 * HttpRequestTool + apply_auth + http-utils 커버리지.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { HttpRequestTool } from "@src/agent/tools/http-request.js";

function make_tool() { return new HttpRequestTool(); }

function mock_fetch(status: number, body: string, content_type = "application/json") {
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(body, {
      status,
      headers: { "content-type": content_type },
    }),
  );
}

afterEach(() => { vi.restoreAllMocks(); });

// ══════════════════════════════════════════
// 메타데이터
// ══════════════════════════════════════════

describe("HttpRequestTool — 메타데이터", () => {
  it("name = http_request", () => expect(make_tool().name).toBe("http_request"));
  it("category = web", () => expect(make_tool().category).toBe("web"));
  it("to_schema type = function", () => expect(make_tool().to_schema().type).toBe("function"));
});

// ══════════════════════════════════════════
// URL 검증
// ══════════════════════════════════════════

describe("HttpRequestTool — URL 검증", () => {
  it("url 없음 → Error", async () => {
    const r = await make_tool().execute({ url: "" });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("url");
  });

  it("잘못된 URL → Error", async () => {
    const r = await make_tool().execute({ url: "not-a-url" });
    expect(String(r)).toContain("Error");
  });

  it("ftp:// → Error (unsupported protocol)", async () => {
    const r = await make_tool().execute({ url: "ftp://example.com/file" });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("protocol");
  });

  it("127.0.0.1 → Error (private host)", async () => {
    const r = await make_tool().execute({ url: "http://127.0.0.1/api" });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("private");
  });
});

// ══════════════════════════════════════════
// GET 요청
// ══════════════════════════════════════════

describe("HttpRequestTool — GET 성공", () => {
  it("JSON 응답 파싱", async () => {
    mock_fetch(200, '{"name":"test"}');
    const r = JSON.parse(await make_tool().execute({ url: "https://api.example.com/v1/data" }));
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ name: "test" });
    expect(r.truncated).toBe(false);
  });

  it("비 JSON text 응답 → body는 문자열", async () => {
    mock_fetch(200, "Hello World", "text/plain");
    const r = JSON.parse(await make_tool().execute({ url: "https://example.com/text" }));
    expect(r.body).toBe("Hello World");
    expect(r.content_type).toBe("text/plain");
  });

  it("응답 max_chars 초과 → truncated=true", async () => {
    const big = "x".repeat(200);
    mock_fetch(200, big, "text/plain");
    const r = JSON.parse(await make_tool().execute({
      url: "https://example.com/big",
      max_response_chars: 100,
    }));
    expect(r.truncated).toBe(true);
  });
});

// ══════════════════════════════════════════
// POST / 메서드
// ══════════════════════════════════════════

describe("HttpRequestTool — POST/PUT/PATCH/DELETE", () => {
  it("POST with object body → Content-Type: application/json 자동 설정", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response('{"id":1}', { status: 201, headers: { "content-type": "application/json" } }),
    );
    await make_tool().execute({
      url: "https://api.example.com/items",
      method: "POST",
      body: { name: "item" },
    });
    const call_headers = (spy.mock.calls[0][1]?.headers as Record<string, string>) || {};
    expect(call_headers["Content-Type"]).toBe("application/json");
  });

  it("POST with string body → 그대로 전송", async () => {
    mock_fetch(200, "ok", "text/plain");
    const r = JSON.parse(await make_tool().execute({
      url: "https://api.example.com/raw",
      method: "POST",
      body: "raw body",
    }));
    expect(r.status).toBe(200);
  });

  it("DELETE 요청 성공", async () => {
    mock_fetch(200, "");
    const r = JSON.parse(await make_tool().execute({
      url: "https://api.example.com/items/1",
      method: "DELETE",
    }));
    expect(r.status).toBe(200);
  });
});

// ══════════════════════════════════════════
// 인증
// ══════════════════════════════════════════

describe("HttpRequestTool — 인증", () => {
  it("bearer 인증 → Authorization: Bearer 헤더", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
    );
    await make_tool().execute({
      url: "https://api.example.com/secure",
      auth: { type: "bearer", token: "my-token" },
    });
    const hdrs = (spy.mock.calls[0][1]?.headers as Record<string, string>) || {};
    expect(hdrs["Authorization"]).toBe("Bearer my-token");
  });

  it("basic 인증 → Authorization: Basic 헤더", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
    );
    await make_tool().execute({
      url: "https://api.example.com/secure",
      auth: { type: "basic", username: "user", password: "pass" },
    });
    const hdrs = (spy.mock.calls[0][1]?.headers as Record<string, string>) || {};
    expect(hdrs["Authorization"]).toMatch(/^Basic /);
    const decoded = Buffer.from(hdrs["Authorization"].replace("Basic ", ""), "base64").toString();
    expect(decoded).toBe("user:pass");
  });

  it("api_key 인증 → X-API-Key 헤더", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
    );
    await make_tool().execute({
      url: "https://api.example.com/secure",
      auth: { type: "api_key", key: "secret123" },
    });
    const hdrs = (spy.mock.calls[0][1]?.headers as Record<string, string>) || {};
    expect(hdrs["X-API-Key"]).toBe("secret123");
  });

  it("api_key 커스텀 헤더명", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
    );
    await make_tool().execute({
      url: "https://api.example.com/secure",
      auth: { type: "api_key", header_name: "X-Custom-Key", key: "abc" },
    });
    const hdrs = (spy.mock.calls[0][1]?.headers as Record<string, string>) || {};
    expect(hdrs["X-Custom-Key"]).toBe("abc");
  });

  it("auth=null → 헤더 변화 없음", async () => {
    mock_fetch(200, "{}");
    const r = JSON.parse(await make_tool().execute({
      url: "https://api.example.com/open",
      auth: null,
    }));
    expect(r.status).toBe(200);
  });

  it("auth=array → 인증 무시", async () => {
    mock_fetch(200, "{}");
    const r = JSON.parse(await make_tool().execute({
      url: "https://api.example.com/open",
      auth: ["bearer", "token"],
    }));
    expect(r.status).toBe(200);
  });
});

// ══════════════════════════════════════════
// 네트워크 오류
// ══════════════════════════════════════════

describe("HttpRequestTool — 네트워크 오류", () => {
  it("fetch 실패 → Error 반환", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("network error"));
    const r = await make_tool().execute({ url: "https://api.example.com/fail" });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("network error");
  });
});

// ══════════════════════════════════════════
// 헤더 커스텀
// ══════════════════════════════════════════

describe("HttpRequestTool — 커스텀 헤더", () => {
  it("headers 객체 → 요청에 포함", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
    );
    await make_tool().execute({
      url: "https://api.example.com/data",
      headers: { "X-Request-Id": "req-123", "Accept": "application/json" },
    });
    const hdrs = (spy.mock.calls[0][1]?.headers as Record<string, string>) || {};
    expect(hdrs["X-Request-Id"]).toBe("req-123");
  });

  it("headers가 배열 → 빈 헤더 (무시)", async () => {
    mock_fetch(200, "{}");
    const r = JSON.parse(await make_tool().execute({
      url: "https://api.example.com/data",
      headers: ["X-Foo: bar"] as any,
    }));
    expect(r.status).toBe(200);
  });
});

// ══════════════════════════════════════════
// JSON parse 실패 → 문자열 유지
// ══════════════════════════════════════════

describe("HttpRequestTool — JSON 파싱 실패", () => {
  it("content-type=json 이지만 invalid JSON → body는 문자열", async () => {
    mock_fetch(200, "not valid json{{{", "application/json");
    const r = JSON.parse(await make_tool().execute({ url: "https://api.example.com/bad-json" }));
    expect(typeof r.body).toBe("string");
    expect(r.body).toContain("not valid json");
  });
});
