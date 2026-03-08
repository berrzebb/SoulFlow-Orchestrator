/**
 * CountryTool — lookup/search/by_dial_code/by_currency/by_continent/list 테스트.
 */
import { describe, it, expect } from "vitest";
import { CountryTool } from "../../../src/agent/tools/country.js";

const tool = new CountryTool();

async function exec(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  return JSON.parse(await tool.execute(params));
}

describe("CountryTool — lookup", () => {
  it("ISO2 코드로 조회 (US)", async () => {
    const r = await exec({ action: "lookup", code: "US" });
    expect(r.name).toBe("United States");
    expect(r.dial).toBe("+1");
    expect(r.currency).toBe("USD");
  });

  it("ISO2 소문자도 허용 (kr)", async () => {
    const r = await exec({ action: "lookup", code: "kr" });
    expect(r.code).toBe("KR");
    expect(r.capital).toBe("Seoul");
  });

  it("ISO3 코드로 조회 (JPN)", async () => {
    const r = await exec({ action: "lookup", code: "JPN" });
    expect(r.code).toBe("JP");
  });

  it("존재하지 않는 코드 → error 반환", async () => {
    const r = await exec({ action: "lookup", code: "ZZ" });
    expect(r.error).toBeDefined();
  });

  it("code 없음 → error 반환", async () => {
    const r = await exec({ action: "lookup" });
    expect(r.error).toBeDefined();
  });
});

describe("CountryTool — search", () => {
  it("이름 부분 매치 (Korea)", async () => {
    const r = await exec({ action: "search", query: "Korea" });
    const results = r.results as { code: string }[];
    expect(Array.isArray(results)).toBe(true);
    expect(results.some((c) => c.code === "KR")).toBe(true);
  });

  it("대소문자 무관 (japan)", async () => {
    const r = await exec({ action: "search", query: "japan" });
    const results = r.results as { code: string }[];
    expect(results.some((c) => c.code === "JP")).toBe(true);
  });

  it("결과 없음 → 빈 배열", async () => {
    const r = await exec({ action: "search", query: "xyznotexist" });
    expect((r.results as unknown[]).length).toBe(0);
  });

  it("query 없음 → 전체 반환 (빈 쿼리는 모두 매치)", async () => {
    const r = await exec({ action: "search" });
    // 빈 쿼리는 모든 국가와 매치됨
    expect((r.results as unknown[]).length).toBeGreaterThan(0);
  });
});

describe("CountryTool — by_dial_code", () => {
  it("+82 → 한국", async () => {
    const r = await exec({ action: "by_dial_code", dial_code: "+82" });
    const results = r.results as { code: string }[];
    expect(results.some((c) => c.code === "KR")).toBe(true);
  });

  it("숫자만 (82) → 처리됨", async () => {
    const r = await exec({ action: "by_dial_code", dial_code: "82" });
    // +82와 매치 여부 (구현에 따라 다름)
    expect(r.results).toBeDefined();
  });

  it("존재하지 않는 코드 → 빈 배열", async () => {
    const r = await exec({ action: "by_dial_code", dial_code: "+000" });
    expect((r.results as unknown[]).length).toBe(0);
  });
});

describe("CountryTool — by_currency", () => {
  it("USD → 미국 포함", async () => {
    const r = await exec({ action: "by_currency", currency: "USD" });
    const results = r.results as { code: string }[];
    expect(results.some((c) => c.code === "US")).toBe(true);
  });

  it("EUR → 여러 나라 반환", async () => {
    const r = await exec({ action: "by_currency", currency: "EUR" });
    const results = r.results as { code: string }[];
    expect(results.length).toBeGreaterThan(3);
  });

  it("소문자도 허용 (usd)", async () => {
    const r = await exec({ action: "by_currency", currency: "usd" });
    const results = r.results as { code: string }[];
    expect(results.some((c) => c.code === "US")).toBe(true);
  });

  it("존재하지 않는 통화 → 빈 배열", async () => {
    const r = await exec({ action: "by_currency", currency: "XYZ" });
    expect((r.results as unknown[]).length).toBe(0);
  });
});

describe("CountryTool — by_continent", () => {
  it("Asia → 아시아 국가들 반환", async () => {
    const r = await exec({ action: "by_continent", continent: "Asia" });
    const results = r.results as { code: string }[];
    expect(results.length).toBeGreaterThan(5);
    expect(results.some((c) => c.code === "KR")).toBe(true);
    expect(results.some((c) => c.code === "JP")).toBe(true);
  });

  it("Europe → 유럽 국가들 반환", async () => {
    const r = await exec({ action: "by_continent", continent: "Europe" });
    const results = r.results as { code: string }[];
    expect(results.some((c) => c.code === "DE")).toBe(true);
  });

  it("대소문자 무관 (asia)", async () => {
    const r = await exec({ action: "by_continent", continent: "asia" });
    expect((r.results as unknown[]).length).toBeGreaterThan(0);
  });
});

describe("CountryTool — list", () => {
  it("전체 국가 목록 반환", async () => {
    const r = await exec({ action: "list" });
    const results = r.countries as unknown[];
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(30);
    // count 필드 포함 확인
    expect(Number(r.count)).toBeGreaterThan(0);
  });
});

describe("CountryTool — unknown action", () => {
  it("알 수 없는 action → error", async () => {
    const r = await exec({ action: "unknown_op" });
    expect(r.error).toBeDefined();
  });
});
