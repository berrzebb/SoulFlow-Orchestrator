/**
 * CurrencyTool — 통화 정보/포맷/변환/목록/비교/파싱 테스트.
 */
import { describe, it, expect } from "vitest";
import { CurrencyTool } from "../../../src/agent/tools/currency.js";

const tool = new CurrencyTool();

async function exec(params: Record<string, unknown>): Promise<unknown> {
  const result = await tool.execute(params);
  try { return JSON.parse(String(result)); } catch { return result; }
}

describe("CurrencyTool — info", () => {
  it("USD 정보 조회", async () => {
    const r = await exec({ action: "info", code: "USD" }) as Record<string, unknown>;
    expect(r.code).toBe("USD");
    expect(r.symbol).toBe("$");
    expect(r.decimals).toBe(2);
    expect(r.rate_to_usd).toBe(1);
  });

  it("KRW 정보 조회 (소수점 0자리)", async () => {
    const r = await exec({ action: "info", code: "KRW" }) as Record<string, unknown>;
    expect(r.code).toBe("KRW");
    expect(r.decimals).toBe(0);
  });

  it("알 수 없는 통화 → error", async () => {
    const r = await exec({ action: "info", code: "XYZ" }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
  });

  it("소문자 코드도 동작", async () => {
    const r = await exec({ action: "info", code: "eur" }) as Record<string, unknown>;
    expect(r.code).toBe("EUR");
  });
});

describe("CurrencyTool — format", () => {
  it("USD 포맷 (1234.56 → $1,234.56)", async () => {
    const r = await exec({ action: "format", code: "USD", amount: 1234.56 }) as Record<string, unknown>;
    expect(String(r.formatted)).toContain("1,234");
    expect(String(r.formatted)).toContain("$");
  });

  it("JPY 포맷 (소수점 없음)", async () => {
    const r = await exec({ action: "format", code: "JPY", amount: 1500 }) as Record<string, unknown>;
    expect(String(r.formatted)).not.toContain(".");
  });

  it("알 수 없는 통화 → error", async () => {
    const r = await exec({ action: "format", code: "ABC", amount: 100 }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
  });
});

describe("CurrencyTool — convert", () => {
  it("USD → KRW 변환", async () => {
    const r = await exec({ action: "convert", from: "USD", to: "KRW", amount: 1 }) as Record<string, unknown>;
    expect(r.from).toBe("USD");
    expect(r.to).toBe("KRW");
    expect(Number(r.result)).toBeGreaterThan(1000); // 1 USD = 1000+ KRW
    expect(String(r.note)).toContain("static");
  });

  it("EUR → USD 변환", async () => {
    const r = await exec({ action: "convert", from: "EUR", to: "USD", amount: 1 }) as Record<string, unknown>;
    expect(Number(r.result)).toBeGreaterThan(1); // EUR > USD
  });

  it("같은 통화 → amount 그대로", async () => {
    const r = await exec({ action: "convert", from: "USD", to: "USD", amount: 100 }) as Record<string, unknown>;
    expect(r.result).toBe(100);
  });

  it("알 수 없는 통화 → error", async () => {
    const r = await exec({ action: "convert", from: "XYZ", to: "USD", amount: 1 }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
  });
});

describe("CurrencyTool — list", () => {
  it("전체 통화 목록 반환", async () => {
    const r = await exec({ action: "list" }) as Record<string, unknown>;
    expect(Number(r.count)).toBeGreaterThan(30);
    const currencies = r.currencies as { code: string }[];
    expect(currencies.some((c) => c.code === "USD")).toBe(true);
    expect(currencies.some((c) => c.code === "KRW")).toBe(true);
    expect(currencies.some((c) => c.code === "BTC")).toBe(true);
  });
});

describe("CurrencyTool — compare", () => {
  it("USD vs EUR 환율 비교", async () => {
    const r = await exec({ action: "compare", from: "USD", to: "EUR" }) as Record<string, unknown>;
    expect(r.from).toBe("USD");
    expect(r.to).toBe("EUR");
    expect(Number(r.rate)).toBeGreaterThan(0);
    expect(Number(r.inverse)).toBeGreaterThan(0);
    // rate * inverse ≈ 1
    expect(Number(r.rate) * Number(r.inverse)).toBeCloseTo(1, 2);
  });

  it("알 수 없는 통화 → error", async () => {
    const r = await exec({ action: "compare", from: "XXX", to: "USD" }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
  });
});

describe("CurrencyTool — parse", () => {
  it("텍스트에서 USD 금액 파싱", async () => {
    const r = await exec({ action: "parse", text: "Price is USD 1,234.56" }) as Record<string, unknown>;
    const found = r.found as { currency: string; amount: number }[];
    expect(found.length).toBeGreaterThan(0);
    expect(found.some((f) => f.currency === "USD")).toBe(true);
  });

  it("심볼로 파싱 ($100)", async () => {
    const r = await exec({ action: "parse", text: "Pay $100 now" }) as Record<string, unknown>;
    const found = r.found as { symbol?: string; amount: number }[];
    expect(found.some((f) => f.amount === 100)).toBe(true);
  });

  it("빈 텍스트 → 빈 배열", async () => {
    const r = await exec({ action: "parse", text: "no money here" }) as Record<string, unknown>;
    expect((r.found as unknown[]).length).toBe(0);
  });
});

describe("CurrencyTool — 에러 처리", () => {
  it("미지원 action → error", async () => {
    const r = await exec({ action: "unknown" }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
  });
});
