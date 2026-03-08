/**
 * JsonlTool — JSON Lines 파싱/생성/필터/집계 테스트.
 */
import { describe, it, expect } from "vitest";
import { JsonlTool } from "../../../src/agent/tools/jsonl.js";

const tool = new JsonlTool();

async function exec(params: Record<string, unknown>): Promise<unknown> {
  const result = await tool.execute(params);
  try { return JSON.parse(String(result)); } catch { return result; }
}

const BASIC_JSONL = [
  JSON.stringify({ id: 1, name: "Alice", city: "Seoul" }),
  JSON.stringify({ id: 2, name: "Bob", city: "Busan" }),
  JSON.stringify({ id: 3, name: "Carol", city: "Seoul" }),
].join("\n");

describe("JsonlTool — parse", () => {
  it("JSONL 파싱", async () => {
    const r = await exec({ action: "parse", input: BASIC_JSONL }) as Record<string, unknown>;
    expect(r.count).toBe(3);
    const records = r.records as Record<string, unknown>[];
    expect(records[0]?.name).toBe("Alice");
  });

  it("빈 입력 → count: 0", async () => {
    const r = await exec({ action: "parse", input: "" }) as Record<string, unknown>;
    expect(r.count).toBe(0);
  });

  it("잘못된 JSON 줄 무시", async () => {
    const input = `{"name":"Alice"}\ninvalid-json\n{"name":"Bob"}`;
    const r = await exec({ action: "parse", input }) as Record<string, unknown>;
    expect(r.count).toBe(2);
  });
});

describe("JsonlTool — generate", () => {
  it("JSON 배열 → JSONL 생성", async () => {
    const data = JSON.stringify([{ a: 1 }, { b: 2 }]);
    const r = String(await exec({ action: "generate", data }));
    const lines = r.split("\n").filter(Boolean);
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0]!)).toEqual({ a: 1 });
  });

  it("배열 아닌 JSON → Error", async () => {
    expect(String(await exec({ action: "generate", data: '{"a":1}' }))).toContain("Error");
  });

  it("잘못된 JSON → Error", async () => {
    expect(String(await exec({ action: "generate", data: "not-json" }))).toContain("Error");
  });
});

describe("JsonlTool — filter", () => {
  it("필드 값으로 필터링", async () => {
    const r = await exec({ action: "filter", input: BASIC_JSONL, field: "city", value: "Seoul" }) as Record<string, unknown>;
    expect(r.count).toBe(2);
    expect(r.total).toBe(3);
  });

  it("field 없음 → Error", async () => {
    expect(String(await exec({ action: "filter", input: BASIC_JSONL, value: "Seoul" }))).toContain("Error");
  });
});

describe("JsonlTool — count", () => {
  it("행 수 반환", async () => {
    const r = await exec({ action: "count", input: BASIC_JSONL }) as Record<string, unknown>;
    expect(r.count).toBe(3);
  });
});

describe("JsonlTool — head / tail", () => {
  it("head: 처음 2개", async () => {
    const r = await exec({ action: "head", input: BASIC_JSONL, count: 2 }) as Record<string, unknown>;
    expect(r.count).toBe(2);
    const records = r.records as Record<string, unknown>[];
    expect(records[0]?.name).toBe("Alice");
  });

  it("tail: 마지막 2개", async () => {
    const r = await exec({ action: "tail", input: BASIC_JSONL, count: 2 }) as Record<string, unknown>;
    expect(r.count).toBe(2);
    const records = r.records as Record<string, unknown>[];
    expect(records[records.length - 1]?.name).toBe("Carol");
  });
});

describe("JsonlTool — map", () => {
  it("필드 추출", async () => {
    const r = await exec({ action: "map", input: BASIC_JSONL, field: "name" }) as Record<string, unknown>;
    const values = r.values as string[];
    expect(values).toEqual(["Alice", "Bob", "Carol"]);
  });

  it("field 없음 → Error", async () => {
    expect(String(await exec({ action: "map", input: BASIC_JSONL }))).toContain("Error");
  });
});

describe("JsonlTool — unique", () => {
  it("중복 제거", async () => {
    const r = await exec({ action: "unique", input: BASIC_JSONL, field: "city" }) as Record<string, unknown>;
    expect(r.count).toBe(2); // Seoul, Busan
    expect(r.total).toBe(3);
  });

  it("field 없음 → Error", async () => {
    expect(String(await exec({ action: "unique", input: BASIC_JSONL }))).toContain("Error");
  });
});
