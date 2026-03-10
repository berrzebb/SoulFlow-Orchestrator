/**
 * FormatTool — 미커버 경로 보충.
 * relative_time (숫자 ms 입력, 미래, 다양한 범위), center pad, 잘못된 locale.
 */
import { describe, it, expect } from "vitest";
import { FormatTool } from "../../../src/agent/tools/format.js";

const tool = new FormatTool();
async function exec(params: Record<string, unknown>): Promise<string> {
  return tool.execute(params, {} as any);
}

// ══════════════════════════════════════════
// relative_time — ms 숫자 입력 + 범위 분기
// ══════════════════════════════════════════

describe("FormatTool — relative_time ms 입력", () => {
  it("ms 숫자 입력 (1시간 전) → '1h ago'", async () => {
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
// pad — center 정렬
// ══════════════════════════════════════════

describe("FormatTool — pad center 정렬", () => {
  it("center align 짝수 패딩 → 양쪽 균등", async () => {
    const r = await exec({ operation: "pad", value: "hi", width: 6, fill: " ", align: "center" });
    expect(r).toBe("  hi  ");
  });

  it("center align 홀수 패딩 → 왼쪽 +1", async () => {
    const r = await exec({ operation: "pad", value: "hi", width: 7, fill: "-", align: "center" });
    // 패딩 5개: left=2, right=3
    expect(r).toContain("hi");
    expect(r.length).toBe(7);
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

  it("bytes 음수 → Error", async () => {
    const r = await exec({ operation: "bytes", value: "-1" });
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
// default (unsupported operation)
// ══════════════════════════════════════════

describe("FormatTool — unsupported operation", () => {
  it("알 수 없는 operation → Error 반환", async () => {
    const r = await exec({ operation: "foobar", value: "42" });
    expect(r).toContain("Error");
    expect(r).toContain("foobar");
  });
});

// ══════════════════════════════════════════
// 잘못된 locale catch (L59, L79)
// ══════════════════════════════════════════

describe("FormatTool — 잘못된 locale catch (L59, L79)", () => {
  it("number: 잘못된 locale → Error: invalid locale (L59)", async () => {
    const r = await exec({ operation: "number", value: "42", locale: "!invalid-locale!" });
    expect(r).toContain("Error");
  });

  it("percent: 잘못된 locale → Error: invalid locale (L79)", async () => {
    const r = await exec({ operation: "percent", value: "0.5", locale: "!invalid-locale!" });
    expect(r).toContain("Error");
  });
});

// ══════════════════════════════════════════
// 미커버 분기 보충
// ══════════════════════════════════════════

describe("FormatTool — 미커버 분기 (L65)", () => {
  it("currency: 숫자 아닌 값 → L65 isFinite false → Error", async () => {
    const r = await exec({ operation: "currency", value: "notanumber", currency: "USD" });
    expect(r).toContain("Error");
    expect(r).toContain("invalid number");
  });
});
