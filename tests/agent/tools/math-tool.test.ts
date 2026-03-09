/**
 * MathTool — eval/convert/compound_interest/loan_payment/roi/percentage/round/gcd/lcm/factorial/fibonacci 테스트.
 */
import { describe, it, expect } from "vitest";
import { MathTool } from "../../../src/agent/tools/math.js";

const tool = new MathTool();

async function exec(params: Record<string, unknown>): Promise<unknown> {
  const result = await tool.execute(params);
  try { return JSON.parse(String(result)); } catch { return result; }
}

describe("MathTool — eval", () => {
  it("기본 산술 표현식 계산", async () => {
    const r = await exec({ operation: "eval", expression: "1 + 2 * 3" });
    expect(Number(r)).toBe(7);
  });

  it("Math 함수 사용", async () => {
    const r = await exec({ operation: "eval", expression: "Math.sqrt(16)" });
    expect(Number(r)).toBe(4);
  });

  it("빈 표현식 → Error", async () => {
    const r = await exec({ operation: "eval", expression: "" });
    expect(String(r)).toContain("Error");
  });

  it("식별자 포함 → Error", async () => {
    const r = await exec({ operation: "eval", expression: "require('fs')" });
    expect(String(r)).toContain("Error");
  });
});

describe("MathTool — convert", () => {
  it("m → cm 변환", async () => {
    const r = await exec({ operation: "convert", value: 1, from: "m", to: "cm" });
    expect(Number(r)).toBeCloseTo(100);
  });

  it("km → m 변환", async () => {
    const r = await exec({ operation: "convert", value: 1, from: "km", to: "m" });
    expect(Number(r)).toBe(1000);
  });

  it("온도 변환 C → F", async () => {
    const r = await exec({ operation: "convert", value: 0, from: "c", to: "f" });
    expect(Number(r)).toBeCloseTo(32);
  });

  it("온도 변환 C → K", async () => {
    const r = await exec({ operation: "convert", value: 0, from: "c", to: "k" });
    expect(Number(r)).toBeCloseTo(273.15);
  });

  it("같은 단위 → 값 그대로", async () => {
    const r = await exec({ operation: "convert", value: 42, from: "m", to: "m" });
    expect(Number(r)).toBe(42);
  });

  it("지원되지 않는 단위 → Error", async () => {
    const r = await exec({ operation: "convert", value: 1, from: "parsec", to: "m" });
    expect(String(r)).toContain("Error");
  });
});

describe("MathTool — compound_interest", () => {
  it("복리 계산 기본", async () => {
    const r = await exec({ operation: "compound_interest", principal: 1000, rate: 0.05, periods: 10 }) as Record<string, unknown>;
    expect(r.amount).toBeGreaterThan(1000);
    expect(r.interest).toBeGreaterThan(0);
    expect(Number(r.amount)).toBeCloseTo(1628.89, 0);
  });

  it("이자율 0 → 원금 그대로", async () => {
    const r = await exec({ operation: "compound_interest", principal: 1000, rate: 0, periods: 10 }) as Record<string, unknown>;
    expect(Number(r.amount)).toBe(1000);
    expect(Number(r.interest)).toBe(0);
  });
});

describe("MathTool — loan_payment", () => {
  it("월 상환금 계산", async () => {
    const r = await exec({ operation: "loan_payment", principal: 10000, rate: 0.05, periods: 12 }) as Record<string, unknown>;
    expect(Number(r.payment)).toBeGreaterThan(0);
    expect(Number(r.total)).toBeGreaterThan(10000);
  });

  it("이자율 0 → 원금/기간", async () => {
    const r = await exec({ operation: "loan_payment", principal: 1200, rate: 0, periods: 12 }) as Record<string, unknown>;
    expect(Number(r.payment)).toBeCloseTo(100);
    expect(Number(r.interest)).toBe(0);
  });
});

describe("MathTool — roi", () => {
  it("ROI 계산", async () => {
    const r = await exec({ operation: "roi", cost: 1000, gain: 1500 }) as Record<string, unknown>;
    expect(Number(r.roi_percent)).toBeCloseTo(50);
    expect(Number(r.net_profit)).toBe(500);
  });

  it("cost=0 → Error", async () => {
    const r = await exec({ operation: "roi", cost: 0, gain: 100 });
    expect(String(r)).toContain("Error");
  });
});

describe("MathTool — percentage", () => {
  it("50 / 200 = 25%", async () => {
    const r = await exec({ operation: "percentage", value: 50, a: 200 });
    expect(Number(r)).toBeCloseTo(25);
  });

  it("base=0 → Error", async () => {
    const r = await exec({ operation: "percentage", value: 10, a: 0 });
    expect(String(r)).toContain("Error");
  });
});

describe("MathTool — round", () => {
  it("소수점 2자리 반올림", async () => {
    const r = await exec({ operation: "round", value: 3.14159, decimals: 2 });
    expect(Number(r)).toBe(3.14);
  });

  it("정수 반올림 (decimals=0)", async () => {
    const r = await exec({ operation: "round", value: 3.7, decimals: 0 });
    expect(Number(r)).toBe(4);
  });
});

describe("MathTool — gcd / lcm", () => {
  it("gcd(12, 8) = 4", async () => {
    const r = await exec({ operation: "gcd", a: 12, b: 8 });
    expect(Number(r)).toBe(4);
  });

  it("lcm(4, 6) = 12", async () => {
    const r = await exec({ operation: "lcm", a: 4, b: 6 });
    expect(Number(r)).toBe(12);
  });

  it("gcd(0, 5) = 5", async () => {
    const r = await exec({ operation: "gcd", a: 0, b: 5 });
    expect(Number(r)).toBe(5);
  });
});

describe("MathTool — factorial", () => {
  it("5! = 120", async () => {
    const r = await exec({ operation: "factorial", n: 5 });
    expect(Number(r)).toBe(120);
  });

  it("0! = 1", async () => {
    const r = await exec({ operation: "factorial", n: 0 });
    expect(Number(r)).toBe(1);
  });

  it("음수 → Error", async () => {
    const r = await exec({ operation: "factorial", n: -1 });
    expect(String(r)).toContain("Error");
  });

  it("171 → 너무 큰 값 Error", async () => {
    const r = await exec({ operation: "factorial", n: 171 });
    expect(String(r)).toContain("Error");
  });
});

describe("MathTool — fibonacci", () => {
  it("fib(10) = 55", async () => {
    const r = await exec({ operation: "fibonacci", n: 10 });
    expect(String(r)).toBe("55");
  });

  it("fib(0) = 0", async () => {
    const r = await exec({ operation: "fibonacci", n: 0 });
    expect(String(r)).toBe("0");
  });

  it("fib(1) = 1", async () => {
    const r = await exec({ operation: "fibonacci", n: 1 });
    expect(String(r)).toBe("1");
  });

  it("음수 → Error", async () => {
    const r = await exec({ operation: "fibonacci", n: -1 });
    expect(String(r)).toContain("Error");
  });

  it("n>1000 → Error", async () => {
    const r = await exec({ operation: "fibonacci", n: 1001 });
    expect(String(r)).toContain("Error");
  });
});

// L58: default case — 미지원 operation
describe("MathTool — 미지원 operation (L58)", () => {
  it("unknown operation → Error: unsupported operation (L58)", async () => {
    const r = await exec({ operation: "unknown_op" });
    expect(String(r)).toContain("unsupported operation");
  });
});

// L73: safe_eval catch — SyntaxError (잘못된 표현식)
describe("MathTool — safe_eval catch (L73)", () => {
  it("구문 에러 표현식 → Error 반환 (L73)", async () => {
    // '1 + +' — SyntaxError when new Function is created
    const r = await exec({ operation: "eval", expression: "1 + +" });
    expect(String(r)).toContain("Error");
  });
});
