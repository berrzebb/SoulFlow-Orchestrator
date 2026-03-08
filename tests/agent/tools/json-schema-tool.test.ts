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
});
