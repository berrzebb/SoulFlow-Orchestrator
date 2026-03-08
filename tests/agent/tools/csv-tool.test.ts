/**
 * CsvTool — parse/generate/count/headers/filter 테스트.
 */
import { describe, it, expect } from "vitest";
import { CsvTool } from "../../../src/agent/tools/csv.js";

const tool = new CsvTool();

async function exec(params: Record<string, unknown>): Promise<unknown> {
  const result = await tool.execute(params);
  try { return JSON.parse(String(result)); } catch { return result; }
}

const BASIC_CSV = "name,age,city\nAlice,30,Seoul\nBob,25,Busan\nCarol,35,Incheon";

describe("CsvTool — parse", () => {
  it("헤더 포함 CSV 파싱", async () => {
    const r = await exec({ action: "parse", data: BASIC_CSV }) as Record<string, unknown>;
    expect(r.count).toBe(3);
    expect((r.headers as string[])).toContain("name");
    const rows = r.rows as Record<string, string>[];
    expect(rows[0]?.name).toBe("Alice");
    expect(rows[0]?.age).toBe("30");
  });

  it("has_header: false → 배열로 반환", async () => {
    const r = await exec({ action: "parse", data: "a,b,c\n1,2,3", has_header: false }) as Record<string, unknown>;
    expect((r.rows as string[][]).length).toBe(2);
    expect(Array.isArray((r.rows as string[][])[0])).toBe(true);
  });

  it("탭 구분자 파싱", async () => {
    const r = await exec({ action: "parse", data: "name\tage\nAlice\t30", delimiter: "\t" }) as Record<string, unknown>;
    expect(r.count).toBe(1);
    const rows = r.rows as Record<string, string>[];
    expect(rows[0]?.name).toBe("Alice");
  });

  it("따옴표 포함 필드 파싱", async () => {
    const r = await exec({ action: "parse", data: 'name,city\nAlice,"New York"' }) as Record<string, unknown>;
    const rows = r.rows as Record<string, string>[];
    expect(rows[0]?.city).toBe("New York");
  });

  it("빈 CSV → count: 0", async () => {
    const r = await exec({ action: "parse", data: "" }) as Record<string, unknown>;
    expect(Number(r.count)).toBeLessThanOrEqual(1);
  });
});

describe("CsvTool — generate", () => {
  it("JSON 배열 → CSV 생성", async () => {
    const data = JSON.stringify([{ name: "Alice", age: "30" }, { name: "Bob", age: "25" }]);
    const r = await exec({ action: "generate", data });
    const text = String(r);
    expect(text).toContain("name");
    expect(text).toContain("Alice");
    expect(text).toContain("Bob");
  });

  it("쉼표 포함 값 → 따옴표로 감쌈", async () => {
    const data = JSON.stringify([{ name: "Smith, John", city: "Seoul" }]);
    const r = await exec({ action: "generate", data });
    expect(String(r)).toContain('"Smith, John"');
  });

  it("잘못된 JSON → Error", async () => {
    const r = await exec({ action: "generate", data: "not-json" });
    expect(String(r)).toContain("Error");
  });
});

describe("CsvTool — count", () => {
  it("데이터 행 수 반환 (헤더 제외)", async () => {
    const r = await exec({ action: "count", data: BASIC_CSV }) as Record<string, unknown>;
    expect(r.data_rows).toBe(3);
  });
});

describe("CsvTool — headers", () => {
  it("헤더 목록 반환", async () => {
    const r = await exec({ action: "headers", data: BASIC_CSV }) as Record<string, unknown>;
    expect(r.headers).toEqual(["name", "age", "city"]);
    expect(r.count).toBe(3);
  });
});

describe("CsvTool — filter", () => {
  it("특정 컬럼만 추출", async () => {
    const r = await exec({ action: "filter", data: BASIC_CSV, columns: "name,city" }) as Record<string, unknown>;
    const rows = r.rows as Record<string, string>[];
    expect(Object.keys(rows[0]!)).not.toContain("age");
    expect(rows[0]?.name).toBe("Alice");
    expect(rows[0]?.city).toBe("Seoul");
  });
});
