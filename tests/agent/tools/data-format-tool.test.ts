/**
 * DataFormatTool — convert/query/validate/flatten/pick/omit 테스트.
 */
import { describe, it, expect } from "vitest";
import { DataFormatTool } from "../../../src/agent/tools/data-format.js";

describe("DataFormatTool", () => {
  const tool = new DataFormatTool();

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
