/**
 * Tool base class — validate_params, coerce_params, to_schema, execute 테스트.
 */
import { describe, it, expect, vi } from "vitest";
import { Tool } from "../../../src/agent/tools/base.js";
import type { JsonSchema } from "../../../src/agent/tools/types.js";
import type { ParamSecretResolver } from "../../../src/agent/tools/base.js";

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

// ── 미커버 분기 보충용 헬퍼 ──

function make_tool(params: JsonSchema | undefined): Tool {
  return new class extends Tool {
    readonly name = "test_tool";
    readonly description = "test";
    readonly category = "util" as const;
    readonly parameters = params as JsonSchema;
    protected async run(_params: Record<string, unknown>): Promise<string> {
      return "ok";
    }
  }();
}

describe("Tool.validate_params — schema.type !== 'object'", () => {
  it("parameters.type='array' → validate_params 즉시 에러 반환", () => {
    const tool = make_tool({ type: "array", items: { type: "string" } } as unknown as JsonSchema);
    const errors = tool.validate_params({ anything: true });
    expect(errors).toContain("parameters schema must be object");
  });
});

describe("Tool.coerce_params — properties 없음 → params 그대로 반환", () => {
  it("parameters에 properties 키 없음 → coerce 스킵", async () => {
    const tool = make_tool({ type: "object" } as JsonSchema);
    const result = await tool.execute({ some_key: "value" });
    expect(result).toBe("ok");
  });
});

describe("Tool.validate_params — 스키마에 없는 object 키 → continue", () => {
  it("params에 schema.properties에 없는 key → continue (에러 없음)", () => {
    const tool = make_tool({
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    } as JsonSchema);
    const errors = tool.validate_params({ name: "Alice", extra_key: "ignored" });
    expect(errors).toHaveLength(0);
  });
});

// ══════════════════════════════════════════
// 확장: coerce_params number, array 검증, secret resolver, boolean, 중첩 객체
// ══════════════════════════════════════════

function make_capture_tool(params_schema: JsonSchema): Tool & { last_params: Record<string, unknown> } {
  class CaptureTool extends Tool {
    readonly name = "capture";
    readonly category = "memory" as const;
    readonly description = "Capture params";
    readonly parameters = params_schema;
    last_params: Record<string, unknown> = {};
    protected async run(params: Record<string, unknown>): Promise<string> {
      this.last_params = params;
      return "ok";
    }
  }
  return new CaptureTool() as CaptureTool & { last_params: Record<string, unknown> };
}

describe("Tool — coerce_params: number 타입", () => {
  it("number 프로퍼티: 문자열 → number 변환", async () => {
    const tool = make_capture_tool({
      type: "object",
      properties: { rate: { type: "number" } },
    });
    await tool.execute({ rate: "3.14" });
    expect(tool.last_params.rate).toBe(3.14);
  });

  it("number 프로퍼티: 정수 문자열 → number 변환", async () => {
    const tool = make_capture_tool({
      type: "object",
      properties: { score: { type: "number" } },
    });
    await tool.execute({ score: "100" });
    expect(tool.last_params.score).toBe(100);
  });

  it("number 프로퍼티: 숫자가 아닌 문자열 → 변환 없음(NaN 스킵)", async () => {
    const tool = make_capture_tool({
      type: "object",
      properties: { value: { type: "number" } },
    });
    await tool.execute({ value: "not-a-number" });
    expect(tool.last_params.value).toBe("not-a-number");
  });
});

describe("Tool — validate_params: array 항목 검증", () => {
  it("array items 타입 검증: 잘못된 항목 → 에러", () => {
    const tool = make_capture_tool({
      type: "object",
      properties: {
        tags: {
          type: "array",
          items: { type: "string" },
        },
      },
    });
    const errors = tool.validate_params({ tags: ["a", 2, "c"] });
    expect(errors.some((e) => e.includes("should be string"))).toBe(true);
  });

  it("array items 타입 검증: 모두 올바른 타입 → 에러 없음", () => {
    const tool = make_capture_tool({
      type: "object",
      properties: {
        tags: {
          type: "array",
          items: { type: "string" },
        },
      },
    });
    const errors = tool.validate_params({ tags: ["a", "b", "c"] });
    expect(errors).toHaveLength(0);
  });
});

describe("Tool — validate_params: string length 검증", () => {
  it("minLength 위반 → 에러", () => {
    const tool = make_capture_tool({
      type: "object",
      properties: { name: { type: "string", minLength: 3 } },
    });
    const errors = tool.validate_params({ name: "ab" });
    expect(errors.some((e) => e.includes("too short"))).toBe(true);
  });

  it("maxLength 위반 → 에러", () => {
    const tool = make_capture_tool({
      type: "object",
      properties: { name: { type: "string", maxLength: 5 } },
    });
    const errors = tool.validate_params({ name: "toolongstring" });
    expect(errors.some((e) => e.includes("too long"))).toBe(true);
  });

  it("length 범위 내 → 에러 없음", () => {
    const tool = make_capture_tool({
      type: "object",
      properties: { name: { type: "string", minLength: 2, maxLength: 10 } },
    });
    const errors = tool.validate_params({ name: "hello" });
    expect(errors).toHaveLength(0);
  });
});

describe("Tool — set_secret_resolver", () => {
  it("resolver 주입 후 시크릿 해석", async () => {
    const tool = make_capture_tool({
      type: "object",
      properties: { token: { type: "string" } },
    });
    const resolver: ParamSecretResolver = {
      resolve_inline_secrets_with_report: vi.fn().mockResolvedValue({
        text: "resolved-secret",
        missing_keys: [],
        invalid_ciphertexts: [],
      }),
    };
    tool.set_secret_resolver(resolver);
    await tool.execute({ token: "{{secret:MY_TOKEN}}" });
    expect(tool.last_params.token).toBe("resolved-secret");
    expect(resolver.resolve_inline_secrets_with_report).toHaveBeenCalled();
  });

  it("missing_keys → 에러 메시지 반환 (run 미호출)", async () => {
    const tool = make_capture_tool({
      type: "object",
      properties: { token: { type: "string" } },
    });
    const resolver: ParamSecretResolver = {
      resolve_inline_secrets_with_report: vi.fn().mockResolvedValue({
        text: "{{secret:MISSING_KEY}}",
        missing_keys: ["MISSING_KEY"],
        invalid_ciphertexts: [],
      }),
    };
    tool.set_secret_resolver(resolver);
    const result = await tool.execute({ token: "{{secret:MISSING_KEY}}" });
    expect(result).toContain("secret_resolution_required");
    expect(result).toContain("MISSING_KEY");
    expect(tool.last_params).toEqual({});
  });

  it("invalid_ciphertexts → 에러 메시지 반환", async () => {
    const tool = make_capture_tool({
      type: "object",
      properties: { token: { type: "string" } },
    });
    const resolver: ParamSecretResolver = {
      resolve_inline_secrets_with_report: vi.fn().mockResolvedValue({
        text: "bad-cipher",
        missing_keys: [],
        invalid_ciphertexts: ["BAD_TOKEN"],
      }),
    };
    tool.set_secret_resolver(resolver);
    const result = await tool.execute({ token: "bad-cipher" });
    expect(result).toContain("secret_resolution_required");
    expect(result).toContain("BAD_TOKEN");
  });

  it("resolver 없으면 문자열 그대로 통과", async () => {
    const tool = make_capture_tool({
      type: "object",
      properties: { token: { type: "string" } },
    });
    await tool.execute({ token: "plain-value" });
    expect(tool.last_params.token).toBe("plain-value");
  });

  it("배열 파라미터의 문자열 항목도 resolver 적용", async () => {
    const tool = make_capture_tool({
      type: "object",
      properties: { items: { type: "array" } },
    });
    const resolver: ParamSecretResolver = {
      resolve_inline_secrets_with_report: vi.fn().mockResolvedValue({
        text: "resolved",
        missing_keys: [],
        invalid_ciphertexts: [],
      }),
    };
    tool.set_secret_resolver(resolver);
    await tool.execute({ items: ["{{secret:K}}"] });
    expect(resolver.resolve_inline_secrets_with_report).toHaveBeenCalled();
  });
});

describe("Tool — coerce_boolean 다양한 케이스", () => {
  it("숫자 0 → false", async () => {
    const tool = make_capture_tool({
      type: "object",
      properties: { flag: { type: "boolean" } },
    });
    await tool.execute({ flag: 0 });
    expect(tool.last_params.flag).toBe(false);
  });

  it("숫자 1 → true", async () => {
    const tool = make_capture_tool({
      type: "object",
      properties: { flag: { type: "boolean" } },
    });
    await tool.execute({ flag: 1 });
    expect(tool.last_params.flag).toBe(true);
  });

  it("'네' 문자열 → true", async () => {
    const tool = make_capture_tool({
      type: "object",
      properties: { flag: { type: "boolean" } },
    });
    await tool.execute({ flag: "네" });
    expect(tool.last_params.flag).toBe(true);
  });

  it("'아니오' 문자열 → false", async () => {
    const tool = make_capture_tool({
      type: "object",
      properties: { flag: { type: "boolean" } },
    });
    await tool.execute({ flag: "아니오" });
    expect(tool.last_params.flag).toBe(false);
  });

  it("알 수 없는 문자열 → Boolean() 변환", async () => {
    const tool = make_capture_tool({
      type: "object",
      properties: { flag: { type: "boolean" } },
    });
    await tool.execute({ flag: "random" });
    expect(tool.last_params.flag).toBe(true);
  });
});

describe("Tool — validate_params: 중첩 객체", () => {
  it("중첩 객체의 required 누락 → 에러", () => {
    const tool = make_capture_tool({
      type: "object",
      properties: {
        config: {
          type: "object",
          properties: { host: { type: "string" } },
          required: ["host"],
        },
      },
    });
    const errors = tool.validate_params({ config: {} });
    expect(errors.some((e) => e.includes("host"))).toBe(true);
  });

  it("중첩 객체 프로퍼티 타입 오류 → 에러", () => {
    const tool = make_capture_tool({
      type: "object",
      properties: {
        config: {
          type: "object",
          properties: { port: { type: "integer" } },
        },
      },
    });
    const errors = tool.validate_params({ config: { port: "not-int" } });
    expect(errors.some((e) => e.includes("integer"))).toBe(true);
  });
});

describe("Tool — validate_params: number/boolean TYPE_MAP 검증", () => {
  it("number 타입에 문자열 → 에러", () => {
    const tool = make_capture_tool({
      type: "object",
      required: ["price"],
      properties: { price: { type: "number" } },
    });
    const errors = tool.validate_params({ price: "not-a-number" });
    expect(errors.some((e) => e.includes("number"))).toBe(true);
  });

  it("boolean 타입에 문자열 → 에러", () => {
    const tool = make_capture_tool({
      type: "object",
      required: ["active"],
      properties: { active: { type: "boolean" } },
    });
    const errors = tool.validate_params({ active: "yes" });
    expect(errors.some((e) => e.includes("boolean"))).toBe(true);
  });
});
