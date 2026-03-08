/**
 * DataFormatTool 확장 커버리지 — YAML/TOML/CSV 변환, JSONPath 고급 쿼리.
 */
import { describe, it, expect } from "vitest";
import { DataFormatTool } from "@src/agent/tools/data-format.js";

const tool = new DataFormatTool();

async function run(op: string, input: string, extra?: Record<string, unknown>): Promise<string> {
  return tool.execute({ operation: op, input, ...extra });
}

// ── CSV 변환 ──

describe("DataFormatTool — CSV 변환", () => {
  it("json→csv: 배열 객체 변환", async () => {
    const input = JSON.stringify([
      { name: "Alice", age: 30 },
      { name: "Bob", age: 25 },
    ]);
    const result = await run("convert", input, { from: "json", to: "csv" });
    expect(result).toContain("name");
    expect(result).toContain("Alice");
    expect(result).toContain("Bob");
  });

  it("csv→json: CSV 파싱 및 JSON 변환", async () => {
    const csv = "name,age\nAlice,30\nBob,25";
    const result = JSON.parse(await run("convert", csv, { from: "csv", to: "json" }));
    expect(Array.isArray(result)).toBe(true);
    expect(result[0].name).toBe("Alice");
    expect(result[1].age).toBe("25");
  });

  it("csv→json: 커스텀 구분자", async () => {
    const csv = "name;age\nAlice;30";
    const result = JSON.parse(await run("convert", csv, { from: "csv", to: "json", delimiter: ";" }));
    expect(result[0].name).toBe("Alice");
  });

  it("csv→json: 따옴표 포함 필드", async () => {
    const csv = 'name,desc\n"Smith, John","He said ""hello"""';
    const result = JSON.parse(await run("convert", csv, { from: "csv", to: "json" }));
    expect(result[0].name).toBe("Smith, John");
    expect(result[0].desc).toContain("hello");
  });

  it("json→csv: 단일 객체(배열 아님)", async () => {
    const result = await run("convert", '{"a":1,"b":2}', { from: "json", to: "csv" });
    expect(result).toContain("a");
    expect(result).toContain("b");
  });

  it("json→csv: 빈 배열", async () => {
    const result = await run("convert", "[]", { from: "json", to: "csv" });
    expect(result.trim()).toBe("");
  });
});

// ── YAML 변환 ──

describe("DataFormatTool — YAML 변환", () => {
  it("json→yaml: 기본 객체", async () => {
    const result = await run("convert", '{"name":"Alice","age":30}', { from: "json", to: "yaml" });
    expect(result).toContain("name:");
    expect(result).toContain("Alice");
    expect(result).toContain("age:");
  });

  it("yaml→json: 기본 파싱", async () => {
    const yaml = "name: Alice\nage: 30";
    const result = JSON.parse(await run("convert", yaml, { from: "yaml", to: "json" }));
    expect(result.name).toBe("Alice");
    expect(result.age).toBe(30);
  });

  it("yaml→json: 리스트 파싱", async () => {
    const yaml = "- apple\n- banana\n- cherry";
    const result = JSON.parse(await run("convert", yaml, { from: "yaml", to: "json" }));
    expect(Array.isArray(result)).toBe(true);
    expect(result).toContain("apple");
  });

  it("yaml→json: 불리언/null 파싱", async () => {
    const yaml = "enabled: true\ndisabled: false\nnothing: null";
    const result = JSON.parse(await run("convert", yaml, { from: "yaml", to: "json" }));
    expect(result.enabled).toBe(true);
    expect(result.disabled).toBe(false);
    expect(result.nothing).toBeNull();
  });

  it("yaml→json: 중첩 객체 파싱", async () => {
    const yaml = "person:\n  name: Bob\n  age: 25";
    const result = JSON.parse(await run("convert", yaml, { from: "yaml", to: "json" }));
    expect(result.person.name).toBe("Bob");
  });

  it("json→yaml: 배열 직렬화", async () => {
    const result = await run("convert", '["apple","banana"]', { from: "json", to: "yaml" });
    expect(result).toContain("- apple");
    expect(result).toContain("- banana");
  });

  it("json→yaml: 중첩 객체 직렬화", async () => {
    const result = await run("convert", '{"a":{"b":1}}', { from: "json", to: "yaml" });
    expect(result).toContain("a:");
    expect(result).toContain("b:");
  });

  it("json→yaml: null/boolean/number 직렬화", async () => {
    const result = await run("convert", '{"x":null,"y":true,"z":3.14}', { from: "json", to: "yaml" });
    expect(result).toContain("null");
    expect(result).toContain("true");
    expect(result).toContain("3.14");
  });

  it("json→yaml: 빈 객체", async () => {
    const result = await run("convert", "{}", { from: "json", to: "yaml" });
    expect(result.trim()).toContain("{}");
  });

  it("json→yaml: 빈 배열", async () => {
    const result = await run("convert", "[]", { from: "json", to: "yaml" });
    expect(result.trim()).toContain("[]");
  });

  it("yaml→json: 특수문자 포함 문자열 (따옴표)", async () => {
    const yaml = `title: "hello: world"`;
    const result = JSON.parse(await run("convert", yaml, { from: "yaml", to: "json" }));
    expect(result.title).toBe("hello: world");
  });

  it("yaml→json: 주석 라인 무시", async () => {
    const yaml = "# comment\nname: Alice";
    const result = JSON.parse(await run("convert", yaml, { from: "yaml", to: "json" }));
    expect(result.name).toBe("Alice");
  });
});

// ── TOML 변환 ──

describe("DataFormatTool — TOML 변환", () => {
  it("toml→json: 기본 키=값 파싱", async () => {
    const toml = 'name = "Alice"\nage = 30';
    const result = JSON.parse(await run("convert", toml, { from: "toml", to: "json" }));
    expect(result.name).toBe("Alice");
    expect(result.age).toBe(30);
  });

  it("toml→json: 섹션 파싱", async () => {
    const toml = "[database]\nhost = localhost\nport = 5432";
    const result = JSON.parse(await run("convert", toml, { from: "toml", to: "json" }));
    expect(result.database.host).toBe("localhost");
    expect(result.database.port).toBe(5432);
  });

  it("toml→json: 불리언 파싱", async () => {
    const toml = "debug = true\nproduction = false";
    const result = JSON.parse(await run("convert", toml, { from: "toml", to: "json" }));
    expect(result.debug).toBe(true);
    expect(result.production).toBe(false);
  });

  it("json→toml: 기본 직렬화", async () => {
    const result = await run("convert", '{"name":"Alice","age":30}', { from: "json", to: "toml" });
    expect(result).toContain("name");
    expect(result).toContain("Alice");
    expect(result).toContain("age");
  });

  it("json→toml: 중첩 객체 → 섹션", async () => {
    const result = await run("convert", '{"db":{"host":"localhost"}}', { from: "json", to: "toml" });
    expect(result).toContain("[db]");
    expect(result).toContain("host");
  });

  it("toml→json: 주석 무시", async () => {
    const toml = "# config file\nname = Alice";
    const result = JSON.parse(await run("convert", toml, { from: "toml", to: "json" }));
    expect(result.name).toBe("Alice");
  });
});

// ── JSONPath 고급 쿼리 ──

describe("DataFormatTool — JSONPath 고급 쿼리", () => {
  const data = JSON.stringify({
    users: [
      { name: "Alice", role: "admin" },
      { name: "Bob", role: "user" },
    ],
    meta: { count: 2 },
  });

  it("$ 루트 경로 → 전체 데이터", async () => {
    const result = JSON.parse(await run("query", data, { path: "$" }));
    expect(result.meta.count).toBe(2);
  });

  it("$.users[0].name → 첫 번째 이름", async () => {
    const result = await run("query", data, { path: "$.users[0].name" });
    expect(result).toContain("Alice");
  });

  it("$.users[1].role → 두 번째 역할", async () => {
    const result = await run("query", data, { path: "$.users[1].role" });
    expect(result).toContain("user");
  });

  it("$.meta.count → 숫자 값", async () => {
    const result = JSON.parse(await run("query", data, { path: "$.meta.count" }));
    expect(result).toBe(2);
  });

  it("$.* → 와일드카드 지원", async () => {
    const result = await run("query", JSON.stringify({ a: 1, b: 2 }), { path: "$.*" });
    // 와일드카드는 값 배열 또는 객체 반환
    expect(result).toBeTruthy();
  });

  it("없는 경로 → 쿼리 실행 성공 (예외 없음)", async () => {
    // 없는 키: JSON.stringify(undefined) = undefined, 예외만 없으면 됨
    let threw = false;
    try { await run("query", data, { path: "$.nonexistent" }); } catch { threw = true; }
    expect(threw).toBe(false);
  });

  it("배열에서 인덱스 접근", async () => {
    const result = await run("query", '["a","b","c"]', { path: "$.[1]" });
    expect(result).toContain("b");
  });
});

// ── merge 고급 케이스 ──

describe("DataFormatTool — merge 고급", () => {
  it("두 배열 병합", async () => {
    const result = JSON.parse(await run("merge", "[1,2]", { input2: "[3,4]" }));
    expect(result).toEqual([1, 2, 3, 4]);
  });

  it("비 객체 병합 → 배열로 래핑", async () => {
    const result = JSON.parse(await run("merge", '"hello"', { input2: '"world"' }));
    expect(Array.isArray(result)).toBe(true);
  });
});

// ── flatten: 배열 중첩 ──

describe("DataFormatTool — flatten 배열 포함", () => {
  it("배열이 있는 객체 평탄화", async () => {
    const input = JSON.stringify({ arr: [1, 2, 3] });
    const result = JSON.parse(await run("flatten", input));
    expect(result["arr[0]"]).toBe(1);
    expect(result["arr[2]"]).toBe(3);
  });
});

// ── pick_omit 엣지 케이스 ──

describe("DataFormatTool — pick_omit 엣지 케이스", () => {
  it("pick: 배열 입력 → 에러", async () => {
    const result = await run("pick", "[1,2,3]", { keys: "a" });
    expect(result).toContain("Error");
  });

  it("omit: 없는 키 제거 → 전체 반환", async () => {
    const result = JSON.parse(await run("omit", '{"a":1,"b":2}', { keys: "x" }));
    expect(result.a).toBe(1);
    expect(result.b).toBe(2);
  });
});
