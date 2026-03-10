/**
 * AssertTool — 런타임 값 검증 (eq/neq/type_is/truthy/falsy/contains/matches/range/length/schema) 테스트.
 */
import { describe, it, expect } from "vitest";
import { AssertTool } from "../../../src/agent/tools/assert.js";

const tool = new AssertTool();

async function exec(params: Record<string, unknown>): Promise<unknown> {
  const result = await tool.execute(params);
  try { return JSON.parse(String(result)); } catch { return result; }
}

describe("AssertTool — eq", () => {
  it("같은 값 → pass: true", async () => {
    const r = await exec({ action: "eq", value: "42", expected: "42" }) as Record<string, unknown>;
    expect(r.pass).toBe(true);
  });

  it("다른 값 → pass: false", async () => {
    const r = await exec({ action: "eq", value: "42", expected: "43" }) as Record<string, unknown>;
    expect(r.pass).toBe(false);
  });

  it("JSON 객체 비교", async () => {
    const r = await exec({ action: "eq", value: '{"a":1}', expected: '{"a":1}' }) as Record<string, unknown>;
    expect(r.pass).toBe(true);
  });

  it("사용자 정의 메시지", async () => {
    const r = await exec({ action: "eq", value: "1", expected: "2", message: "custom error" }) as Record<string, unknown>;
    expect(r.detail).toBe("custom error");
  });
});

describe("AssertTool — neq", () => {
  it("다른 값 → pass: true", async () => {
    const r = await exec({ action: "neq", value: "a", expected: "b" }) as Record<string, unknown>;
    expect(r.pass).toBe(true);
  });

  it("같은 값 → pass: false", async () => {
    const r = await exec({ action: "neq", value: "a", expected: "a" }) as Record<string, unknown>;
    expect(r.pass).toBe(false);
  });
});

describe("AssertTool — type_is", () => {
  it("string 타입 → pass: true", async () => {
    const r = await exec({ action: "type_is", value: '"hello"', expected: "string" }) as Record<string, unknown>;
    expect(r.pass).toBe(true);
  });

  it("number 타입 → pass: true", async () => {
    const r = await exec({ action: "type_is", value: "42", expected: "number" }) as Record<string, unknown>;
    expect(r.pass).toBe(true);
  });

  it("array 타입 → pass: true", async () => {
    const r = await exec({ action: "type_is", value: "[1,2,3]", expected: "array" }) as Record<string, unknown>;
    expect(r.pass).toBe(true);
  });

  it("null 타입 → pass: true", async () => {
    const r = await exec({ action: "type_is", value: "null", expected: "null" }) as Record<string, unknown>;
    expect(r.pass).toBe(true);
  });

  it("타입 불일치 → pass: false", async () => {
    const r = await exec({ action: "type_is", value: '"hello"', expected: "number" }) as Record<string, unknown>;
    expect(r.pass).toBe(false);
  });
});

describe("AssertTool — truthy / falsy", () => {
  it("0이 아닌 값 → truthy: pass", async () => {
    const r = await exec({ action: "truthy", value: "1" }) as Record<string, unknown>;
    expect(r.pass).toBe(true);
  });

  it("0 → truthy: fail", async () => {
    const r = await exec({ action: "truthy", value: "0" }) as Record<string, unknown>;
    expect(r.pass).toBe(false);
  });

  it("null → falsy: pass", async () => {
    const r = await exec({ action: "falsy", value: "null" }) as Record<string, unknown>;
    expect(r.pass).toBe(true);
  });

  it("\"hello\" → falsy: fail", async () => {
    const r = await exec({ action: "falsy", value: '"hello"' }) as Record<string, unknown>;
    expect(r.pass).toBe(false);
  });
});

describe("AssertTool — contains", () => {
  it("문자열 포함 → pass: true", async () => {
    const r = await exec({ action: "contains", value: '"hello world"', expected: "world" }) as Record<string, unknown>;
    expect(r.pass).toBe(true);
  });

  it("문자열 미포함 → pass: false", async () => {
    const r = await exec({ action: "contains", value: '"hello"', expected: "xyz" }) as Record<string, unknown>;
    expect(r.pass).toBe(false);
  });

  it("배열 포함 → pass: true", async () => {
    const r = await exec({ action: "contains", value: "[1,2,3]", expected: "2" }) as Record<string, unknown>;
    expect(r.pass).toBe(true);
  });

  it("배열 미포함 → pass: false", async () => {
    const r = await exec({ action: "contains", value: "[1,2,3]", expected: "5" }) as Record<string, unknown>;
    expect(r.pass).toBe(false);
  });
});

describe("AssertTool — matches", () => {
  it("정규식 매칭 → pass: true", async () => {
    const r = await exec({ action: "matches", value: '"abc123"', expected: "^[a-z]+\\d+$" }) as Record<string, unknown>;
    expect(r.pass).toBe(true);
  });

  it("정규식 불일치 → pass: false", async () => {
    const r = await exec({ action: "matches", value: '"abc"', expected: "^\\d+$" }) as Record<string, unknown>;
    expect(r.pass).toBe(false);
  });

  it("잘못된 정규식 → pass: false", async () => {
    const r = await exec({ action: "matches", value: '"abc"', expected: "[invalid" }) as Record<string, unknown>;
    expect(r.pass).toBe(false);
  });
});

describe("AssertTool — range", () => {
  it("범위 내 값 → pass: true", async () => {
    const r = await exec({ action: "range", value: "50", min: 0, max: 100 }) as Record<string, unknown>;
    expect(r.pass).toBe(true);
  });

  it("범위 초과 → pass: false", async () => {
    const r = await exec({ action: "range", value: "150", min: 0, max: 100 }) as Record<string, unknown>;
    expect(r.pass).toBe(false);
  });

  it("경계값 → pass: true", async () => {
    const r = await exec({ action: "range", value: "0", min: 0, max: 100 }) as Record<string, unknown>;
    expect(r.pass).toBe(true);
  });

  it("비숫자 값 → pass: false", async () => {
    const r = await exec({ action: "range", value: '"abc"', min: 0, max: 100 }) as Record<string, unknown>;
    expect(r.pass).toBe(false);
  });
});

describe("AssertTool — length", () => {
  it("문자열 길이 범위 내 → pass: true", async () => {
    const r = await exec({ action: "length", value: '"hello"', min: 3, max: 10 }) as Record<string, unknown>;
    expect(r.pass).toBe(true);
  });

  it("문자열 길이 초과 → pass: false", async () => {
    const r = await exec({ action: "length", value: '"toolong"', min: 1, max: 5 }) as Record<string, unknown>;
    expect(r.pass).toBe(false);
  });

  it("배열 길이 → pass: true", async () => {
    const r = await exec({ action: "length", value: "[1,2,3]", min: 2, max: 5 }) as Record<string, unknown>;
    expect(r.pass).toBe(true);
  });
});

describe("AssertTool — schema", () => {
  it("스키마 타입 일치 → pass: true", async () => {
    const r = await exec({ action: "schema", value: '{"name":"Alice"}', expected: JSON.stringify({ type: "object" }) }) as Record<string, unknown>;
    expect(r.pass).toBe(true);
  });

  it("required 필드 포함 → pass: true", async () => {
    const schema = JSON.stringify({ type: "object", required: ["name"] });
    const r = await exec({ action: "schema", value: '{"name":"Alice"}', expected: schema }) as Record<string, unknown>;
    expect(r.pass).toBe(true);
  });

  it("required 필드 누락 → pass: false", async () => {
    const schema = JSON.stringify({ type: "object", required: ["name"] });
    const r = await exec({ action: "schema", value: '{"age":30}', expected: schema }) as Record<string, unknown>;
    expect(r.pass).toBe(false);
  });

  it("잘못된 schema JSON → pass: false", async () => {
    const r = await exec({ action: "schema", value: '{"a":1}', expected: "bad-json" }) as Record<string, unknown>;
    expect(r.pass).toBe(false);
  });
});

describe("AssertTool — 에러 처리", () => {
  it("미지원 action → Error", async () => {
    expect(String(await exec({ action: "unknown_action", value: "test" }))).toContain("Error");
  });
});

// ══════════════════════════════════════════
// 미커버 분기 보충
// ══════════════════════════════════════════

describe("AssertTool — 미커버 분기", () => {
  it("schema: type 없는 스키마 → validate_type L114 → pass: true", async () => {
    // schema without 'type' → !type is true → return true
    const r = await exec({ action: "schema", value: '"hello"', expected: "{}" }) as Record<string, unknown>;
    expect(r.pass).toBe(true);
  });
});
