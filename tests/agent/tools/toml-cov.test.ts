/**
 * TomlTool — 미커버 분기 보충.
 * L107: 중첩 [[parent.child]] array table
 * L136: [a, b] — JSON parse 실패 시 raw 반환
 * L141: plain 문자열 값 (숫자/bool/date/[] 아님)
 * L170: value_to_toml — null/object → JSON.stringify
 */
import { describe, it, expect } from "vitest";
import { TomlTool } from "@src/agent/tools/toml.js";

const tool = new TomlTool();

async function run(params: Record<string, unknown>): Promise<unknown> {
  const raw = await (tool as any).run(params);
  try { return JSON.parse(raw); } catch { return raw; }
}

// ══════════════════════════════════════════
// L107: 중첩 [[parent.child]] — target = target[parts[j]] 경로
// ══════════════════════════════════════════

describe("TomlTool — 중첩 array table [[parent.child]] (L107)", () => {
  it("[[parent.child]] → parent.child 배열에 항목 추가", async () => {
    const input = `[[parent.child]]\nname = "first"\n[[parent.child]]\nname = "second"`;
    const result = await run({ action: "parse", input }) as any;
    expect(Array.isArray(result.result.parent.child)).toBe(true);
    expect(result.result.parent.child).toHaveLength(2);
    expect(result.result.parent.child[0].name).toBe("first");
  });
});

// ══════════════════════════════════════════
// L136: parse_value — '[' 시작 + JSON 파싱 실패 → raw 반환
// ══════════════════════════════════════════

describe("TomlTool — parse_value 배열 JSON 파싱 실패 (L136)", () => {
  it("[a, b, c] — 따옴표 없는 식별자 → JSON parse 실패, raw 반환", async () => {
    const input = `key = [a, b, c]`;
    const result = await run({ action: "parse", input }) as any;
    // parse_value에서 JSON.parse("[a, b, c]") 실패 → raw string 반환
    expect(result.result.key).toBe("[a, b, c]");
  });
});

// ══════════════════════════════════════════
// L141: parse_value — 일반 문자열 fallback (return val)
// ══════════════════════════════════════════

describe("TomlTool — parse_value plain 문자열 (L141)", () => {
  it("따옴표 없는 일반 문자열 → 그대로 반환", async () => {
    const input = `key = plain_text`;
    const result = await run({ action: "parse", input }) as any;
    expect(result.result.key).toBe("plain_text");
  });

  it("숫자처럼 보이지 않는 문자열 → 그대로 반환", async () => {
    const input = `name = hello_world`;
    const result = await run({ action: "parse", input }) as any;
    expect(result.result.name).toBe("hello_world");
  });
});

// ══════════════════════════════════════════
// L170: value_to_toml — null 값 → JSON.stringify(null) = "null"
// ══════════════════════════════════════════

describe("TomlTool — value_to_toml null 값 (L170)", () => {
  it("generate: null 값 → TOML 출력에 null 포함", async () => {
    const input = JSON.stringify({ key: null });
    const result = await run({ action: "generate", input }) as any;
    // value_to_toml(null) → JSON.stringify(null) = "null"
    expect(typeof result).toBe("string");
    expect(result).toContain("null");
  });
});

// ══════════════════════════════════════════
// default case: unsupported action (L73)
// ══════════════════════════════════════════

describe("TomlTool — default action (L73)", () => {
  it("알 수 없는 action → 에러 문자열 반환", async () => {
    const result = await run({ action: "unknown_action" }) as any;
    expect(typeof result).toBe("string");
    expect(result).toContain("unsupported action");
  });
});

