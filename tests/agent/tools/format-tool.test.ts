/**
 * FormatTool — 숫자/바이트/통화/시간 포매팅 테스트.
 */
import { describe, it, expect } from "vitest";
import { FormatTool } from "../../../src/agent/tools/format.js";

const tool = new FormatTool();

async function exec(params: Record<string, unknown>): Promise<string> {
  return String(await tool.execute(params));
}

describe("FormatTool — number", () => {
  it("천단위 구분자 포맷", async () => {
    const r = await exec({ operation: "number", value: "1234567" });
    expect(r).toContain("1,234,567");
  });

  it("소수점 포맷", async () => {
    const r = await exec({ operation: "number", value: "3.14159", decimals: 2 });
    expect(r).toBe("3.14");
  });

  it("잘못된 숫자 → Error", async () => {
    expect(await exec({ operation: "number", value: "abc" })).toContain("Error");
  });
});

describe("FormatTool — currency", () => {
  it("USD 통화 포맷", async () => {
    const r = await exec({ operation: "currency", value: "1234.5", locale: "en-US", currency: "USD" });
    expect(r).toContain("1,234.50");
  });
});

describe("FormatTool — percent", () => {
  it("0.75 → 75%", async () => {
    const r = await exec({ operation: "percent", value: "0.75", locale: "en-US", decimals: 0 });
    expect(r).toBe("75%");
  });
});

describe("FormatTool — bytes", () => {
  it("0 → 0 B", async () => {
    expect(await exec({ operation: "bytes", value: "0" })).toBe("0 B");
  });

  it("1024 → 1 KB", async () => {
    expect(await exec({ operation: "bytes", value: "1024" })).toBe("1 KB");
  });

  it("1048576 → 1 MB", async () => {
    expect(await exec({ operation: "bytes", value: "1048576" })).toBe("1 MB");
  });

  it("1073741824 → 1 GB", async () => {
    expect(await exec({ operation: "bytes", value: "1073741824" })).toBe("1 GB");
  });

  it("음수 → Error", async () => {
    expect(await exec({ operation: "bytes", value: "-1" })).toContain("Error");
  });
});

describe("FormatTool — mask", () => {
  it("email 마스킹", async () => {
    const r = await exec({ operation: "mask", value: "user@example.com", mask_type: "email" });
    expect(r).toContain("@example.com");
    expect(r[0]).toBe("u");
    expect(r).toContain("*");
  });

  it("phone 마스킹 — 마지막 4자리 노출", async () => {
    const r = await exec({ operation: "mask", value: "010-1234-5678", mask_type: "phone" });
    expect(r).toContain("5678");
    expect(r).toContain("*");
    expect(r).not.toContain("1234-");
  });

  it("card 마스킹", async () => {
    const r = await exec({ operation: "mask", value: "1234567890123456", mask_type: "card" });
    expect(r).toContain("3456");
    expect(r).toContain("*");
  });

  it("custom 마스킹 — 첫/끝 1자리 노출", async () => {
    const r = await exec({ operation: "mask", value: "secret", mask_type: "custom" });
    expect(r[0]).toBe("s");
    expect(r[r.length - 1]).toBe("t");
  });
});

describe("FormatTool — ordinal", () => {
  it("1st", async () => { expect(await exec({ operation: "ordinal", value: "1" })).toBe("1st"); });
  it("2nd", async () => { expect(await exec({ operation: "ordinal", value: "2" })).toBe("2nd"); });
  it("3rd", async () => { expect(await exec({ operation: "ordinal", value: "3" })).toBe("3rd"); });
  it("4th", async () => { expect(await exec({ operation: "ordinal", value: "4" })).toBe("4th"); });
  it("11th (teen exception)", async () => { expect(await exec({ operation: "ordinal", value: "11" })).toBe("11th"); });
  it("21st", async () => { expect(await exec({ operation: "ordinal", value: "21" })).toBe("21st"); });
});

describe("FormatTool — plural", () => {
  it("단수", async () => {
    expect(await exec({ operation: "plural", value: "1", word: "item" })).toBe("1 item");
  });

  it("복수 (자동 s 추가)", async () => {
    expect(await exec({ operation: "plural", value: "5", word: "item" })).toBe("5 items");
  });

  it("복수 (custom 복수형)", async () => {
    expect(await exec({ operation: "plural", value: "3", word: "person", plural_word: "people" })).toBe("3 people");
  });

  it("word 없음 → Error", async () => {
    expect(await exec({ operation: "plural", value: "2", word: "" })).toContain("Error");
  });
});

describe("FormatTool — duration", () => {
  it("0 ms → 0s", async () => {
    expect(await exec({ operation: "duration", value: "0" })).toBe("0s");
  });

  it("3600000 ms → 1h", async () => {
    expect(await exec({ operation: "duration", value: "3600000" })).toBe("1h");
  });

  it("86400000 ms → 1d", async () => {
    expect(await exec({ operation: "duration", value: "86400000" })).toBe("1d");
  });

  it("61000 ms → 1m 1s", async () => {
    const r = await exec({ operation: "duration", value: "61000" });
    expect(r).toContain("1m");
    expect(r).toContain("1s");
  });
});

describe("FormatTool — pad", () => {
  it("right align (default)", async () => {
    const r = await exec({ operation: "pad", value: "hi", width: 5, fill: "0", align: "right" });
    expect(r).toBe("000hi");
  });

  it("left align", async () => {
    const r = await exec({ operation: "pad", value: "hi", width: 5, fill: " ", align: "left" });
    expect(r).toBe("hi   ");
  });

  it("center align 짝수 패딩 → 양쪽 균등", async () => {
    const r = await exec({ operation: "pad", value: "hi", width: 6, fill: " ", align: "center" });
    expect(r).toBe("  hi  ");
  });

  it("center align 홀수 패딩 → 왼쪽 +1", async () => {
    const r = await exec({ operation: "pad", value: "hi", width: 7, fill: "-", align: "center" });
    expect(r).toContain("hi");
    expect(r.length).toBe(7);
  });
});

describe("FormatTool — truncate", () => {
  it("길이 이내 → 그대로", async () => {
    expect(await exec({ operation: "truncate", value: "hello", max_length: 10 })).toBe("hello");
  });

  it("길이 초과 → 잘림 + suffix", async () => {
    const r = await exec({ operation: "truncate", value: "Hello World", max_length: 8 });
    expect(r).toBe("Hello...");
    expect(r.length).toBe(8);
  });
});

// ══════════════════════════════════════════
// relative_time — ms 숫자 입력 + 범위 분기
// ══════════════════════════════════════════

describe("FormatTool — relative_time ms 입력", () => {
  it("ms 숫자 입력 (1시간 전) → 'h ago'", async () => {
    const one_hour_ago_ms = Date.now() - 3_600_000;
    const r = await exec({ operation: "relative_time", value: String(one_hour_ago_ms) });
    expect(r).toContain("h");
    expect(r).toContain("ago");
  });

  it("잘못된 날짜 + 잘못된 숫자 → error", async () => {
    const r = await exec({ operation: "relative_time", value: "invalid-and-not-number" });
    expect(r).toContain("Error");
  });

  it("30초 전 → 's ago'", async () => {
    const thirty_sec_ago = Date.now() - 30_000;
    const r = await exec({ operation: "relative_time", value: String(thirty_sec_ago) });
    expect(r).toContain("s");
    expect(r).toContain("ago");
  });

  it("2분 전 → 'm ago'", async () => {
    const two_min_ago = Date.now() - 120_000;
    const r = await exec({ operation: "relative_time", value: String(two_min_ago) });
    expect(r).toContain("m");
    expect(r).toContain("ago");
  });

  it("5일 전 → 'd ago'", async () => {
    const five_days_ago = Date.now() - 5 * 86_400_000;
    const r = await exec({ operation: "relative_time", value: String(five_days_ago) });
    expect(r).toContain("d");
    expect(r).toContain("ago");
  });

  it("2개월 전 → 'mo ago'", async () => {
    const two_months_ago = Date.now() - 2 * 2_592_000_000;
    const r = await exec({ operation: "relative_time", value: String(two_months_ago) });
    expect(r).toContain("mo");
    expect(r).toContain("ago");
  });

  it("2년 전 → 'y ago'", async () => {
    const two_years_ago = Date.now() - 2 * 31_536_000_000;
    const r = await exec({ operation: "relative_time", value: String(two_years_ago) });
    expect(r).toContain("y");
    expect(r).toContain("ago");
  });

  it("미래 날짜 → 'from now'", async () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const r = await exec({ operation: "relative_time", value: future });
    expect(r).toContain("from now");
  });
});

// ══════════════════════════════════════════
// mask — 엣지 케이스
// ══════════════════════════════════════════

describe("FormatTool — mask 엣지 케이스", () => {
  it("email: @ 없음 → 전체 마스킹", async () => {
    const r = await exec({ operation: "mask", value: "noemail", mask_type: "email" });
    expect(r).toBe("*".repeat(7));
  });

  it("phone: 4자 미만 → 전체 마스킹", async () => {
    const r = await exec({ operation: "mask", value: "123", mask_type: "phone" });
    expect(r).toBe("***");
  });

  it("card: 4자 미만 → 전체 마스킹", async () => {
    const r = await exec({ operation: "mask", value: "123", mask_type: "card" });
    expect(r).toBe("***");
  });

  it("custom: 2자 이하 → 전체 마스킹", async () => {
    const r = await exec({ operation: "mask", value: "ab", mask_type: "custom" });
    expect(r).toBe("**");
  });
});

// ══════════════════════════════════════════
// 에러 경로
// ══════════════════════════════════════════

describe("FormatTool — 에러 경로", () => {
  it("currency 잘못된 코드 → Error 반환", async () => {
    const r = await exec({ operation: "currency", value: "100", currency: "FAKE_CURR_9999", locale: "en-US" });
    expect(r).toContain("Error");
  });

  it("bytes NaN → Error", async () => {
    const r = await exec({ operation: "bytes", value: "not-a-number" });
    expect(r).toContain("Error");
  });

  it("ordinal NaN → Error", async () => {
    const r = await exec({ operation: "ordinal", value: "abc" });
    expect(r).toContain("Error");
  });

  it("duration NaN → Error", async () => {
    const r = await exec({ operation: "duration", value: "abc" });
    expect(r).toContain("Error");
  });

  it("number NaN → Error", async () => {
    const r = await exec({ operation: "number", value: "not-a-number" });
    expect(r).toContain("Error");
  });

  it("percent NaN → Error", async () => {
    const r = await exec({ operation: "percent", value: "not-a-number" });
    expect(r).toContain("Error");
  });
});

// ══════════════════════════════════════════
// unsupported operation
// ══════════════════════════════════════════

describe("FormatTool — unsupported operation", () => {
  it("알 수 없는 operation → Error 반환", async () => {
    const r = await exec({ operation: "foobar", value: "42" });
    expect(r).toContain("Error");
    expect(r).toContain("foobar");
  });
});

// ══════════════════════════════════════════
// 잘못된 locale catch
// ══════════════════════════════════════════

describe("FormatTool — 잘못된 locale catch", () => {
  it("number: 잘못된 locale → Error", async () => {
    const r = await exec({ operation: "number", value: "42", locale: "!invalid-locale!" });
    expect(r).toContain("Error");
  });

  it("percent: 잘못된 locale → Error", async () => {
    const r = await exec({ operation: "percent", value: "0.5", locale: "!invalid-locale!" });
    expect(r).toContain("Error");
  });
});

// ══════════════════════════════════════════
// currency: invalid number
// ══════════════════════════════════════════

describe("FormatTool — currency invalid number", () => {
  it("currency: 숫자 아닌 값 → Error", async () => {
    const r = await exec({ operation: "currency", value: "notanumber", currency: "USD" });
    expect(r).toContain("Error");
    expect(r).toContain("invalid number");
  });
});
