import { describe, it, expect } from "vitest";
import { AssertTool } from "@src/agent/tools/assert.js";

function make_tool(): AssertTool {
  return new AssertTool();
}

describe("AssertTool", () => {
  describe("eq", () => {
    it("같은 문자열 → pass", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "eq", value: '"hello"', expected: '"hello"' }));
      expect(result.pass).toBe(true);
    });

    it("다른 값 → fail", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "eq", value: '"a"', expected: '"b"' }));
      expect(result.pass).toBe(false);
    });

    it("숫자 비교", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "eq", value: "42", expected: "42" }));
      expect(result.pass).toBe(true);
    });
  });

  describe("neq", () => {
    it("다른 값 → pass", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "neq", value: "1", expected: "2" }));
      expect(result.pass).toBe(true);
    });

    it("같은 값 → fail", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "neq", value: "1", expected: "1" }));
      expect(result.pass).toBe(false);
    });
  });

  describe("type_is", () => {
    it("string 타입 확인", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "type_is", value: '"hello"', expected: "string" }));
      expect(result.pass).toBe(true);
    });

    it("number 타입 확인", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "type_is", value: "42", expected: "number" }));
      expect(result.pass).toBe(true);
    });

    it("array 타입 확인", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "type_is", value: "[1,2,3]", expected: "array" }));
      expect(result.pass).toBe(true);
    });

    it("null 타입 확인", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "type_is", value: "null", expected: "null" }));
      expect(result.pass).toBe(true);
    });

    it("타입 불일치 → fail", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "type_is", value: '"hello"', expected: "number" }));
      expect(result.pass).toBe(false);
    });
  });

  describe("truthy / falsy", () => {
    it("truthy: non-empty string", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "truthy", value: '"hello"' }));
      expect(result.pass).toBe(true);
    });

    it("falsy: null", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "falsy", value: "null" }));
      expect(result.pass).toBe(true);
    });

    it("falsy: false", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "falsy", value: "false" }));
      expect(result.pass).toBe(true);
    });
  });

  describe("contains", () => {
    it("문자열 포함", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "contains", value: '"hello world"', expected: "world" }));
      expect(result.pass).toBe(true);
    });

    it("배열 포함", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "contains", value: '["a","b","c"]', expected: "b" }));
      expect(result.pass).toBe(true);
    });

    it("미포함 → fail", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "contains", value: '"hello"', expected: "xyz" }));
      expect(result.pass).toBe(false);
    });
  });

  describe("matches", () => {
    it("정규식 일치", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "matches", value: '"hello123"', expected: "\\d+" }));
      expect(result.pass).toBe(true);
    });

    it("정규식 불일치 → fail", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "matches", value: '"hello"', expected: "^\\d+$" }));
      expect(result.pass).toBe(false);
    });
  });

  describe("range", () => {
    it("범위 내 → pass", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "range", value: "50", min: 0, max: 100 }));
      expect(result.pass).toBe(true);
    });

    it("범위 밖 → fail", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "range", value: "150", min: 0, max: 100 }));
      expect(result.pass).toBe(false);
    });
  });

  describe("length", () => {
    it("문자열 길이 범위", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "length", value: '"hello"', min: 1, max: 10 }));
      expect(result.pass).toBe(true);
    });

    it("배열 길이 범위", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "length", value: "[1,2,3]", min: 2, max: 5 }));
      expect(result.pass).toBe(true);
    });
  });

  describe("schema", () => {
    it("필수 필드 있는 객체 → pass", async () => {
      const value = JSON.stringify({ name: "test", age: 30 });
      const schema = JSON.stringify({ type: "object", required: ["name", "age"] });
      const result = JSON.parse(await make_tool().execute({ action: "schema", value, expected: schema }));
      expect(result.pass).toBe(true);
    });

    it("필수 필드 누락 → fail", async () => {
      const value = JSON.stringify({ name: "test" });
      const schema = JSON.stringify({ type: "object", required: ["name", "age"] });
      const result = JSON.parse(await make_tool().execute({ action: "schema", value, expected: schema }));
      expect(result.pass).toBe(false);
    });

    it("타입 불일치 → fail", async () => {
      const schema = JSON.stringify({ type: "array" });
      const result = JSON.parse(await make_tool().execute({ action: "schema", value: '"hello"', expected: schema }));
      expect(result.pass).toBe(false);
    });
  });

  it("custom message 전달", async () => {
    const result = JSON.parse(await make_tool().execute({ action: "truthy", value: "null", message: "값이 없습니다" }));
    expect(result.detail).toBe("값이 없습니다");
  });

  it("지원하지 않는 action → 에러", async () => {
    const result = await make_tool().execute({ action: "nope", value: "x" });
    expect(result).toContain("unsupported action");
  });
});
