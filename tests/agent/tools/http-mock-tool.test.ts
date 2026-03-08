/**
 * HttpMockTool — register/match/list/clear/record/replay/generate_response 커버리지.
 * 주의: http-mock은 모듈 레벨 상태를 가지므로 각 테스트 간 clear 필요.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { HttpMockTool } from "@src/agent/tools/http-mock.js";

function make_tool() { return new HttpMockTool(); }

// 테스트 격리: 항상 clear
beforeEach(async () => {
  await make_tool().execute({ action: "clear" });
});

// ══════════════════════════════════════════
// 메타데이터
// ══════════════════════════════════════════

describe("HttpMockTool — 메타데이터", () => {
  it("name = http_mock", () => expect(make_tool().name).toBe("http_mock"));
  it("category = data", () => expect(make_tool().category).toBe("data"));
  it("to_schema type = function", () => expect(make_tool().to_schema().type).toBe("function"));
});

// ══════════════════════════════════════════
// register
// ══════════════════════════════════════════

describe("HttpMockTool — register", () => {
  it("기본값으로 등록", async () => {
    const r = JSON.parse(await make_tool().execute({ action: "register", path: "/api/test" }));
    expect(r.registered).toBe(true);
    expect(r.key).toBe("GET:/api/test");
    expect(r.route.method).toBe("GET");
    expect(r.route.status).toBe(200);
  });

  it("POST method 등록", async () => {
    const r = JSON.parse(await make_tool().execute({
      action: "register",
      method: "POST",
      path: "/api/create",
      status: 201,
      body: '{"id":1}',
    }));
    expect(r.key).toBe("POST:/api/create");
    expect(r.route.status).toBe(201);
  });

  it("headers JSON 파싱", async () => {
    const r = JSON.parse(await make_tool().execute({
      action: "register",
      path: "/api/data",
      headers: '{"X-Custom":"value"}',
    }));
    expect(r.registered).toBe(true);
  });

  it("잘못된 headers JSON → 무시 (등록 성공)", async () => {
    const r = JSON.parse(await make_tool().execute({
      action: "register",
      path: "/api/test2",
      headers: "not-json",
    }));
    expect(r.registered).toBe(true);
  });
});

// ══════════════════════════════════════════
// match
// ══════════════════════════════════════════

describe("HttpMockTool — match", () => {
  it("정확 매칭 → matched=true", async () => {
    const tool = make_tool();
    await tool.execute({ action: "register", path: "/api/users", status: 200, body: '{"users":[]}' });
    const r = JSON.parse(await tool.execute({ action: "match", method: "GET", path: "/api/users" }));
    expect(r.matched).toBe(true);
    expect(r.status).toBe(200);
    expect(r.body).toBe('{"users":[]}');
  });

  it("매칭 없음 → matched=false", async () => {
    const r = JSON.parse(await make_tool().execute({ action: "match", method: "GET", path: "/nonexistent" }));
    expect(r.matched).toBe(false);
  });

  it("패턴 매칭 (:param)", async () => {
    const tool = make_tool();
    await tool.execute({ action: "register", method: "GET", path: "/api/users/:id", status: 200 });
    const r = JSON.parse(await tool.execute({ action: "match", method: "GET", path: "/api/users/123" }));
    expect(r.matched).toBe(true);
  });

  it("와일드카드 패턴 (*)", async () => {
    const tool = make_tool();
    await tool.execute({ action: "register", method: "GET", path: "/api/*", status: 200 });
    const r = JSON.parse(await tool.execute({ action: "match", method: "GET", path: "/api/anything/here" }));
    expect(r.matched).toBe(true);
  });
});

// ══════════════════════════════════════════
// list
// ══════════════════════════════════════════

describe("HttpMockTool — list", () => {
  it("빈 상태 → count=0", async () => {
    const r = JSON.parse(await make_tool().execute({ action: "list" }));
    expect(r.count).toBe(0);
    expect(r.routes).toEqual([]);
  });

  it("등록 후 → count=1", async () => {
    const tool = make_tool();
    await tool.execute({ action: "register", path: "/api/list-test" });
    const r = JSON.parse(await tool.execute({ action: "list" }));
    expect(r.count).toBe(1);
  });
});

// ══════════════════════════════════════════
// clear
// ══════════════════════════════════════════

describe("HttpMockTool — clear", () => {
  it("등록 후 clear → count=0", async () => {
    const tool = make_tool();
    await tool.execute({ action: "register", path: "/to-clear" });
    await tool.execute({ action: "clear" });
    const r = JSON.parse(await tool.execute({ action: "list" }));
    expect(r.count).toBe(0);
  });

  it("clear 후 requests도 비워짐", async () => {
    const tool = make_tool();
    await tool.execute({ action: "record", path: "/req" });
    await tool.execute({ action: "clear" });
    const r = JSON.parse(await tool.execute({ action: "replay" }));
    expect(r.count).toBe(0);
  });
});

// ══════════════════════════════════════════
// record / replay
// ══════════════════════════════════════════

describe("HttpMockTool — record/replay", () => {
  it("record → total 증가", async () => {
    const tool = make_tool();
    const r = JSON.parse(await tool.execute({ action: "record", method: "POST", path: "/api/login", request_body: '{"user":"test"}' }));
    expect(r.recorded).toBe(true);
    expect(r.total).toBe(1);
  });

  it("replay → 기록된 요청 반환", async () => {
    const tool = make_tool();
    await tool.execute({ action: "record", method: "GET", path: "/api/data" });
    await tool.execute({ action: "record", method: "POST", path: "/api/create" });
    const r = JSON.parse(await tool.execute({ action: "replay" }));
    expect(r.count).toBe(2);
    expect(r.requests[0].method).toBe("GET");
    expect(r.requests[1].method).toBe("POST");
  });

  it("request_body 없음 → body=undefined (직렬화되지 않음)", async () => {
    const tool = make_tool();
    await tool.execute({ action: "record", path: "/no-body" });
    const r = JSON.parse(await tool.execute({ action: "replay" }));
    expect(r.requests[0].body).toBeUndefined();
  });
});

// ══════════════════════════════════════════
// generate_response
// ══════════════════════════════════════════

describe("HttpMockTool — generate_response", () => {
  it("json 타입 → application/json", async () => {
    const r = JSON.parse(await make_tool().execute({
      action: "generate_response",
      content_type: "json",
      data: '{"key":"value"}',
      status: 200,
    }));
    expect(r.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(r.body)).toEqual({ key: "value" });
  });

  it("json 잘못된 data → 빈 객체", async () => {
    const r = JSON.parse(await make_tool().execute({
      action: "generate_response",
      content_type: "json",
      data: "invalid{{{",
    }));
    expect(r.body).toBe("{}");
  });

  it("xml 타입 → application/xml + <?xml...>", async () => {
    const r = JSON.parse(await make_tool().execute({
      action: "generate_response",
      content_type: "xml",
      data: "hello",
    }));
    expect(r.headers["Content-Type"]).toBe("application/xml");
    expect(r.body).toContain("<?xml");
    expect(r.body).toContain("<response>hello</response>");
  });

  it("html 타입 → text/html + DOCTYPE", async () => {
    const r = JSON.parse(await make_tool().execute({
      action: "generate_response",
      content_type: "html",
      data: "<h1>Test</h1>",
    }));
    expect(r.headers["Content-Type"]).toBe("text/html");
    expect(r.body).toContain("<!DOCTYPE html>");
  });

  it("text 타입 → text/plain", async () => {
    const r = JSON.parse(await make_tool().execute({
      action: "generate_response",
      content_type: "text",
      data: "plain text",
    }));
    expect(r.headers["Content-Type"]).toBe("text/plain");
    expect(r.body).toBe("plain text");
  });

  it("기본 status=200", async () => {
    const r = JSON.parse(await make_tool().execute({ action: "generate_response" }));
    expect(r.status).toBe(200);
  });
});

// ══════════════════════════════════════════
// unsupported action
// ══════════════════════════════════════════

describe("HttpMockTool — unsupported action", () => {
  it("bogus → Error", async () => {
    const r = await make_tool().execute({ action: "bogus" });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("bogus");
  });
});
