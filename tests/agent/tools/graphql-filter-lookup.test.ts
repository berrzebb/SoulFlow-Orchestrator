/**
 * GraphqlTool / FilterTool / LookupTool — 미커버 분기 보충.
 * GraphQL: introspect, invalid headers, non-JSON body, fetch error, operation_name.
 * Filter: every/some/count, in(JSON array), regex(invalid), not_exists, invalid data.
 * Lookup: list, reverse, currency_symbol, not-found, key required.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GraphqlTool } from "@src/agent/tools/graphql.js";
import { FilterTool } from "@src/agent/tools/filter.js";
import { LookupTool } from "@src/agent/tools/lookup.js";

// ══════════════════════════════════════════
// GraphqlTool
// ══════════════════════════════════════════

let fetch_mock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetch_mock = vi.fn();
  vi.stubGlobal("fetch", fetch_mock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GraphqlTool — introspect action", () => {
  it("action=introspect → INTROSPECTION_QUERY 전송, 결과 반환", async () => {
    fetch_mock.mockResolvedValueOnce({
      status: 200,
      text: async () => JSON.stringify({ data: { __schema: { queryType: { name: "Query" } } } }),
    });
    const tool = new GraphqlTool();
    const r = await tool.execute({ url: "https://api.example.com/graphql", action: "introspect" });
    const parsed = JSON.parse(r);
    expect(parsed.status).toBe(200);
    expect(parsed.data.data.__schema).toBeDefined();
  });
});

describe("GraphqlTool — invalid URL", () => {
  it("url이 유효하지 않으면 Error: invalid URL 반환", async () => {
    const tool = new GraphqlTool();
    const r = await tool.execute({ url: "not-a-url", query: "{ me }" });
    expect(r).toContain("invalid URL");
  });
});

describe("GraphqlTool — invalid variables JSON", () => {
  it("variables가 JSON이 아니면 Error: invalid variables JSON 반환", async () => {
    const tool = new GraphqlTool();
    const r = await tool.execute({ url: "https://api.example.com/graphql", query: "{ me }", variables: "{bad json" });
    expect(r).toContain("invalid variables JSON");
  });
});

describe("GraphqlTool — invalid headers JSON", () => {
  it("headers가 JSON이 아니면 Error: invalid headers JSON 반환", async () => {
    fetch_mock.mockResolvedValueOnce({
      status: 200,
      text: async () => JSON.stringify({}),
    });
    const tool = new GraphqlTool();
    const r = await tool.execute({ url: "https://api.example.com/graphql", query: "{ me }", headers: "not-json" });
    expect(r).toContain("invalid headers JSON");
  });
});

describe("GraphqlTool — non-JSON response", () => {
  it("응답이 JSON 파싱 불가 → raw 텍스트로 감쌈", async () => {
    fetch_mock.mockResolvedValueOnce({
      status: 200,
      text: async () => "Internal server error\nstack trace here",
    });
    const tool = new GraphqlTool();
    const r = await tool.execute({ url: "https://api.example.com/graphql", query: "{ me }" });
    const parsed = JSON.parse(r);
    expect(parsed.data.raw).toContain("Internal server error");
  });
});

describe("GraphqlTool — fetch error", () => {
  it("fetch throw → Error 메시지 반환", async () => {
    fetch_mock.mockRejectedValueOnce(new Error("Connection refused"));
    const tool = new GraphqlTool();
    const r = await tool.execute({ url: "https://api.example.com/graphql", query: "{ me }" });
    expect(r).toContain("Connection refused");
  });
});

describe("GraphqlTool — operation_name 포함", () => {
  it("operation_name 제공 시 요청 body에 operationName 포함", async () => {
    let captured_body: Record<string, unknown> = {};
    fetch_mock.mockImplementationOnce(async (_url: string, opts: { body?: string }) => {
      captured_body = JSON.parse(opts.body ?? "{}");
      return { status: 200, text: async () => JSON.stringify({ data: {} }) };
    });
    const tool = new GraphqlTool();
    await tool.execute({
      url: "https://api.example.com/graphql",
      query: "query GetUser { me { name } }",
      operation_name: "GetUser",
    });
    expect(captured_body.operationName).toBe("GetUser");
  });
});

describe("GraphqlTool — query required", () => {
  it("action=query이고 query 없으면 Error: query is required", async () => {
    const tool = new GraphqlTool();
    const r = await tool.execute({ url: "https://api.example.com/graphql" });
    expect(r).toContain("query is required");
  });
});

// ══════════════════════════════════════════
// FilterTool
// ══════════════════════════════════════════

describe("FilterTool — every action", () => {
  it("모든 항목이 조건 만족 → result: true", async () => {
    const tool = new FilterTool();
    const data = JSON.stringify([{ age: 20 }, { age: 25 }, { age: 30 }]);
    const r = JSON.parse(await tool.execute({ action: "every", data, path: "age", operator: "gte", value: "18" }));
    expect(r.result).toBe(true);
  });

  it("하나라도 불만족 → result: false", async () => {
    const tool = new FilterTool();
    const data = JSON.stringify([{ age: 10 }, { age: 25 }]);
    const r = JSON.parse(await tool.execute({ action: "every", data, path: "age", operator: "gte", value: "18" }));
    expect(r.result).toBe(false);
  });
});

describe("FilterTool — some action", () => {
  it("하나라도 만족 → result: true", async () => {
    const tool = new FilterTool();
    const data = JSON.stringify([{ active: false }, { active: true }]);
    const r = JSON.parse(await tool.execute({ action: "some", data, path: "active", operator: "eq", value: "true" }));
    expect(r.result).toBe(true);
  });

  it("아무것도 불만족 → result: false", async () => {
    const tool = new FilterTool();
    const data = JSON.stringify([{ x: 1 }, { x: 2 }]);
    const r = JSON.parse(await tool.execute({ action: "some", data, path: "x", operator: "eq", value: "99" }));
    expect(r.result).toBe(false);
  });
});

describe("FilterTool — count action", () => {
  it("매칭 개수 + 전체 개수 반환", async () => {
    const tool = new FilterTool();
    const data = JSON.stringify([{ n: 1 }, { n: 2 }, { n: 3 }]);
    const r = JSON.parse(await tool.execute({ action: "count", data, path: "n", operator: "gt", value: "1" }));
    expect(r.count).toBe(2);
    expect(r.total).toBe(3);
  });
});

describe("FilterTool — in operator", () => {
  it("JSON 배열 값으로 in 필터링", async () => {
    const tool = new FilterTool();
    const data = JSON.stringify([{ role: "admin" }, { role: "user" }, { role: "guest" }]);
    const r = JSON.parse(await tool.execute({ action: "where", data, path: "role", operator: "in", value: '["admin","guest"]' }));
    expect(r).toHaveLength(2);
    expect(r.map((x: { role: string }) => x.role)).toEqual(["admin", "guest"]);
  });

  it("쉼표 구분 문자열로 in 필터링 (JSON 아님)", async () => {
    const tool = new FilterTool();
    const data = JSON.stringify([{ tag: "a" }, { tag: "b" }, { tag: "c" }]);
    const r = JSON.parse(await tool.execute({ action: "where", data, path: "tag", operator: "in", value: "a,c" }));
    expect(r).toHaveLength(2);
  });
});

describe("FilterTool — regex operator", () => {
  it("유효한 regex → 매칭 항목 반환", async () => {
    const tool = new FilterTool();
    const data = JSON.stringify([{ name: "Alice" }, { name: "Bob" }, { name: "Charlie" }]);
    const r = JSON.parse(await tool.execute({ action: "where", data, path: "name", operator: "regex", value: "^[AB]" }));
    expect(r).toHaveLength(2);
  });

  it("잘못된 regex → 빈 배열 반환 (예외 무시)", async () => {
    const tool = new FilterTool();
    const data = JSON.stringify([{ name: "Alice" }]);
    const r = JSON.parse(await tool.execute({ action: "where", data, path: "name", operator: "regex", value: "[invalid(" }));
    expect(r).toEqual([]);
  });
});

describe("FilterTool — not_exists operator", () => {
  it("필드 없는 항목만 필터", async () => {
    const tool = new FilterTool();
    const data = JSON.stringify([{ a: 1 }, { b: 2 }]);
    const r = JSON.parse(await tool.execute({ action: "where", data, path: "a", operator: "not_exists" }));
    expect(r).toHaveLength(1);
    expect(r[0]).toEqual({ b: 2 });
  });
});

describe("FilterTool — invalid data", () => {
  it("JSON이 아닌 data → Error 반환", async () => {
    const tool = new FilterTool();
    const r = await tool.execute({ action: "where", data: "not json" });
    expect(r).toContain("Error");
  });

  it("배열이 아닌 data → Error 반환", async () => {
    const tool = new FilterTool();
    const r = await tool.execute({ action: "where", data: '{"key":"value"}' });
    expect(r).toContain("Error");
  });
});

describe("FilterTool — reject action", () => {
  it("조건 불만족 항목만 반환", async () => {
    const tool = new FilterTool();
    const data = JSON.stringify([{ n: 1 }, { n: 5 }, { n: 10 }]);
    const r = JSON.parse(await tool.execute({ action: "reject", data, path: "n", operator: "gt", value: "3" }));
    expect(r).toEqual([{ n: 1 }]);
  });
});

describe("FilterTool — find action", () => {
  it("첫 번째 매칭 항목 반환", async () => {
    const tool = new FilterTool();
    const data = JSON.stringify([{ x: 1 }, { x: 2 }, { x: 2 }]);
    const r = JSON.parse(await tool.execute({ action: "find", data, path: "x", operator: "eq", value: "2" }));
    expect(r).toEqual({ x: 2 });
  });

  it("매칭 없으면 null 반환", async () => {
    const tool = new FilterTool();
    const data = JSON.stringify([{ x: 1 }]);
    const r = JSON.parse(await tool.execute({ action: "find", data, path: "x", operator: "eq", value: "99" }));
    expect(r).toBeNull();
  });
});

// ══════════════════════════════════════════
// LookupTool
// ══════════════════════════════════════════

describe("LookupTool — list all entries", () => {
  it("list: true → http_status 전체 목록 반환", async () => {
    const tool = new LookupTool();
    const r = JSON.parse(await tool.execute({ table: "http_status", list: true }));
    expect(r["200"]).toBe("OK");
    expect(r["404"]).toBe("Not Found");
  });

  it("list: true → mime_type 전체 목록 반환", async () => {
    const tool = new LookupTool();
    const r = JSON.parse(await tool.execute({ table: "mime_type", list: true }));
    expect(r.json).toBe("application/json");
  });
});

describe("LookupTool — reverse lookup", () => {
  it("reverse: true → 값 기준 역방향 검색", async () => {
    const tool = new LookupTool();
    const r = JSON.parse(await tool.execute({ table: "http_status", key: "Not Found", reverse: true }));
    expect(r["404"]).toBe("Not Found");
  });

  it("reverse: true + 부분 매칭", async () => {
    const tool = new LookupTool();
    const r = JSON.parse(await tool.execute({ table: "country", key: "Korea", reverse: true }));
    expect(r["KR"]).toBe("South Korea");
  });

  it("reverse: true + 매칭 없음 → No matches 메시지", async () => {
    const tool = new LookupTool();
    const r = await tool.execute({ table: "http_status", key: "XYZ_NONEXISTENT", reverse: true });
    expect(r).toContain("No matches");
  });
});

describe("LookupTool — currency_symbol table", () => {
  it("USD → $", async () => {
    const tool = new LookupTool();
    const r = await tool.execute({ table: "currency_symbol", key: "USD" });
    expect(r).toBe("$");
  });

  it("EUR → €", async () => {
    const tool = new LookupTool();
    const r = await tool.execute({ table: "currency_symbol", key: "EUR" });
    expect(r).toBe("€");
  });

  it("KRW → ₩", async () => {
    const tool = new LookupTool();
    const r = await tool.execute({ table: "currency_symbol", key: "KRW" });
    expect(r).toBe("₩");
  });
});

describe("LookupTool — not found", () => {
  it("존재하지 않는 key → Not found 메시지", async () => {
    const tool = new LookupTool();
    const r = await tool.execute({ table: "http_status", key: "999" });
    expect(r).toContain("Not found");
  });
});

describe("LookupTool — key required", () => {
  it("key 없고 list=false → Error 반환", async () => {
    const tool = new LookupTool();
    const r = await tool.execute({ table: "http_status" });
    expect(r).toContain("Error");
    expect(r).toContain("key");
  });
});

describe("LookupTool — unknown table", () => {
  it("알 수 없는 table → Error: unknown table", async () => {
    const tool = new LookupTool();
    const r = await tool.execute({ table: "unknown_table" });
    expect(r).toContain("unknown table");
  });
});

describe("LookupTool — standard lookups", () => {
  it("http_status 200 → OK", async () => {
    const tool = new LookupTool();
    expect(await tool.execute({ table: "http_status", key: "200" })).toBe("OK");
  });

  it("mime_type png → image/png", async () => {
    const tool = new LookupTool();
    expect(await tool.execute({ table: "mime_type", key: "png" })).toBe("image/png");
  });

  it("country KR → South Korea", async () => {
    const tool = new LookupTool();
    expect(await tool.execute({ table: "country", key: "KR" })).toBe("South Korea");
  });
});
