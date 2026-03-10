/**
 * EvalTool — format_result 분기, 코드 길이 초과, context 파싱 케이스 추가 커버리지.
 */
import { describe, it, expect } from "vitest";
import { EvalTool } from "@src/agent/tools/eval.js";

const tool = new EvalTool();

async function exec(params: Record<string, unknown>): Promise<string> {
  return String(await tool.execute(params));
}

// ══════════════════════════════════════════
// 기본 기능
// ══════════════════════════════════════════

describe("EvalTool — 기본 기능", () => {
  it("빈 코드 → Error: empty code", async () => {
    expect(await exec({ code: "   " })).toContain("Error: empty code");
  });

  it("코드 길이 초과 (10001자) → Error: code exceeds", async () => {
    const r = await exec({ code: "a".repeat(10001) });
    expect(r).toContain("Error: code exceeds");
  });

  it("숫자 반환 → 문자열 변환", async () => {
    expect(await exec({ code: "return 42" })).toBe("42");
  });

  it("문자열 반환 → 그대로 반환", async () => {
    expect(await exec({ code: "return 'hello'" })).toBe("hello");
  });

  it("boolean 반환", async () => {
    expect(await exec({ code: "return true" })).toBe("true");
  });
});

// ══════════════════════════════════════════
// format_result 분기
// ══════════════════════════════════════════

describe("EvalTool — format_result 분기", () => {
  it("undefined 반환 → 'undefined'", async () => {
    expect(await exec({ code: "return undefined" })).toBe("undefined");
  });

  it("null 반환 → 'null'", async () => {
    expect(await exec({ code: "return null" })).toBe("null");
  });

  it("객체 반환 → JSON 직렬화", async () => {
    const r = await exec({ code: "return { x: 1, y: 2 }" });
    const parsed = JSON.parse(r);
    expect(parsed).toEqual({ x: 1, y: 2 });
  });

  it("배열 반환 → JSON 직렬화", async () => {
    const r = await exec({ code: "return [1, 2, 3]" });
    expect(JSON.parse(r)).toEqual([1, 2, 3]);
  });
});

// ══════════════════════════════════════════
// context 파싱
// ══════════════════════════════════════════

describe("EvalTool — context 파싱", () => {
  it("JSON context 주입 → 변수 접근", async () => {
    const r = await exec({ code: "return x + y", context: JSON.stringify({ x: 10, y: 5 }) });
    expect(r).toBe("15");
  });

  it("잘못된 context JSON → Error: invalid context JSON", async () => {
    const r = await exec({ code: "return 1", context: "invalid json" });
    expect(r).toContain("Error: invalid context JSON");
  });

  it("context가 배열 → 무시됨 (빈 context로 처리)", async () => {
    // 배열은 object이지만 Array.isArray → context = {} 그대로
    const r = await exec({ code: "return 1", context: "[1, 2, 3]" });
    expect(r).toBe("1");
  });

  it("context가 객체 (이미 파싱됨) → 정상 동작", async () => {
    const r = await exec({ code: "return n * 2", context: { n: 7 } });
    expect(r).toBe("14");
  });
});

// ══════════════════════════════════════════
// 에러 처리
// ══════════════════════════════════════════

describe("EvalTool — 코드 실행 에러", () => {
  it("ReferenceError → Error: 메시지 포함", async () => {
    const r = await exec({ code: "return undefinedVar" });
    expect(r).toContain("Error");
  });

  it("SyntaxError → Error: 메시지 포함", async () => {
    const r = await exec({ code: "}{" });
    expect(r).toContain("Error");
  });

  it("throw string → Error: string 포함", async () => {
    const r = await exec({ code: "throw 'custom error'" });
    expect(r).toContain("Error");
  });
});

// ══════════════════════════════════════════
// 미커버 분기 보충
// ══════════════════════════════════════════

describe("EvalTool — format_result 미커버 분기 (L56)", () => {
  it("순환 참조 객체 → JSON.stringify throw → catch → String(result) (L56)", async () => {
    // obj.self = obj → JSON.stringify(obj) throws TypeError: Converting circular structure to JSON
    const r = await exec({ code: "const obj = {}; obj.self = obj; return obj;" });
    // catch branch fires → String(obj) = "[object Object]"
    expect(r).toContain("[object Object]");
  });
});
