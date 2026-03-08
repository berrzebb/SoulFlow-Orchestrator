/**
 * PhoneTool — 전화번호 파싱/검증/포맷팅 테스트.
 */
import { describe, it, expect } from "vitest";
import { PhoneTool } from "../../../src/agent/tools/phone.js";

const tool = new PhoneTool();

async function exec(params: Record<string, unknown>): Promise<unknown> {
  const result = await tool.execute(params);
  try { return JSON.parse(String(result)); } catch { return result; }
}

describe("PhoneTool — parse", () => {
  it("국가코드 포함 번호 파싱", async () => {
    const r = await exec({ action: "parse", number: "+821012345678" }) as Record<string, unknown>;
    expect(r.country_code).toBe("KR");
    expect(r.dial_code).toBe("+82");
    expect(String(r.digits)).toContain("1012345678");
  });

  it("국가 hint와 함께 파싱 (KR)", async () => {
    const r = await exec({ action: "parse", number: "010-1234-5678", country: "KR" }) as Record<string, unknown>;
    expect(r.country_code).toBe("KR");
  });

  it("US 번호 파싱", async () => {
    const r = await exec({ action: "parse", number: "+12125551234" }) as Record<string, unknown>;
    expect(r.country_code).toBe("US");
  });
});

describe("PhoneTool — validate", () => {
  it("유효한 KR 번호 → valid: true", async () => {
    const r = await exec({ action: "validate", number: "+821012345678" }) as Record<string, unknown>;
    expect(r.valid).toBe(true);
  });

  it("잘못된 번호 → valid: false", async () => {
    const r = await exec({ action: "validate", number: "123" }) as Record<string, unknown>;
    expect(r.valid).toBe(false);
  });
});

describe("PhoneTool — format", () => {
  it("e164 포맷", async () => {
    const r = await exec({ action: "format", number: "+12125551234", format_type: "e164" }) as Record<string, unknown>;
    const fmt = String(r.formatted);
    expect(fmt).toContain("+1");
  });

  it("international 포맷", async () => {
    const r = await exec({ action: "format", number: "+12125551234", format_type: "international" }) as Record<string, unknown>;
    expect(String(r.formatted)).toContain("+1");
  });

  it("national 포맷 (US)", async () => {
    const r = await exec({ action: "format", number: "+12125551234", format_type: "national" }) as Record<string, unknown>;
    const fmt = String(r.formatted);
    // (212) 555-1234 형태
    expect(fmt).toContain("212");
  });
});

describe("PhoneTool — normalize", () => {
  it("모든 특수문자 제거 + e164", async () => {
    const r = await exec({ action: "normalize", number: "+1 (212) 555-1234" }) as Record<string, unknown>;
    expect(String(r.normalized)).toBe("12125551234");
    expect(String(r.e164)).toBe("+12125551234");
  });
});

describe("PhoneTool — country_info", () => {
  it("KR 국가 정보", async () => {
    const r = await exec({ action: "country_info", country: "KR" }) as Record<string, unknown>;
    expect(r.code).toBe("+82");
    expect(r.country).toBe("KR");
  });

  it("알 수 없는 국가 → error", async () => {
    const r = await exec({ action: "country_info", country: "XX" }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
    expect(Array.isArray(r.supported)).toBe(true);
  });
});

describe("PhoneTool — compare", () => {
  it("동일 번호 → match: true", async () => {
    const r = await exec({ action: "compare", number: "+12125551234", number2: "+12125551234" }) as Record<string, unknown>;
    expect(r.match).toBe(true);
  });

  it("다른 번호 → match: false", async () => {
    const r = await exec({ action: "compare", number: "+12125551234", number2: "+12125559999" }) as Record<string, unknown>;
    expect(r.match).toBe(false);
  });
});
