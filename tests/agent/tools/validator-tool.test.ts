/**
 * ValidatorTool — JSON Schema 검증 + 포맷 검증 + 커스텀 룰 테스트.
 */
import { describe, it, expect } from "vitest";
import { ValidatorTool } from "../../../src/agent/tools/validator.js";

const tool = new ValidatorTool();

async function exec(params: Record<string, unknown>): Promise<unknown> {
  const result = await tool.execute(params);
  try { return JSON.parse(String(result)); } catch { return result; }
}

describe("ValidatorTool — schema", () => {
  it("유효한 객체 스키마 검증 통과", async () => {
    const schema = JSON.stringify({
      type: "object",
      required: ["name", "age"],
      properties: {
        name: { type: "string" },
        age: { type: "number" },
      },
    });
    const r = await exec({ operation: "schema", input: JSON.stringify({ name: "Alice", age: 30 }), schema }) as Record<string, unknown>;
    expect(r.valid).toBe(true);
    expect(r.error_count).toBe(0);
  });

  it("required 필드 누락 → 오류", async () => {
    const schema = JSON.stringify({ type: "object", required: ["name"], properties: {} });
    const r = await exec({ operation: "schema", input: JSON.stringify({ age: 30 }), schema }) as Record<string, unknown>;
    expect(r.valid).toBe(false);
    expect(r.error_count).toBeGreaterThan(0);
  });

  it("타입 불일치 → 오류", async () => {
    const schema = JSON.stringify({ type: "object", properties: { age: { type: "number" } } });
    const r = await exec({ operation: "schema", input: JSON.stringify({ age: "thirty" }), schema }) as Record<string, unknown>;
    expect(r.valid).toBe(false);
  });

  it("integer 타입 검증", async () => {
    const schema = JSON.stringify({ type: "integer" });
    const ok = await exec({ operation: "schema", input: "42", schema }) as Record<string, unknown>;
    expect(ok.valid).toBe(true);
    const fail = await exec({ operation: "schema", input: "3.14", schema }) as Record<string, unknown>;
    expect(fail.valid).toBe(false);
  });

  it("string minLength / maxLength 검증", async () => {
    const schema = JSON.stringify({ type: "string", minLength: 3, maxLength: 5 });
    const ok = await exec({ operation: "schema", input: '"abc"', schema }) as Record<string, unknown>;
    expect(ok.valid).toBe(true);
    const tooShort = await exec({ operation: "schema", input: '"ab"', schema }) as Record<string, unknown>;
    expect(tooShort.valid).toBe(false);
    const tooLong = await exec({ operation: "schema", input: '"toolong"', schema }) as Record<string, unknown>;
    expect(tooLong.valid).toBe(false);
  });

  it("number minimum / maximum 검증", async () => {
    const schema = JSON.stringify({ type: "number", minimum: 0, maximum: 100 });
    const ok = await exec({ operation: "schema", input: "50", schema }) as Record<string, unknown>;
    expect(ok.valid).toBe(true);
    const fail = await exec({ operation: "schema", input: "-1", schema }) as Record<string, unknown>;
    expect(fail.valid).toBe(false);
  });

  it("enum 검증", async () => {
    const schema = JSON.stringify({ type: "string", enum: ["a", "b", "c"] });
    const ok = await exec({ operation: "schema", input: '"a"', schema }) as Record<string, unknown>;
    expect(ok.valid).toBe(true);
    const fail = await exec({ operation: "schema", input: '"d"', schema }) as Record<string, unknown>;
    expect(fail.valid).toBe(false);
  });

  it("array minItems / maxItems 검증", async () => {
    const schema = JSON.stringify({ type: "array", minItems: 2, maxItems: 3, items: { type: "number" } });
    const ok = await exec({ operation: "schema", input: "[1,2]", schema }) as Record<string, unknown>;
    expect(ok.valid).toBe(true);
    const tooFew = await exec({ operation: "schema", input: "[1]", schema }) as Record<string, unknown>;
    expect(tooFew.valid).toBe(false);
    const tooMany = await exec({ operation: "schema", input: "[1,2,3,4]", schema }) as Record<string, unknown>;
    expect(tooMany.valid).toBe(false);
  });

  it("string pattern 검증", async () => {
    const schema = JSON.stringify({ type: "string", pattern: "^\\d{3}$" });
    const ok = await exec({ operation: "schema", input: '"123"', schema }) as Record<string, unknown>;
    expect(ok.valid).toBe(true);
    const fail = await exec({ operation: "schema", input: '"abc"', schema }) as Record<string, unknown>;
    expect(fail.valid).toBe(false);
  });

  it("잘못된 JSON input → 오류", async () => {
    const r = await exec({ operation: "schema", input: "not-json", schema: "{}" }) as Record<string, unknown>;
    expect(r.valid).toBe(false);
  });

  it("잘못된 JSON Schema → 오류", async () => {
    const r = await exec({ operation: "schema", input: "{}", schema: "not-json" }) as Record<string, unknown>;
    expect(r.valid).toBe(false);
  });
});

describe("ValidatorTool — format", () => {
  it("유효한 email → valid: true", async () => {
    const r = await exec({ operation: "format", input: "user@example.com", format: "email" }) as Record<string, unknown>;
    expect(r.valid).toBe(true);
  });

  it("잘못된 email → valid: false", async () => {
    const r = await exec({ operation: "format", input: "notanemail", format: "email" }) as Record<string, unknown>;
    expect(r.valid).toBe(false);
  });

  it("유효한 URL → valid: true", async () => {
    const r = await exec({ operation: "format", input: "https://example.com/path", format: "url" }) as Record<string, unknown>;
    expect(r.valid).toBe(true);
  });

  it("잘못된 URL → valid: false", async () => {
    const r = await exec({ operation: "format", input: "ftp://bad", format: "url" }) as Record<string, unknown>;
    expect(r.valid).toBe(false);
  });

  it("유효한 IPv4 → valid: true", async () => {
    const r = await exec({ operation: "format", input: "192.168.1.1", format: "ip" }) as Record<string, unknown>;
    expect(r.valid).toBe(true);
  });

  it("잘못된 IP (256 범위 초과) → valid: false", async () => {
    const r = await exec({ operation: "format", input: "999.0.0.1", format: "ip" }) as Record<string, unknown>;
    expect(r.valid).toBe(false);
  });

  it("ISO date → valid: true", async () => {
    const r = await exec({ operation: "format", input: "2024-01-15", format: "date" }) as Record<string, unknown>;
    expect(r.valid).toBe(true);
  });

  it("ISO datetime → valid: true", async () => {
    const r = await exec({ operation: "format", input: "2024-01-15T10:30:00Z", format: "date" }) as Record<string, unknown>;
    expect(r.valid).toBe(true);
  });

  it("잘못된 date → valid: false", async () => {
    const r = await exec({ operation: "format", input: "not-a-date", format: "date" }) as Record<string, unknown>;
    expect(r.valid).toBe(false);
  });

  it("유효한 UUID → valid: true", async () => {
    const r = await exec({ operation: "format", input: "550e8400-e29b-41d4-a716-446655440000", format: "uuid" }) as Record<string, unknown>;
    expect(r.valid).toBe(true);
  });

  it("잘못된 UUID → valid: false", async () => {
    const r = await exec({ operation: "format", input: "not-a-uuid", format: "uuid" }) as Record<string, unknown>;
    expect(r.valid).toBe(false);
  });

  it("유효한 JSON → valid: true", async () => {
    const r = await exec({ operation: "format", input: '{"a":1}', format: "json" }) as Record<string, unknown>;
    expect(r.valid).toBe(true);
  });

  it("잘못된 JSON → valid: false", async () => {
    const r = await exec({ operation: "format", input: "not json", format: "json" }) as Record<string, unknown>;
    expect(r.valid).toBe(false);
  });

  it("유효한 number → valid: true", async () => {
    const r = await exec({ operation: "format", input: "3.14", format: "number" }) as Record<string, unknown>;
    expect(r.valid).toBe(true);
  });

  it("잘못된 number → valid: false", async () => {
    const r = await exec({ operation: "format", input: "abc", format: "number" }) as Record<string, unknown>;
    expect(r.valid).toBe(false);
  });

  it("미지원 format → Error", async () => {
    expect(String(await exec({ operation: "format", input: "test", format: "unknown" }))).toContain("Error");
  });
});

describe("ValidatorTool — rules", () => {
  it("required 룰 통과", async () => {
    const rules = JSON.stringify([{ field: "name", required: true, type: "string" }]);
    const r = await exec({ operation: "rules", input: JSON.stringify({ name: "Alice" }), rules }) as Record<string, unknown>;
    expect(r.valid).toBe(true);
  });

  it("required 필드 없음 → 오류", async () => {
    const rules = JSON.stringify([{ field: "email", required: true }]);
    const r = await exec({ operation: "rules", input: JSON.stringify({ name: "Alice" }), rules }) as Record<string, unknown>;
    expect(r.valid).toBe(false);
  });

  it("min / max 범위 룰", async () => {
    const rules = JSON.stringify([{ field: "score", type: "number", min: 0, max: 100 }]);
    const ok = await exec({ operation: "rules", input: JSON.stringify({ score: 85 }), rules }) as Record<string, unknown>;
    expect(ok.valid).toBe(true);
    const fail = await exec({ operation: "rules", input: JSON.stringify({ score: 150 }), rules }) as Record<string, unknown>;
    expect(fail.valid).toBe(false);
  });

  it("pattern 룰", async () => {
    const rules = JSON.stringify([{ field: "code", pattern: "^[A-Z]{3}$" }]);
    const ok = await exec({ operation: "rules", input: JSON.stringify({ code: "ABC" }), rules }) as Record<string, unknown>;
    expect(ok.valid).toBe(true);
    const fail = await exec({ operation: "rules", input: JSON.stringify({ code: "abc" }), rules }) as Record<string, unknown>;
    expect(fail.valid).toBe(false);
  });

  it("format 룰 (email)", async () => {
    const rules = JSON.stringify([{ field: "email", format: "email" }]);
    const ok = await exec({ operation: "rules", input: JSON.stringify({ email: "user@example.com" }), rules }) as Record<string, unknown>;
    expect(ok.valid).toBe(true);
    const fail = await exec({ operation: "rules", input: JSON.stringify({ email: "bad-email" }), rules }) as Record<string, unknown>;
    expect(fail.valid).toBe(false);
  });

  it("잘못된 rules JSON → 오류", async () => {
    const r = await exec({ operation: "rules", input: "{}", rules: "not-json" }) as Record<string, unknown>;
    expect(r.valid).toBe(false);
  });

  it("빈 input → Error", async () => {
    const r = String(await exec({ operation: "rules", input: "" }));
    expect(r).toContain("Error");
  });
});

// ══════════════════════════════════════════
// 미커버 분기 보충
// ══════════════════════════════════════════

describe("ValidatorTool — 미커버 분기", () => {
  it("unknown operation → Error (L45)", async () => {
    const r = await exec({ operation: "validate", input: "{}" });
    expect(String(r)).toContain("Error");
  });

  it("schema: number maximum 초과 → 오류 (L104)", async () => {
    const schema = JSON.stringify({ type: "object", properties: { score: { type: "number", maximum: 100 } } });
    const r = await exec({ operation: "schema", input: JSON.stringify({ score: 150 }), schema }) as Record<string, unknown>;
    expect(r.valid).toBe(false);
  });

  it("rules: invalid JSON input → 오류 (L126)", async () => {
    const rules = JSON.stringify([{ field: "name", required: true }]);
    const r = await exec({ operation: "rules", input: "not-json", rules }) as Record<string, unknown>;
    expect(r.valid).toBe(false);
  });

  it("rules: rule.field 없음 → continue (L133)", async () => {
    // field 없는 rule → skip (L133 continue)
    const rules = JSON.stringify([{ required: true }]);
    const r = await exec({ operation: "rules", input: JSON.stringify({ a: 1 }), rules }) as Record<string, unknown>;
    expect(r.valid).toBe(true);
  });

  it("rules: 필드 존재하지 않음 + not required → skip (L141)", async () => {
    const rules = JSON.stringify([{ field: "missing", type: "string" }]);
    const r = await exec({ operation: "rules", input: JSON.stringify({ a: 1 }), rules }) as Record<string, unknown>;
    expect(r.valid).toBe(true);
  });

  it("rules: 필드 타입 불일치 → 오류 (L145)", async () => {
    const rules = JSON.stringify([{ field: "age", type: "string" }]);
    const r = await exec({ operation: "rules", input: JSON.stringify({ age: 30 }), rules }) as Record<string, unknown>;
    expect(r.valid).toBe(false);
  });

  it("format: ip 비숫자 → 정규식 실패 → is_valid_ip false (L166)", async () => {
    // "not-an-ip" → IPV4_RE 실패 → L166 return false
    const r = await exec({ operation: "format", input: "not-an-ip", format: "ip" }) as Record<string, unknown>;
    expect(r.valid).toBe(false);
  });

  it("rules: min 미만 값 → 오류 (L148)", async () => {
    const rules = JSON.stringify([{ field: "score", min: 50 }]);
    const r = await exec({ operation: "rules", input: JSON.stringify({ score: 10 }), rules }) as Record<string, unknown>;
    expect(r.valid).toBe(false);
  });
});
