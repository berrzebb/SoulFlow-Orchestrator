import { describe, it, expect } from "vitest";
import { PaginationTool } from "../../src/agent/tools/pagination.js";

function make_tool() {
  return new PaginationTool({ secret_vault: undefined as never });
}

describe("PaginationTool", () => {
  describe("offset", () => {
    it("offset 페이지네이션 메타데이터", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "offset", page: 2, per_page: 10, total: 95 }));
      expect(r.mode).toBe("offset");
      expect(r.offset).toBe(10);
      expect(r.total_pages).toBe(10);
      expect(r.has_prev).toBe(true);
      expect(r.has_next).toBe(true);
    });

    it("마지막 페이지 → has_next=false", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "offset", page: 5, per_page: 20, total: 100 }));
      expect(r.has_next).toBe(false);
      expect(r.has_prev).toBe(true);
    });
  });

  describe("cursor", () => {
    it("커서 기반 페이지네이션", async () => {
      const r = JSON.parse(await make_tool().execute({
        action: "cursor", cursor: "abc", next_cursor: "def", has_more: true, per_page: 20,
      }));
      expect(r.mode).toBe("cursor");
      expect(r.current_cursor).toBe("abc");
      expect(r.next_cursor).toBe("def");
      expect(r.has_more).toBe(true);
    });

    it("has_more=false → next_cursor=null", async () => {
      const r = JSON.parse(await make_tool().execute({
        action: "cursor", cursor: "abc", next_cursor: "def", has_more: false,
      }));
      expect(r.next_cursor).toBeNull();
    });
  });

  describe("keyset", () => {
    it("keyset 페이지네이션 + SQL 필터 생성", async () => {
      const r = JSON.parse(await make_tool().execute({
        action: "keyset", sort_key: "created_at", last_value: "2024-01-01", per_page: 50, has_more: true,
      }));
      expect(r.mode).toBe("keyset");
      expect(r.filter).toContain("WHERE created_at > '2024-01-01'");
      expect(r.filter).toContain("LIMIT 50");
    });
  });

  describe("calculate", () => {
    it("페이지 범위 계산 (from/to/showing)", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "calculate", page: 3, per_page: 10, total: 55 }));
      expect(r.from).toBe(21);
      expect(r.to).toBe(30);
      expect(r.showing).toBe(10);
    });
  });

  describe("generate_links", () => {
    it("Link 헤더 생성", async () => {
      const r = JSON.parse(await make_tool().execute({
        action: "generate_links", base_url: "/api/items", page: 2, per_page: 10, total: 50,
      }));
      expect(r.links.first).toContain("page=1");
      expect(r.links.last).toContain("page=5");
      expect(r.links.prev).toContain("page=1");
      expect(r.links.next).toContain("page=3");
    });
  });

  describe("parse_link_header", () => {
    it("Link 헤더 파싱", async () => {
      const header = '</api?page=1>; rel="first", </api?page=5>; rel="last", </api?page=3>; rel="next"';
      const r = JSON.parse(await make_tool().execute({ action: "parse_link_header", header }));
      expect(r.links.first).toBe("/api?page=1");
      expect(r.links.last).toBe("/api?page=5");
      expect(r.links.next).toBe("/api?page=3");
      expect(r.count).toBe(3);
    });
  });
});
