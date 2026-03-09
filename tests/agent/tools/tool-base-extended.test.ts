/**
 * Tool 기반 클래스 확장 커버리지 — number 강제변환, array 검증, secret resolver.
 */
import { describe, it, expect, vi } from "vitest";
import { Tool } from "@src/agent/tools/base.js";
import type { JsonSchema } from "@src/agent/tools/types.js";
import type { ParamSecretResolver } from "@src/agent/tools/base.js";

// ── 헬퍼 도구 ──

function make_tool(params_schema: JsonSchema): Tool & { last_params: Record<string, unknown> } {
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

// ── coerce_params: number 타입 강제변환 ──

describe("Tool — coerce_params: number 타입", () => {
  it("number 프로퍼티: 문자열 → number 변환", async () => {
    const tool = make_tool({
      type: "object",
      properties: { rate: { type: "number" } },
    });
    await tool.execute({ rate: "3.14" });
    expect(tool.last_params.rate).toBe(3.14);
  });

  it("number 프로퍼티: 정수 문자열 → number 변환", async () => {
    const tool = make_tool({
      type: "object",
      properties: { score: { type: "number" } },
    });
    await tool.execute({ score: "100" });
    expect(tool.last_params.score).toBe(100);
  });

  it("number 프로퍼티: 숫자가 아닌 문자열 → 변환 없음(NaN 스킵)", async () => {
    const tool = make_tool({
      type: "object",
      properties: { value: { type: "number" } },
    });
    await tool.execute({ value: "not-a-number" });
    expect(tool.last_params.value).toBe("not-a-number");
  });
});

// ── validate_params: array 항목 검증 ──

describe("Tool — validate_params: array 항목 검증", () => {
  it("array items 타입 검증: 잘못된 항목 → 에러", () => {
    const tool = make_tool({
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
    const tool = make_tool({
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

// ── validate_params: string minLength/maxLength ──

describe("Tool — validate_params: string length 검증", () => {
  it("minLength 위반 → 에러", () => {
    const tool = make_tool({
      type: "object",
      properties: { name: { type: "string", minLength: 3 } },
    });
    const errors = tool.validate_params({ name: "ab" });
    expect(errors.some((e) => e.includes("too short"))).toBe(true);
  });

  it("maxLength 위반 → 에러", () => {
    const tool = make_tool({
      type: "object",
      properties: { name: { type: "string", maxLength: 5 } },
    });
    const errors = tool.validate_params({ name: "toolongstring" });
    expect(errors.some((e) => e.includes("too long"))).toBe(true);
  });

  it("length 범위 내 → 에러 없음", () => {
    const tool = make_tool({
      type: "object",
      properties: { name: { type: "string", minLength: 2, maxLength: 10 } },
    });
    const errors = tool.validate_params({ name: "hello" });
    expect(errors).toHaveLength(0);
  });
});

// ── set_secret_resolver / resolve_param_secrets ──

describe("Tool — set_secret_resolver", () => {
  it("resolver 주입 후 시크릿 해석", async () => {
    const tool = make_tool({
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
    const tool = make_tool({
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
    expect(tool.last_params).toEqual({}); // run 호출 안됨
  });

  it("invalid_ciphertexts → 에러 메시지 반환", async () => {
    const tool = make_tool({
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
    const tool = make_tool({
      type: "object",
      properties: { token: { type: "string" } },
    });
    await tool.execute({ token: "plain-value" });
    expect(tool.last_params.token).toBe("plain-value");
  });

  it("배열 파라미터의 문자열 항목도 resolver 적용", async () => {
    const tool = make_tool({
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

// ── coerce_params: boolean 파생 케이스 ──

describe("Tool — coerce_boolean 다양한 케이스", () => {
  it("숫자 0 → false", async () => {
    const tool = make_tool({
      type: "object",
      properties: { flag: { type: "boolean" } },
    });
    await tool.execute({ flag: 0 });
    expect(tool.last_params.flag).toBe(false);
  });

  it("숫자 1 → true", async () => {
    const tool = make_tool({
      type: "object",
      properties: { flag: { type: "boolean" } },
    });
    await tool.execute({ flag: 1 });
    expect(tool.last_params.flag).toBe(true);
  });

  it("'네' 문자열 → true", async () => {
    const tool = make_tool({
      type: "object",
      properties: { flag: { type: "boolean" } },
    });
    await tool.execute({ flag: "네" });
    expect(tool.last_params.flag).toBe(true);
  });

  it("'아니오' 문자열 → false", async () => {
    const tool = make_tool({
      type: "object",
      properties: { flag: { type: "boolean" } },
    });
    await tool.execute({ flag: "아니오" });
    expect(tool.last_params.flag).toBe(false);
  });

  it("알 수 없는 문자열 → Boolean() 변환", async () => {
    const tool = make_tool({
      type: "object",
      properties: { flag: { type: "boolean" } },
    });
    await tool.execute({ flag: "random" });
    expect(tool.last_params.flag).toBe(true); // Boolean("random") = true
  });
});

// ── validate_params: 중첩 객체 검증 ──

describe("Tool — validate_params: 중첩 객체", () => {
  it("중첩 객체의 required 누락 → 에러", () => {
    const tool = make_tool({
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
    const tool = make_tool({
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

// ── TYPE_MAP number/boolean 분기 (L26, L27) ────────────────────────────

describe("Tool — validate_params: number/boolean TYPE_MAP 검증 (L26, L27)", () => {
  it("number 타입에 문자열 → 에러 (TYPE_MAP number 호출)", () => {
    const tool = make_tool({
      type: "object",
      required: ["price"],
      properties: { price: { type: "number" } },
    });
    const errors = tool.validate_params({ price: "not-a-number" });
    expect(errors.some((e) => e.includes("number"))).toBe(true);
  });

  it("boolean 타입에 문자열 → 에러 (TYPE_MAP boolean 호출)", () => {
    const tool = make_tool({
      type: "object",
      required: ["active"],
      properties: { active: { type: "boolean" } },
    });
    const errors = tool.validate_params({ active: "yes" });
    expect(errors.some((e) => e.includes("boolean"))).toBe(true);
  });
});
