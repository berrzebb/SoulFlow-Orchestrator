/**
 * DataFormatTool — convert/query/validate/flatten/pick/omit 테스트.
 */
import { describe, it, expect } from "vitest";
import { DataFormatTool } from "../../../src/agent/tools/data-format.js";

const tool = new DataFormatTool();

describe("DataFormatTool", () => {

  it("metadata: name=data_format", () => {
    expect(tool.name).toBe("data_format");
  });

  it("validate: 유효한 JSON → valid=true", async () => {
    const result = JSON.parse(await tool.execute({ operation: "validate", input: '{"a":1}' }));
    expect(result.valid).toBe(true);
    expect(result.type).toBe("object");
  });

  it("validate: 유효하지 않은 JSON → valid=false", async () => {
    const result = JSON.parse(await tool.execute({ operation: "validate", input: "not json{" }));
    expect(result.valid).toBe(false);
  });

  it("pretty: JSON 포맷팅", async () => {
    const result = await tool.execute({ operation: "pretty", input: '{"a":1,"b":2}' });
    expect(result).toContain("\n");
    expect(result).toContain('"a"');
  });

  it("flatten: 중첩 객체 평탄화", async () => {
    const input = JSON.stringify({ a: { b: { c: 1 } } });
    const result = JSON.parse(await tool.execute({ operation: "flatten", input }));
    expect(result["a.b.c"]).toBe(1);
  });

  it("unflatten: 평탄 객체 → 중첩", async () => {
    const input = JSON.stringify({ "a.b.c": 1 });
    const result = JSON.parse(await tool.execute({ operation: "unflatten", input }));
    expect(result.a.b.c).toBe(1);
  });

  it("merge: 두 JSON 병합", async () => {
    const result = JSON.parse(await tool.execute({
      operation: "merge",
      input: '{"a":1}',
      input2: '{"b":2}',
    }));
    expect(result.a).toBe(1);
    expect(result.b).toBe(2);
  });

  it("pick: 특정 키만 선택", async () => {
    const result = JSON.parse(await tool.execute({
      operation: "pick",
      input: '{"a":1,"b":2,"c":3}',
      keys: "a,c",
    }));
    expect(result.a).toBe(1);
    expect(result.c).toBe(3);
    expect(result.b).toBeUndefined();
  });

  it("omit: 특정 키 제외", async () => {
    const result = JSON.parse(await tool.execute({
      operation: "omit",
      input: '{"a":1,"b":2,"c":3}',
      keys: "b",
    }));
    expect(result.a).toBe(1);
    expect(result.c).toBe(3);
    expect(result.b).toBeUndefined();
  });

  it("query: JSONPath 쿼리", async () => {
    const result = await tool.execute({
      operation: "query",
      input: '{"users":[{"name":"John"},{"name":"Jane"}]}',
      path: "$.users[0].name",
    });
    expect(result).toContain("John");
  });

  it("empty input → 에러", async () => {
    const result = await tool.execute({ operation: "pretty", input: "" });
    expect(result).toContain("Error");
  });

  it("unsupported operation → 에러", async () => {
    const result = await tool.execute({ operation: "invalid", input: "{}" });
    expect(result).toContain("unsupported");
  });
});

// ══════════════════════════════════════════
// CSV 변환
// ══════════════════════════════════════════

async function run(op: string, input: string, extra?: Record<string, unknown>): Promise<string> {
  return tool.execute({ operation: op, input, ...extra });
}

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

// ══════════════════════════════════════════
// YAML 변환
// ══════════════════════════════════════════

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

// ══════════════════════════════════════════
// TOML 변환
// ══════════════════════════════════════════

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

// ══════════════════════════════════════════
// JSONPath 고급 쿼리
// ══════════════════════════════════════════

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
    expect(result).toBeTruthy();
  });

  it("없는 경로 → 쿼리 실행 성공 (예외 없음)", async () => {
    let threw = false;
    try { await run("query", data, { path: "$.nonexistent" }); } catch { threw = true; }
    expect(threw).toBe(false);
  });

  it("배열에서 인덱스 접근", async () => {
    const result = await run("query", '["a","b","c"]', { path: "$.[1]" });
    expect(result).toContain("b");
  });
});

// ══════════════════════════════════════════
// merge 고급 케이스
// ══════════════════════════════════════════

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

// ══════════════════════════════════════════
// flatten: 배열 중첩
// ══════════════════════════════════════════

describe("DataFormatTool — flatten 배열 포함", () => {
  it("배열이 있는 객체 평탄화", async () => {
    const input = JSON.stringify({ arr: [1, 2, 3] });
    const result = JSON.parse(await run("flatten", input));
    expect(result["arr[0]"]).toBe(1);
    expect(result["arr[2]"]).toBe(3);
  });
});

// ══════════════════════════════════════════
// pick_omit 엣지 케이스
// ══════════════════════════════════════════

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

// ══════════════════════════════════════════
// yaml_serialize top-level null/boolean/number
// ══════════════════════════════════════════

describe("DataFormatTool — yaml_serialize top-level primitives", () => {
  it("JSON null → YAML null", async () => {
    const r = await run("convert", "null", { from: "json", to: "yaml" });
    expect(r.trim()).toBe("null");
  });

  it("JSON true → YAML true", async () => {
    const r = await run("convert", "true", { from: "json", to: "yaml" });
    expect(r.trim()).toBe("true");
  });

  it("JSON false → YAML false", async () => {
    const r = await run("convert", "false", { from: "json", to: "yaml" });
    expect(r.trim()).toBe("false");
  });

  it("JSON 42 → YAML 42", async () => {
    const r = await run("convert", "42", { from: "json", to: "yaml" });
    expect(r.trim()).toBe("42");
  });

  it("JSON 3.14 → YAML 3.14", async () => {
    const r = await run("convert", "3.14", { from: "json", to: "yaml" });
    expect(r.trim()).toBe("3.14");
  });
});

// ══════════════════════════════════════════
// yaml_parse_block 들여쓰기 break 경로
// ══════════════════════════════════════════

describe("DataFormatTool — yaml_parse_block 들여쓰기 break 경로", () => {
  it("중첩 객체에서 들여쓰기 감소 → break → 파싱 종료", async () => {
    const yaml = "outer:\n  inner: value\ntop_level: again";
    const r = JSON.parse(await run("convert", yaml, { from: "yaml", to: "json" }));
    expect(r.outer).toBeDefined();
    expect(r.top_level).toBeDefined();
  });

  it("깊이 중첩 후 들여쓰기 증가 → break", async () => {
    const yaml = "a:\n  b: 1\n  c: 2\nd: 3";
    const r = JSON.parse(await run("convert", yaml, { from: "yaml", to: "json" }));
    expect(r.a?.b).toBe(1);
    expect(r.d).toBe(3);
  });
});

// ══════════════════════════════════════════
// run catch, parse/serialize default, csv_to_json empty
// ══════════════════════════════════════════

describe("DataFormatTool — run catch", () => {
  it("query: 잘못된 JSON input → Error: 반환", async () => {
    const r = await (tool as any).run({ operation: "query", input: "invalid{json", path: "$.key" });
    expect(r).toMatch(/^Error:/);
  });
});

describe("DataFormatTool — parse/serialize default case", () => {
  it("convert from=unknown → JSON.parse fallback", async () => {
    const r = await (tool as any).run({ operation: "convert", input: '{"a":1}', from: "xml", to: "json" });
    expect(r).toContain('"a"');
  });

  it("convert to=unknown → JSON.stringify fallback", async () => {
    const r = await (tool as any).run({ operation: "convert", input: '{"a":1}', from: "json", to: "xml" });
    expect(r).toContain('"a"');
  });
});

describe("DataFormatTool — csv_to_json 빈 입력", () => {
  it("빈 줄만 있는 CSV → 빈 배열", () => {
    const r = (tool as any).csv_to_json("\n\n", ",");
    expect(r).toEqual([]);
  });
});

// ══════════════════════════════════════════
// yaml float/array/object inline 파싱
// ══════════════════════════════════════════

describe("DataFormatTool — yaml float 파싱", () => {
  it("YAML 소수점 값 → float 파싱", async () => {
    const yaml_input = "price: 3.14\nname: item";
    const r = await (tool as any).run({ operation: "convert", input: yaml_input, from: "yaml", to: "json" });
    const parsed = JSON.parse(r);
    expect(parsed.price).toBeCloseTo(3.14);
  });

  it("음수 소수점 → float 파싱", async () => {
    const r = await (tool as any).run({ operation: "convert", input: "val: -2.5", from: "yaml", to: "json" });
    const parsed = JSON.parse(r);
    expect(parsed.val).toBeCloseTo(-2.5);
  });
});

describe("DataFormatTool — yaml JSON array/object 인라인 파싱", () => {
  it("YAML 값이 JSON 배열 형태 → parse 성공", async () => {
    const r = await (tool as any).run({ operation: "convert", input: 'tags: [1, 2, 3]', from: "yaml", to: "json" });
    const parsed = JSON.parse(r);
    expect(parsed.tags).toEqual([1, 2, 3]);
  });

  it("YAML 값이 JSON 객체 형태 → parse 성공", async () => {
    const r = await (tool as any).run({ operation: "convert", input: 'meta: {"k":"v"}', from: "yaml", to: "json" });
    const parsed = JSON.parse(r);
    expect(parsed.meta).toEqual({ k: "v" });
  });

  it("YAML 값이 JSON 배열 형태지만 invalid → raw string 반환", async () => {
    const r = await (tool as any).run({ operation: "convert", input: "tags: [a, b, c]", from: "yaml", to: "json" });
    const parsed = JSON.parse(r);
    expect(typeof parsed.tags).toBe("string");
  });
});

// ══════════════════════════════════════════
// yaml_serialize 추가 분기
// ══════════════════════════════════════════

describe("DataFormatTool — yaml_serialize 추가 분기", () => {
  it("null 값 → YAML null", async () => {
    const r = await (tool as any).run({ operation: "convert", input: '{"key":null}', from: "json", to: "yaml" });
    expect(r).toContain("null");
  });

  it("boolean 값 → YAML bool", async () => {
    const r = await (tool as any).run({ operation: "convert", input: '{"flag":true}', from: "json", to: "yaml" });
    expect(r).toContain("true");
  });

  it("number 값 → YAML number", async () => {
    const r = await (tool as any).run({ operation: "convert", input: '{"count":42}', from: "json", to: "yaml" });
    expect(r).toContain("42");
  });

  it("root string 값에 콜론 포함 → 따옴표로 감싸기", async () => {
    const r = await (tool as any).run({ operation: "convert", input: '"value: with colon"', from: "json", to: "yaml" });
    expect(r).toContain('"value: with colon"');
  });

  it("배열 내 객체 항목 → 중첩 YAML", async () => {
    const r = await (tool as any).run({ operation: "convert", input: '[{"a":1},{"b":2}]', from: "json", to: "yaml" });
    expect(typeof r).toBe("string");
    expect(r.length).toBeGreaterThan(0);
  });

  it("빈 객체 → {}", async () => {
    const r = await (tool as any).run({ operation: "convert", input: "nested:\n  sub:", from: "yaml", to: "yaml" });
    expect(typeof r).toBe("string");
  });
});

// ══════════════════════════════════════════
// toml_serialize non-object
// ══════════════════════════════════════════

describe("DataFormatTool — toml_serialize non-object", () => {
  it("JSON 배열 → TOML → JSON.stringify fallback", async () => {
    const r = await (tool as any).run({ operation: "convert", input: "[1,2,3]", from: "json", to: "toml" });
    expect(r).toContain("1");
  });
});

// ══════════════════════════════════════════
// jsonpath 엣지 케이스
// ══════════════════════════════════════════

describe("DataFormatTool — jsonpath null current", () => {
  it("$.a.b.c — 중간에 null → null 반환", async () => {
    const r = await (tool as any).run({ operation: "query", input: '{"a":null}', path: "$.a.b" });
    expect(r).toBe("null");
  });
});

describe("DataFormatTool — jsonpath '*' wildcard", () => {
  it("배열에 * → 배열 반환", async () => {
    const r = await (tool as any).run({ operation: "query", input: "[1,2,3]", path: "$.*" });
    const parsed = JSON.parse(r);
    expect(parsed).toEqual([1, 2, 3]);
  });

  it("객체에 * → 값 목록 반환", async () => {
    const r = await (tool as any).run({ operation: "query", input: '{"a":1,"b":2}', path: "$.*" });
    const parsed = JSON.parse(r);
    expect(parsed).toContain(1);
    expect(parsed).toContain(2);
  });

  it("스칼라에 * → null", async () => {
    const r = await (tool as any).run({ operation: "query", input: '"hello"', path: "$.*" });
    expect(r).toBe("null");
  });
});

describe("DataFormatTool — jsonpath not-array 경로", () => {
  it("$.key[0] — key가 배열이 아니면 null", async () => {
    const r = await (tool as any).run({ operation: "query", input: '{"key":"string"}', path: "$.key[0]" });
    expect(r).toBe("null");
  });

  it("[0] — 배열이 아니면 null", async () => {
    const r = await (tool as any).run({ operation: "query", input: '"hello"', path: "$[0]" });
    expect(r).toBe("null");
  });
});

describe("DataFormatTool — jsonpath 비객체 세그먼트 접근", () => {
  it("스칼라에서 키 접근 → null", async () => {
    const r = await (tool as any).run({ operation: "query", input: '{"a":42}', path: "$.a.b" });
    expect(r).toBe("null");
  });
});

describe("DataFormatTool — yaml_serialize fallback", () => {
  it("BigInt 값 → String 변환 fallback", () => {
    const r = (tool as any).yaml_serialize(BigInt(42));
    expect(r).toContain("42");
  });
});

describe("DataFormatTool — yaml_parse_block: 콜론 없는 줄", () => {
  it("YAML에 콜론 없는 단순 텍스트 줄 → 파싱 오류 없음", async () => {
    const yaml_with_orphan = "name: Alice\norphan line without colon\nage: 30";
    const r = await (tool as any).run({ operation: "convert", input: yaml_with_orphan, from: "yaml", to: "json" });
    const parsed = JSON.parse(r);
    expect(parsed.name).toBe("Alice");
    expect(parsed.age).toBe(30);
  });
});
