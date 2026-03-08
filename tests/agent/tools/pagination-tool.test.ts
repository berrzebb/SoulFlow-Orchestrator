/**
 * PaginationTool — 페이지네이션 메타데이터 계산 테스트.
 */
import { describe, it, expect } from "vitest";
import { PaginationTool } from "../../../src/agent/tools/pagination.js";

const tool = new PaginationTool();

async function exec(params: Record<string, unknown>): Promise<unknown> {
  const result = await tool.execute(params);
  try { return JSON.parse(String(result)); } catch { return result; }
}

describe("PaginationTool — offset", () => {
  it("1페이지 메타데이터", async () => {
    const r = await exec({ action: "offset", page: 1, per_page: 10, total: 100 }) as Record<string, unknown>;
    expect(r.page).toBe(1);
    expect(r.total_pages).toBe(10);
    expect(r.offset).toBe(0);
    expect(r.has_prev).toBe(false);
    expect(r.has_next).toBe(true);
  });

  it("마지막 페이지", async () => {
    const r = await exec({ action: "offset", page: 5, per_page: 10, total: 50 }) as Record<string, unknown>;
    expect(r.has_next).toBe(false);
    expect(r.has_prev).toBe(true);
    expect(r.offset).toBe(40);
  });

  it("total 0 → total_pages: 1", async () => {
    const r = await exec({ action: "offset", page: 1, per_page: 10, total: 0 }) as Record<string, unknown>;
    expect(r.total_pages).toBe(1);
  });
});

describe("PaginationTool — cursor", () => {
  it("cursor 기반 메타데이터", async () => {
    const r = await exec({
      action: "cursor",
      per_page: 20,
      cursor: "abc123",
      next_cursor: "def456",
      has_more: true,
    }) as Record<string, unknown>;
    expect(r.mode).toBe("cursor");
    expect(r.current_cursor).toBe("abc123");
    expect(r.next_cursor).toBe("def456");
    expect(r.has_more).toBe(true);
  });

  it("has_more: false → next_cursor: null", async () => {
    const r = await exec({
      action: "cursor",
      per_page: 20,
      next_cursor: "xyz",
      has_more: false,
    }) as Record<string, unknown>;
    expect(r.next_cursor).toBeNull();
  });
});

describe("PaginationTool — keyset", () => {
  it("keyset 페이지네이션", async () => {
    const r = await exec({
      action: "keyset",
      sort_key: "created_at",
      last_value: "2024-01-15",
      per_page: 10,
      has_more: true,
    }) as Record<string, unknown>;
    expect(r.mode).toBe("keyset");
    expect(r.sort_key).toBe("created_at");
    expect(String(r.filter)).toContain("WHERE created_at");
    expect(String(r.filter)).toContain("LIMIT 10");
  });

  it("last_value 없음 → WHERE 없는 쿼리", async () => {
    const r = await exec({ action: "keyset", sort_key: "id", per_page: 20 }) as Record<string, unknown>;
    expect(String(r.filter)).not.toContain("WHERE");
  });
});

describe("PaginationTool — calculate", () => {
  it("from/to/showing 계산", async () => {
    const r = await exec({ action: "calculate", page: 2, per_page: 10, total: 25 }) as Record<string, unknown>;
    expect(r.from).toBe(11);
    expect(r.to).toBe(20);
    expect(r.showing).toBe(10);
  });

  it("마지막 페이지 — 부분 페이지", async () => {
    const r = await exec({ action: "calculate", page: 3, per_page: 10, total: 25 }) as Record<string, unknown>;
    expect(r.to).toBe(25);
    expect(r.showing).toBe(5);
  });
});

describe("PaginationTool — generate_links", () => {
  it("Link 헤더 생성", async () => {
    const r = await exec({ action: "generate_links", base_url: "/api/items", page: 2, per_page: 10, total: 50 }) as Record<string, unknown>;
    const header = String(r.header);
    expect(header).toContain("first");
    expect(header).toContain("last");
    expect(header).toContain("prev");
    expect(header).toContain("next");
  });

  it("첫 페이지 → prev 없음", async () => {
    const r = await exec({ action: "generate_links", base_url: "/api", page: 1, per_page: 10, total: 30 }) as Record<string, unknown>;
    const links = r.links as Record<string, string>;
    expect(links.prev).toBeUndefined();
    expect(links.next).toBeDefined();
  });
});

describe("PaginationTool — parse_link_header", () => {
  it("Link 헤더 파싱", async () => {
    const header = '</api/items?page=1>; rel="first", </api/items?page=3>; rel="next", </api/items?page=10>; rel="last"';
    const r = await exec({ action: "parse_link_header", header }) as Record<string, unknown>;
    const links = r.links as Record<string, string>;
    expect(links.first).toBe("/api/items?page=1");
    expect(links.next).toBe("/api/items?page=3");
    expect(links.last).toBe("/api/items?page=10");
    expect(r.count).toBe(3);
  });
});
