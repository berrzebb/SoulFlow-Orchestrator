/**
 * base.ts — 미커버 분기 보충:
 * - L63: validate_params — schema.type !== "object" → 에러 반환
 * - L122: coerce_params — parameters에 properties 없음 → params 그대로 반환
 * - L171: validate_value — object에 schema에 없는 key → continue (props[k] falsy)
 */
import { describe, it, expect } from "vitest";
import { Tool } from "@src/agent/tools/base.js";
import type { JsonSchema } from "@src/agent/tools/types.js";

// ── 헬퍼: Tool 서브클래스 팩토리 ──────────────────────────────────────────────

function make_tool(params: JsonSchema | undefined): Tool {
  return new class extends Tool {
    readonly name = "test_tool";
    readonly description = "test";
    readonly parameters = params;
    async execute(_params: Record<string, unknown>): Promise<string> {
      return "ok";
    }
  }();
}

// ── L63: schema.type !== "object" → ["parameters schema must be object"] ──────

describe("Tool.validate_params — L63: schema.type !== 'object'", () => {
  it("parameters.type='array' → validate_params 즉시 에러 반환 (L63)", () => {
    const tool = make_tool({ type: "array", items: { type: "string" } } as unknown as JsonSchema);
    const errors = tool.validate_params({ anything: true });
    expect(errors).toContain("parameters schema must be object");
  });
});

// ── L122: parameters에 properties 없음 → coerce_params 즉시 return ─────────────

describe("Tool.coerce_params — L122: properties 없음 → params 그대로 반환", () => {
  it("parameters에 properties 키 없음 → coerce 스킵 (L122)", async () => {
    // parameters = { type: "object" } without properties → props=undefined → L122 early return
    const tool = make_tool({ type: "object" } as JsonSchema);
    const result = await tool.execute({ some_key: "value" });
    expect(result).toBe("ok");
  });
});

// ── L171: object에 schema 없는 키 → continue ─────────────────────────────────

describe("Tool.validate_params — L171: 스키마에 없는 object 키 → continue", () => {
  it("params에 schema.properties에 없는 key → L171 continue (에러 없음)", () => {
    const tool = make_tool({
      type: "object",
      properties: {
        name: { type: "string" },
      },
      required: ["name"],
    } as JsonSchema);
    // extra_key는 schema에 없음 → L171: if(!props[k]) continue
    const errors = tool.validate_params({ name: "Alice", extra_key: "ignored" });
    expect(errors).toHaveLength(0);
  });
});
