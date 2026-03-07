import { describe, it, expect } from "vitest";
import { RetrieverTool } from "../../src/agent/tools/retriever.js";

function make_tool() {
  return new RetrieverTool({ secret_vault: undefined as never });
}

describe("RetrieverTool", () => {
  describe("memory", () => {
    it("키/값에서 쿼리 매칭 검색", async () => {
      const data = JSON.stringify({
        greeting: "Hello world",
        farewell: "Goodbye world",
        unrelated: "foo bar baz",
      });
      const r = JSON.parse(await make_tool().execute({
        action: "memory", query: "hello", data,
      }));
      expect(r.source).toBe("memory");
      expect(r.count).toBeGreaterThan(0);
      expect(r.results[0].key).toBe("greeting");
    });

    it("매칭 없음 → 빈 결과", async () => {
      const data = JSON.stringify({ a: "abc", b: "def" });
      const r = JSON.parse(await make_tool().execute({
        action: "memory", query: "zzz_no_match", data,
      }));
      expect(r.count).toBe(0);
    });

    it("top_k 제한", async () => {
      const data: Record<string, string> = {};
      for (let i = 0; i < 20; i++) data[`key_${i}`] = `match_value ${i}`;
      const r = JSON.parse(await make_tool().execute({
        action: "memory", query: "match_value", data: JSON.stringify(data), top_k: 3,
      }));
      expect(r.count).toBe(3);
    });

    it("잘못된 JSON → 에러", async () => {
      const r = await make_tool().execute({
        action: "memory", query: "test", data: "not_json{",
      });
      expect(r).toContain("Error");
    });
  });

  describe("vector", () => {
    it("collection 없으면 에러", async () => {
      const r = await make_tool().execute({ action: "vector", query: "test" });
      expect(r).toContain("Error");
    });

    it("collection 있으면 빈 결과 + 안내 메시지", async () => {
      const r = JSON.parse(await make_tool().execute({
        action: "vector", query: "test", collection: "docs",
      }));
      expect(r.source).toBe("vector");
      expect(r.count).toBe(0);
      expect(r.note).toContain("vector_store");
    });
  });

  describe("http", () => {
    it("url 없으면 에러", async () => {
      const r = await make_tool().execute({ action: "http", query: "test" });
      expect(r).toContain("Error");
    });
  });
});
