/**
 * Tool base class — validate_params, coerce_params, to_schema, execute 테스트.
 */
import { describe, it, expect } from "vitest";
import { Tool } from "../../../src/agent/tools/base.js";
import type { JsonSchema } from "../../../src/agent/tools/types.js";

class TestTool extends Tool {
  readonly name = "test_tool";
  readonly category = "memory" as const;
  readonly description = "A test tool";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      text: { type: "string", description: "Input text" },
      count: { type: "integer", minimum: 1, maximum: 100, description: "Count" },
      verbose: { type: "boolean", description: "Verbose mode" },
      mode: { type: "string", enum: ["fast", "slow"], description: "Mode" },
    },
    required: ["text"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    return JSON.stringify(params);
  }
}

describe("Tool base class", () => {
  const tool = new TestTool();

  // ── to_schema ──
  it("to_schema: function schema 형식 반환", () => {
    const schema = tool.to_schema();
    expect(schema.type).toBe("function");
    expect(schema.function.name).toBe("test_tool");
    expect(schema.function.description).toBe("A test tool");
    expect(schema.function.parameters).toBeDefined();
  });

  // ── validate_params ──
  it("validate_params: 유효한 파라미터 → 에러 없음", () => {
    const errors = tool.validate_params({ text: "hello", count: 5 });
    expect(errors).toEqual([]);
  });

  it("validate_params: required 누락 → 에러", () => {
    const errors = tool.validate_params({ count: 5 });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("text");
  });

  it("validate_params: 타입 불일치 → 에러", () => {
    const errors = tool.validate_params({ text: 123 });
    expect(errors.length).toBeGreaterThan(0);
  });

  it("validate_params: enum 불일치 → 에러", () => {
    const errors = tool.validate_params({ text: "hi", mode: "invalid" });
    expect(errors.some(e => e.includes("must be one of"))).toBe(true);
  });

  it("validate_params: minimum 위반 → 에러", () => {
    const errors = tool.validate_params({ text: "hi", count: 0 });
    expect(errors.some(e => e.includes(">= 1"))).toBe(true);
  });

  it("validate_params: maximum 위반 → 에러", () => {
    const errors = tool.validate_params({ text: "hi", count: 200 });
    expect(errors.some(e => e.includes("<= 100"))).toBe(true);
  });

  // ── execute (coerce_params) ──
  it("execute: boolean 문자열 자동 변환", async () => {
    const result = await tool.execute({ text: "hi", verbose: "true" });
    const parsed = JSON.parse(result);
    expect(parsed.verbose).toBe(true);
  });

  it("execute: integer 문자열 자동 변환", async () => {
    const result = await tool.execute({ text: "hi", count: "42" });
    const parsed = JSON.parse(result);
    expect(parsed.count).toBe(42);
  });

  it("execute: 정상 파라미터 그대로 통과", async () => {
    const result = await tool.execute({ text: "hello", count: 5, verbose: false });
    const parsed = JSON.parse(result);
    expect(parsed.text).toBe("hello");
    expect(parsed.count).toBe(5);
    expect(parsed.verbose).toBe(false);
  });
});
