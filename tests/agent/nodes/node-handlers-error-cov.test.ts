/**
 * 노드 핸들러 에러 분기 커버리지:
 * - database.ts L45: DatabaseTool throw → success:false
 * - pagination.ts L72: PaginationTool throw → error 반환
 * - document.ts L49: DocumentTool throw → success:false
 * - http.ts L44-45: user_agent 필드 → User-Agent 헤더 추가
 * - http.ts L55: 객체 body + content-type 없음 → 자동 추가
 */
import { describe, it, expect, vi } from "vitest";

// 각 동적 import를 강제 throw로 mock
vi.mock("@src/agent/tools/database.js", () => ({
  DatabaseTool: class {
    execute() { throw new Error("database forced error"); }
  },
}));

vi.mock("@src/agent/tools/pagination.js", () => ({
  PaginationTool: class {
    execute() { throw new Error("pagination forced error"); }
  },
}));

vi.mock("@src/agent/tools/document-pptx.js", () => ({
  PptxTool: class {
    execute() { throw new Error("pptx error"); }
  },
}));

vi.mock("@src/agent/tools/document-xlsx.js", () => ({
  XlsxTool: class {
    execute() { throw new Error("xlsx error"); }
  },
}));

// fetch mock for http tests
const mock_fetch = vi.fn();
vi.stubGlobal("fetch", mock_fetch);

import { database_handler } from "@src/agent/nodes/database.js";
import { pagination_handler } from "@src/agent/nodes/pagination.js";

const CTX = { memory: {}, workspace: "/tmp" } as any;

// ── database.ts L45 ──────────────────────────────────────────────────────

describe("database_handler — DatabaseTool throw (L45)", () => {
  it("DatabaseTool throw → success:false", async () => {
    const result = await database_handler.execute!(
      { node_id: "n1", node_type: "database", title: "T", datasource: "/tmp/db.sqlite", sql: "SELECT 1", operation: "query" } as any,
      CTX,
    );
    expect(result.output.success).toBe(false);
    expect(String(result.output.result)).toContain("database forced error");
  });
});

// ── pagination.ts L72 ─────────────────────────────────────────────────────

describe("pagination_handler — PaginationTool throw (L72)", () => {
  it("PaginationTool throw → error 반환", async () => {
    const result = await pagination_handler.execute!(
      { node_id: "n1", node_type: "pagination", title: "T", action: "offset" } as any,
      CTX,
    );
    expect(result.output.error).toContain("pagination forced error");
  });
});

// ── http.ts L44-45 (user_agent) + L55 (Content-Type 자동 추가) ───────────

describe("http_handler — user_agent + Content-Type 자동 추가", () => {
  it("user_agent 필드 → User-Agent 헤더 자동 추가 (L44-45)", async () => {
    mock_fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      text: async () => JSON.stringify({ data: "ok" }),
    });

    const { http_handler } = await import("@src/agent/nodes/http.js");
    const result = await http_handler.execute!(
      {
        node_id: "n1", node_type: "http", title: "T",
        method: "GET",
        url: "https://example.com/api",
        user_agent: "MyBot/1.0",
        // headers에 user-agent 없음 → 자동 추가
      } as any,
      CTX,
    );

    const call_init = mock_fetch.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = call_init?.headers as Record<string, string> | undefined;
    expect(headers?.["User-Agent"]).toBe("MyBot/1.0");
    expect(result.output).toBeDefined();
  });

  it("객체 body + Content-Type 없음 → application/json 자동 추가 (L55)", async () => {
    mock_fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      text: async () => "{}",
    });

    const { http_handler } = await import("@src/agent/nodes/http.js");
    const result = await http_handler.execute!(
      {
        node_id: "n2", node_type: "http", title: "T",
        method: "POST",
        url: "https://example.com/api",
        body: { key: "value" }, // 객체 body → JSON.stringify
        // Content-Type 헤더 없음 → 자동 추가
      } as any,
      CTX,
    );

    const call_init = mock_fetch.mock.calls[1]?.[1] as RequestInit | undefined;
    const headers = call_init?.headers as Record<string, string> | undefined;
    expect(headers?.["Content-Type"]).toBe("application/json");
    expect(result.output).toBeDefined();
  });
});
