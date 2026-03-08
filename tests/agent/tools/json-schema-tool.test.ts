/**
 * JsonSchemaTool — validate/generate/merge/diff/mock 테스트.
 */
import { describe, it, expect } from "vitest";
import { JsonSchemaTool } from "../../../src/agent/tools/json-schema.js";

describe("JsonSchemaTool", () => {
  const tool = new JsonSchemaTool();

  it("metadata: name=json_schema", () => {
    expect(tool.name).toBe("json_schema");
  });

  it("validate: 유효한 데이터 → valid=true", async () => {
    const schema = JSON.stringify({ type: "object", properties: { name: { type: "string" } }, required: ["name"] });
    const data = JSON.stringify({ name: "John" });
    const result = JSON.parse(await tool.execute({ action: "validate", schema, data }));
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("validate: 유효하지 않은 데이터 → valid=false", async () => {
    const schema = JSON.stringify({ type: "object", properties: { age: { type: "integer" } } });
    const data = JSON.stringify({ age: "not-a-number" });
    const result = JSON.parse(await tool.execute({ action: "validate", schema, data }));
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("generate: 데이터에서 스키마 추론", async () => {
    const data = JSON.stringify({ name: "John", age: 30, tags: ["a", "b"] });
    const result = JSON.parse(await tool.execute({ action: "generate", data }));
    expect(result.type).toBe("object");
    expect(result.properties.name.type).toBe("string");
    expect(result.properties.age.type).toBe("integer");
  });

  it("merge: 두 스키마 병합", async () => {
    const s1 = JSON.stringify({ type: "object", properties: { a: { type: "string" } } });
    const s2 = JSON.stringify({ type: "object", properties: { b: { type: "number" } } });
    const result = JSON.parse(await tool.execute({ action: "merge", schema: s1, schema2: s2 }));
    expect(result.properties.a).toBeDefined();
    expect(result.properties.b).toBeDefined();
  });

  it("diff: 두 스키마 차이점", async () => {
    const s1 = JSON.stringify({ type: "object", properties: { a: { type: "string" } } });
    const s2 = JSON.stringify({ type: "object", properties: { a: { type: "number" } } });
    const result = JSON.parse(await tool.execute({ action: "diff", schema: s1, schema2: s2 }));
    expect(result).toBeDefined();
  });

  it("mock: 스키마에서 목 데이터 생성", async () => {
    const schema = JSON.stringify({ type: "object", properties: { name: { type: "string" }, count: { type: "integer" } } });
    const result = JSON.parse(await tool.execute({ action: "mock", schema }));
    expect(typeof result.name).toBe("string");
    expect(typeof result.count).toBe("number");
  });

  it("invalid JSON → 에러 반환", async () => {
    const result = JSON.parse(await tool.execute({ action: "validate", schema: "not json", data: "{}" }));
    expect(result.error).toBeDefined();
  });

  it("unknown action → 에러", async () => {
    const result = JSON.parse(await tool.execute({ action: "bogus" }));
    expect(result.error).toContain("unknown action");
  });

  // ── validate 세부 브랜치 ──────────────────────────────

  it("validate: 배열 items 검증", async () => {
    const schema = JSON.stringify({ type: "array", items: { type: "string" } });
    const data = JSON.stringify(["hello", 42]);
    const result = JSON.parse(await tool.execute({ action: "validate", schema, data }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e: string) => e.includes("string"))).toBe(true);
  });

  it("validate: enum 검증 → 포함 안 됨 에러", async () => {
    const schema = JSON.stringify({ enum: ["a", "b", "c"] });
    const data = JSON.stringify("d");
    const result = JSON.parse(await tool.execute({ action: "validate", schema, data }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e: string) => e.includes("enum"))).toBe(true);
  });

  it("validate: enum 검증 → 포함됨 valid", async () => {
    const schema = JSON.stringify({ enum: ["a", "b", "c"] });
    const data = JSON.stringify("a");
    const result = JSON.parse(await tool.execute({ action: "validate", schema, data }));
    expect(result.valid).toBe(true);
  });

  it("validate: string minLength 위반", async () => {
    const schema = JSON.stringify({ type: "string", minLength: 10 });
    const data = JSON.stringify("short");
    const result = JSON.parse(await tool.execute({ action: "validate", schema, data }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e: string) => e.includes("minLength"))).toBe(true);
  });

  it("validate: string maxLength 위반", async () => {
    const schema = JSON.stringify({ type: "string", maxLength: 3 });
    const data = JSON.stringify("toolong");
    const result = JSON.parse(await tool.execute({ action: "validate", schema, data }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e: string) => e.includes("maxLength"))).toBe(true);
  });

  it("validate: string pattern 위반", async () => {
    const schema = JSON.stringify({ type: "string", pattern: "^\\d+$" });
    const data = JSON.stringify("abc");
    const result = JSON.parse(await tool.execute({ action: "validate", schema, data }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e: string) => e.includes("pattern"))).toBe(true);
  });

  it("validate: number minimum 위반", async () => {
    const schema = JSON.stringify({ type: "number", minimum: 10 });
    const data = JSON.stringify(5);
    const result = JSON.parse(await tool.execute({ action: "validate", schema, data }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e: string) => e.includes("minimum"))).toBe(true);
  });

  it("validate: number maximum 위반", async () => {
    const schema = JSON.stringify({ type: "number", maximum: 100 });
    const data = JSON.stringify(200);
    const result = JSON.parse(await tool.execute({ action: "validate", schema, data }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e: string) => e.includes("maximum"))).toBe(true);
  });

  it("validate: integer 타입 검증", async () => {
    const schema = JSON.stringify({ type: "integer" });
    const data = JSON.stringify(3.14);
    const result = JSON.parse(await tool.execute({ action: "validate", schema, data }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e: string) => e.includes("integer"))).toBe(true);
  });

  it("validate: required 속성 누락", async () => {
    const schema = JSON.stringify({ type: "object", required: ["name", "age"] });
    const data = JSON.stringify({ name: "John" });
    const result = JSON.parse(await tool.execute({ action: "validate", schema, data }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e: string) => e.includes("age"))).toBe(true);
  });

  it("validate: 유효하지 않은 data JSON → error 반환", async () => {
    const result = JSON.parse(await tool.execute({ action: "validate", schema: "{}", data: "bad json" }));
    expect(result.error).toContain("invalid data JSON");
  });

  // ── generate 세부 브랜치 ──────────────────────────────

  it("generate: null → null 타입 스키마", async () => {
    const result = JSON.parse(await tool.execute({ action: "generate", data: "null" }));
    expect(result.type).toBe("null");
  });

  it("generate: boolean → boolean 타입 스키마", async () => {
    const result = JSON.parse(await tool.execute({ action: "generate", data: "true" }));
    expect(result.type).toBe("boolean");
  });

  it("generate: float → number 타입 스키마", async () => {
    const result = JSON.parse(await tool.execute({ action: "generate", data: "3.14" }));
    expect(result.type).toBe("number");
  });

  it("generate: 빈 배열 → array items={}", async () => {
    const result = JSON.parse(await tool.execute({ action: "generate", data: "[]" }));
    expect(result.type).toBe("array");
    expect(result.items).toEqual({});
  });

  it("generate: 유효하지 않은 JSON → error 반환", async () => {
    const result = JSON.parse(await tool.execute({ action: "generate", data: "bad" }));
    expect(result.error).toBeDefined();
  });

  // ── draft_convert ──────────────────────────────────────

  it("draft_convert: → 2020-12", async () => {
    const schema = JSON.stringify({ type: "object", definitions: { Foo: { type: "string" } } });
    const result = JSON.parse(await tool.execute({ action: "draft_convert", schema, target_draft: "2020-12" }));
    expect(result.$schema).toContain("2020-12");
    expect(result.$defs).toBeDefined();
    expect(result.definitions).toBeUndefined();
  });

  it("draft_convert: → draft-07", async () => {
    const schema = JSON.stringify({ type: "object", $defs: { Foo: { type: "string" } } });
    const result = JSON.parse(await tool.execute({ action: "draft_convert", schema, target_draft: "draft-07" }));
    expect(result.$schema).toContain("draft-07");
    expect(result.definitions).toBeDefined();
    expect(result.$defs).toBeUndefined();
  });

  it("draft_convert: 유효하지 않은 JSON → error 반환", async () => {
    const result = JSON.parse(await tool.execute({ action: "draft_convert", schema: "bad" }));
    expect(result.error).toContain("invalid schema JSON");
  });

  // ── diff ─────────────────────────────────────────────

  it("diff: 추가된 속성", async () => {
    const s1 = JSON.stringify({ type: "object", properties: { a: { type: "string" } } });
    const s2 = JSON.stringify({ type: "object", properties: { a: { type: "string" }, b: { type: "number" } } });
    const result = JSON.parse(await tool.execute({ action: "diff", schema: s1, schema2: s2 }));
    expect(result.added).toContain("b");
    expect(result.removed).toHaveLength(0);
  });

  it("diff: 삭제된 속성", async () => {
    const s1 = JSON.stringify({ type: "object", properties: { a: { type: "string" }, b: { type: "number" } } });
    const s2 = JSON.stringify({ type: "object", properties: { a: { type: "string" } } });
    const result = JSON.parse(await tool.execute({ action: "diff", schema: s1, schema2: s2 }));
    expect(result.removed).toContain("b");
  });

  it("diff: 타입 변경 → type_changed=true", async () => {
    const s1 = JSON.stringify({ type: "object" });
    const s2 = JSON.stringify({ type: "array" });
    const result = JSON.parse(await tool.execute({ action: "diff", schema: s1, schema2: s2 }));
    expect(result.type_changed).toBe(true);
  });

  it("diff: 유효하지 않은 schema JSON → error 반환", async () => {
    const result = JSON.parse(await tool.execute({ action: "diff", schema: "bad", schema2: "{}" }));
    expect(result.error).toBeDefined();
  });

  it("diff: 유효하지 않은 schema2 JSON → error 반환", async () => {
    const result = JSON.parse(await tool.execute({ action: "diff", schema: "{}", schema2: "bad" }));
    expect(result.error).toContain("schema2");
  });

  // ── merge ─────────────────────────────────────────────

  it("merge: required 합집합", async () => {
    const s1 = JSON.stringify({ type: "object", properties: { a: {} }, required: ["a"] });
    const s2 = JSON.stringify({ type: "object", properties: { b: {} }, required: ["b"] });
    const result = JSON.parse(await tool.execute({ action: "merge", schema: s1, schema2: s2 }));
    expect(result.required).toContain("a");
    expect(result.required).toContain("b");
  });

  it("merge: 유효하지 않은 schema2 JSON → error 반환", async () => {
    const result = JSON.parse(await tool.execute({ action: "merge", schema: "{}", schema2: "bad" }));
    expect(result.error).toContain("schema2");
  });

  // ── dereference ────────────────────────────────────────

  it("dereference: $ref 해결", async () => {
    const schema = JSON.stringify({
      type: "object",
      properties: { pet: { $ref: "#/$defs/Pet" } },
      $defs: { Pet: { type: "object", properties: { name: { type: "string" } } } },
    });
    const result = JSON.parse(await tool.execute({ action: "dereference", schema }));
    expect(result.properties.pet.type).toBe("object");
    expect(result.properties.pet.properties.name.type).toBe("string");
  });

  it("dereference: 외부 $ref → 그대로 유지", async () => {
    const schema = JSON.stringify({ $ref: "external.json#/Pet" });
    const result = JSON.parse(await tool.execute({ action: "dereference", schema }));
    expect(result.$ref).toBe("external.json#/Pet");
  });

  it("dereference: 배열 내 노드 포함 → 처리됨", async () => {
    const schema = JSON.stringify({
      type: "array",
      items: { type: "string" },
      $defs: {},
    });
    const result = JSON.parse(await tool.execute({ action: "dereference", schema }));
    expect(result.type).toBe("array");
  });

  // ── mock 세부 브랜치 ──────────────────────────────────

  it("mock: null 타입", async () => {
    const schema = JSON.stringify({ type: "null" });
    const result = JSON.parse(await tool.execute({ action: "mock", schema }));
    expect(result).toBeNull();
  });

  it("mock: boolean 타입", async () => {
    const schema = JSON.stringify({ type: "boolean" });
    const result = JSON.parse(await tool.execute({ action: "mock", schema }));
    expect(result).toBe(true);
  });

  it("mock: string enum → 첫 번째 값", async () => {
    const schema = JSON.stringify({ type: "string", enum: ["foo", "bar"] });
    const result = JSON.parse(await tool.execute({ action: "mock", schema }));
    expect(result).toBe("foo");
  });

  it("mock: array with items", async () => {
    const schema = JSON.stringify({ type: "array", items: { type: "string" } });
    const result = JSON.parse(await tool.execute({ action: "mock", schema }));
    expect(Array.isArray(result)).toBe(true);
    expect(result[0]).toBe("example");
  });

  it("mock: array without items → 빈 배열", async () => {
    const schema = JSON.stringify({ type: "array" });
    const result = JSON.parse(await tool.execute({ action: "mock", schema }));
    expect(result).toEqual([]);
  });

  it("mock: number minimum 있음 → minimum 반환", async () => {
    const schema = JSON.stringify({ type: "number", minimum: 5 });
    const result = JSON.parse(await tool.execute({ action: "mock", schema }));
    expect(result).toBe(5);
  });

  it("mock: integer minimum 없음 → 0 반환", async () => {
    const schema = JSON.stringify({ type: "integer" });
    const result = JSON.parse(await tool.execute({ action: "mock", schema }));
    expect(result).toBe(0);
  });

  it("mock: unknown type → null 반환", async () => {
    const schema = JSON.stringify({ type: "unknown_type" });
    const result = JSON.parse(await tool.execute({ action: "mock", schema }));
    expect(result).toBeNull();
  });
});
