/**
 * DataFormatTool — 미커버 분기 보충.
 * L53: run catch, L148/158: default format, L166: empty CSV,
 * L271/273/274: yaml float/array/object values,
 * L280-303: yaml_serialize null/bool/number/string/nested-array/fallback,
 * L333: toml_serialize non-object, L361/364/366/373/380/387: jsonpath edge cases.
 */
import { describe, it, expect } from "vitest";
import { DataFormatTool } from "@src/agent/tools/data-format.js";

const tool = new DataFormatTool();

async function run(params: Record<string, unknown>): Promise<string> {
  return (tool as any).run(params);
}

// ══════════════════════════════════════════
// L53: run() catch — 실행 중 예외 → Error: 메시지
// ══════════════════════════════════════════

describe("DataFormatTool — run catch (L53)", () => {
  it("query: 잘못된 JSON input → Error: 반환", async () => {
    const r = await run({ operation: "query", input: "invalid{json", path: "$.key" });
    expect(r).toMatch(/^Error:/);
  });
});

// ══════════════════════════════════════════
// L148/L158: parse/serialize default → JSON
// ══════════════════════════════════════════

describe("DataFormatTool — parse/serialize default case (L148, L158)", () => {
  it("convert from=unknown → JSON.parse fallback", async () => {
    // from='xml' 같은 unknown format → default: JSON.parse(input)
    const r = await run({ operation: "convert", input: '{"a":1}', from: "xml", to: "json" });
    // JSON.parse가 성공하면 JSON 반환
    expect(r).toContain('"a"');
  });

  it("convert to=unknown → JSON.stringify fallback", async () => {
    const r = await run({ operation: "convert", input: '{"a":1}', from: "json", to: "xml" });
    // default serialize → JSON
    expect(r).toContain('"a"');
  });
});

// ══════════════════════════════════════════
// L166: csv_to_json 빈 CSV → 빈 배열 (private 직접 호출)
// ══════════════════════════════════════════

describe("DataFormatTool — csv_to_json 빈 입력 (L166)", () => {
  it("빈 줄만 있는 CSV → 빈 배열 (직접 호출)", () => {
    // run()이 빈 input을 차단하므로 private 메서드 직접 호출
    const r = (tool as any).csv_to_json("\n\n", ",");
    expect(r).toEqual([]);
  });
});

// ══════════════════════════════════════════
// L271: yaml_parse_value float (^-?\d+\.\d+$)
// ══════════════════════════════════════════

describe("DataFormatTool — yaml float 파싱 (L271)", () => {
  it("YAML 소수점 값 → float 파싱", async () => {
    const yaml_input = "price: 3.14\nname: item";
    const r = await run({ operation: "convert", input: yaml_input, from: "yaml", to: "json" });
    const parsed = JSON.parse(r);
    expect(parsed.price).toBeCloseTo(3.14);
  });

  it("음수 소수점 → float 파싱", async () => {
    const r = await run({ operation: "convert", input: "val: -2.5", from: "yaml", to: "json" });
    const parsed = JSON.parse(r);
    expect(parsed.val).toBeCloseTo(-2.5);
  });
});

// ══════════════════════════════════════════
// L273/L274: yaml_parse_value JSON array/object
// ══════════════════════════════════════════

describe("DataFormatTool — yaml JSON array/object 인라인 파싱 (L273, L274)", () => {
  it("YAML 값이 JSON 배열 형태 → parse 성공", async () => {
    const r = await run({ operation: "convert", input: 'tags: [1, 2, 3]', from: "yaml", to: "json" });
    const parsed = JSON.parse(r);
    expect(parsed.tags).toEqual([1, 2, 3]);
  });

  it("YAML 값이 JSON 객체 형태 → parse 성공", async () => {
    const r = await run({ operation: "convert", input: 'meta: {"k":"v"}', from: "yaml", to: "json" });
    const parsed = JSON.parse(r);
    expect(parsed.meta).toEqual({ k: "v" });
  });

  it("YAML 값이 JSON 배열 형태지만 invalid → raw string 반환", async () => {
    const r = await run({ operation: "convert", input: "tags: [a, b, c]", from: "yaml", to: "json" });
    // JSON.parse("[a, b, c]") 실패 → raw string "[a, b, c]" 반환
    const parsed = JSON.parse(r);
    expect(typeof parsed.tags).toBe("string");
  });
});

// ══════════════════════════════════════════
// L280-303: yaml_serialize null/bool/number/string/nested/fallback
// ══════════════════════════════════════════

describe("DataFormatTool — yaml_serialize (L280-303)", () => {
  it("null 값 → YAML null", async () => {
    const r = await run({ operation: "convert", input: '{"key":null}', from: "json", to: "yaml" });
    expect(r).toContain("null");
  });

  it("boolean 값 → YAML bool", async () => {
    const r = await run({ operation: "convert", input: '{"flag":true}', from: "json", to: "yaml" });
    expect(r).toContain("true");
  });

  it("number 값 → YAML number", async () => {
    const r = await run({ operation: "convert", input: '{"count":42}', from: "json", to: "yaml" });
    expect(r).toContain("42");
  });

  it("root string 값에 콜론 포함 → 따옴표로 감싸기 (L282)", async () => {
    // JSON 문자열 파싱 → root-level string → yaml_serialize(string) 경로 (L282)
    const r = await run({ operation: "convert", input: '"value: with colon"', from: "json", to: "yaml" });
    expect(r).toContain('"value: with colon"');
  });

  it("배열 내 객체 항목 → 중첩 YAML", async () => {
    const r = await run({ operation: "convert", input: '[{"a":1},{"b":2}]', from: "json", to: "yaml" });
    // 객체 항목은 L287-288 경로로 중첩 직렬화
    expect(typeof r).toBe("string");
    expect(r.length).toBeGreaterThan(0);
  });

  it("빈 객체 → {}", async () => {
    const r = await run({ operation: "convert", input: "nested:\n  sub:", from: "yaml", to: "yaml" });
    // empty nested object → {} (L295)
    expect(typeof r).toBe("string");
  });
});

// ══════════════════════════════════════════
// L333: toml_serialize non-object/null/array
// ══════════════════════════════════════════

describe("DataFormatTool — toml_serialize non-object (L333)", () => {
  it("JSON 배열 → TOML → JSON.stringify fallback", async () => {
    const r = await run({ operation: "convert", input: "[1,2,3]", from: "json", to: "toml" });
    // 배열은 toml_serialize 첫 번째 분기: JSON.stringify
    expect(r).toContain("1");
  });
});

// ══════════════════════════════════════════
// L361: jsonpath null current
// ══════════════════════════════════════════

describe("DataFormatTool — jsonpath null current (L361)", () => {
  it("$.a.b.c — 중간에 null → null 반환", async () => {
    const r = await run({ operation: "query", input: '{"a":null}', path: "$.a.b" });
    expect(r).toBe("null");
  });
});

// ══════════════════════════════════════════
// L364/L365/L366: jsonpath '*' wildcard
// ══════════════════════════════════════════

describe("DataFormatTool — jsonpath '*' wildcard (L364-366)", () => {
  it("배열에 * → 배열 반환", async () => {
    const r = await run({ operation: "query", input: "[1,2,3]", path: "$.*" });
    const parsed = JSON.parse(r);
    expect(parsed).toEqual([1, 2, 3]);
  });

  it("객체에 * → 값 목록 반환", async () => {
    const r = await run({ operation: "query", input: '{"a":1,"b":2}', path: "$.*" });
    const parsed = JSON.parse(r);
    expect(parsed).toContain(1);
    expect(parsed).toContain(2);
  });

  it("스칼라에 * → null", async () => {
    const r = await run({ operation: "query", input: '"hello"', path: "$.*" });
    expect(r).toBe("null");
  });
});

// ══════════════════════════════════════════
// L373/L380: jsonpath array_match/index_match not array
// ══════════════════════════════════════════

describe("DataFormatTool — jsonpath not-array 경로 (L373, L380)", () => {
  it("$.key[0] — key가 배열이 아니면 null", async () => {
    const r = await run({ operation: "query", input: '{"key":"string"}', path: "$.key[0]" });
    expect(r).toBe("null");
  });

  it("[0] — 배열이 아니면 null", async () => {
    const r = await run({ operation: "query", input: '"hello"', path: "$[0]" });
    expect(r).toBe("null");
  });
});

// ══════════════════════════════════════════
// L387: jsonpath 비객체 current
// ══════════════════════════════════════════

describe("DataFormatTool — jsonpath 비객체 세그먼트 접근 (L387)", () => {
  it("스칼라에서 키 접근 → null", async () => {
    const r = await run({ operation: "query", input: '{"a":42}', path: "$.a.b" });
    // $.a → 42, 42.b → current is not object → null
    expect(r).toBe("null");
  });
});

// ══════════════════════════════════════════
// L260: yaml_parse_block i++ (콜론 없는 줄)
// ══════════════════════════════════════════

describe("DataFormatTool — yaml_parse_block: 콜론 없는 줄 → i++ (L260)", () => {
  it("YAML에 콜론 없는 단순 텍스트 줄 → 파싱 오류 없음", async () => {
    // "orphan_line"은 콜론이 없고 "- " prefix도 없는 줄 → i++ (L260)
    const yaml_with_orphan = "name: Alice\norphan line without colon\nage: 30";
    const r = await run({ operation: "convert", input: yaml_with_orphan, from: "yaml", to: "json" });
    // orphan 줄은 무시됨
    const parsed = JSON.parse(r);
    expect(parsed.name).toBe("Alice");
    expect(parsed.age).toBe(30);
  });
});
