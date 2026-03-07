import { describe, it, expect } from "vitest";
import { CsvTool } from "@src/agent/tools/csv.js";

function make_tool(): CsvTool {
  return new CsvTool();
}

const SAMPLE = `name,age,city
Alice,30,Seoul
Bob,25,Busan
Charlie,35,Incheon`;

describe("CsvTool", () => {
  describe("parse", () => {
    it("헤더 포함 CSV → JSON 객체 배열", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "parse", data: SAMPLE }));
      expect(result.count).toBe(3);
      expect(result.headers).toEqual(["name", "age", "city"]);
      expect(result.rows[0]).toEqual({ name: "Alice", age: "30", city: "Seoul" });
      expect(result.rows[2]).toEqual({ name: "Charlie", age: "35", city: "Incheon" });
    });

    it("헤더 없는 CSV → 2D 배열", async () => {
      const data = "a,b,c\n1,2,3";
      const result = JSON.parse(await make_tool().execute({ action: "parse", data, has_header: false }));
      expect(result.count).toBe(2);
      expect(result.rows[0]).toEqual(["a", "b", "c"]);
    });

    it("빈 CSV → 빈 행 1개 (split 특성)", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "parse", data: "" }));
      // "".trim().split("\n") → [""] → 1행 (header only, data 0)
      expect(result.count).toBe(1);
    });

    it("따옴표로 감싸진 필드 (쉼표 포함)", async () => {
      const data = `name,address\nAlice,"Seoul, Korea"\nBob,"Busan, Korea"`;
      const result = JSON.parse(await make_tool().execute({ action: "parse", data }));
      expect(result.rows[0].address).toBe("Seoul, Korea");
    });

    it("이스케이프된 따옴표 (\"\")", async () => {
      const data = `msg\n"He said ""hello"""`;
      const result = JSON.parse(await make_tool().execute({ action: "parse", data }));
      expect(result.rows[0].msg).toBe('He said "hello"');
    });
  });

  describe("generate", () => {
    it("JSON 객체 배열 → CSV", async () => {
      const data = JSON.stringify([
        { name: "Alice", age: 30 },
        { name: "Bob", age: 25 },
      ]);
      const result = await make_tool().execute({ action: "generate", data });
      expect(result).toContain("name,age");
      expect(result).toContain("Alice,30");
      expect(result).toContain("Bob,25");
    });

    it("2D 배열 → CSV", async () => {
      const data = JSON.stringify([["a", "b"], [1, 2]]);
      const result = await make_tool().execute({ action: "generate", data });
      expect(result).toContain("a,b");
      expect(result).toContain("1,2");
    });

    it("쉼표 포함 값 → 자동 따옴표", async () => {
      const data = JSON.stringify([{ name: "Seoul, Korea" }]);
      const result = await make_tool().execute({ action: "generate", data });
      expect(result).toContain('"Seoul, Korea"');
    });

    it("잘못된 JSON → 에러", async () => {
      const result = await make_tool().execute({ action: "generate", data: "not-json" });
      expect(result).toContain("Error");
    });

    it("빈 배열 → 빈 문자열", async () => {
      const result = await make_tool().execute({ action: "generate", data: "[]" });
      expect(result).toBe("");
    });
  });

  describe("count", () => {
    it("행/열 수 반환", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "count", data: SAMPLE }));
      expect(result.total_rows).toBe(4);
      expect(result.data_rows).toBe(3);
      expect(result.columns).toBe(3);
    });
  });

  describe("headers", () => {
    it("헤더 추출", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "headers", data: SAMPLE }));
      expect(result.headers).toEqual(["name", "age", "city"]);
      expect(result.count).toBe(3);
    });
  });

  describe("filter", () => {
    it("특정 열만 필터", async () => {
      const result = JSON.parse(await make_tool().execute({
        action: "filter", data: SAMPLE, columns: "name,city",
      }));
      expect(result.headers).toEqual(["name", "city"]);
      expect(result.rows[0]).toEqual({ name: "Alice", city: "Seoul" });
      expect(result.rows[0]).not.toHaveProperty("age");
    });

    it("없는 열 이름 → 무시", async () => {
      const result = JSON.parse(await make_tool().execute({
        action: "filter", data: SAMPLE, columns: "name,nonexistent",
      }));
      expect(result.headers).toEqual(["name"]);
    });
  });

  describe("커스텀 구분자", () => {
    it("탭 구분자", async () => {
      const data = "name\tage\nAlice\t30";
      const result = JSON.parse(await make_tool().execute({ action: "parse", data, delimiter: "\t" }));
      expect(result.rows[0]).toEqual({ name: "Alice", age: "30" });
    });
  });

  it("지원하지 않는 action → 에러", async () => {
    const result = await make_tool().execute({ action: "nope", data: "" });
    expect(result).toContain("unsupported action");
  });
});
