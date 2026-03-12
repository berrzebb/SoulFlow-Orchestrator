/**
 * DurationTool — 미커버 분기 보충.
 * to_iso years/months/weeks, humanize 복수형, parse 숫자 문자열, default action.
 */
import { describe, it, expect } from "vitest";
import { DurationTool } from "@src/agent/tools/duration.js";

const tool = new DurationTool();

async function run(params: Record<string, unknown>): Promise<unknown> {
  const result = await (tool as any).run(params);
  try { return JSON.parse(String(result)); } catch { return result; }
}

// ══════════════════════════════════════════
// parse_duration — 숫자 문자열 → from_ms 호출
// ══════════════════════════════════════════

describe("DurationTool — parse: 숫자 문자열 → from_ms", () => {
  it("'3600000' (ms 숫자 문자열) → 파싱됨", async () => {
    const r = await run({ action: "parse", duration: "3600000" }) as any;
    expect(r.parts).toBeDefined();
    expect(r.parts.hours).toBe(1);
  });

  it("'0' → 파싱됨 (0ms)", async () => {
    const r = await run({ action: "parse", duration: "0" }) as any;
    expect(r.parts).toBeDefined();
    expect(r.ms).toBe(0);
  });
});

// ══════════════════════════════════════════
// to_iso — years/months/weeks 포함
// ══════════════════════════════════════════

describe("DurationTool — to_iso: date_part 포함", () => {
  it("P1Y → ISO 'P1Y'", async () => {
    const r = await run({ action: "format", duration: "P1Y" }) as any;
    expect(r.iso).toBe("P1Y");
  });

  it("P2M → ISO 'P2M'", async () => {
    const r = await run({ action: "format", duration: "P2M" }) as any;
    expect(r.iso).toBe("P2M");
  });

  it("P3W → ISO 'P3W'", async () => {
    const r = await run({ action: "format", duration: "P3W" }) as any;
    expect(r.iso).toBe("P3W");
  });

  it("P1Y2M3D → ISO 'P1Y2M3D'", async () => {
    const r = await run({ action: "format", duration: "P1Y2M3D" }) as any;
    expect(r.iso).toBe("P1Y2M3D");
  });
});

// ══════════════════════════════════════════
// humanize — years/months/weeks (복수형)
// ══════════════════════════════════════════

describe("DurationTool — humanize: years/months/weeks", () => {
  it("P2Y → '2 years'", async () => {
    const r = await run({ action: "humanize", duration: "P2Y" }) as any;
    expect(r.human).toContain("2 years");
  });

  it("P1Y → '1 year' (단수)", async () => {
    const r = await run({ action: "humanize", duration: "P1Y" }) as any;
    expect(r.human).toContain("1 year");
    expect(r.human).not.toContain("1 years");
  });

  it("P3M → '3 months'", async () => {
    const r = await run({ action: "humanize", duration: "P3M" }) as any;
    expect(r.human).toContain("3 months");
  });

  it("P1M → '1 month' (단수)", async () => {
    const r = await run({ action: "humanize", duration: "P1M" }) as any;
    expect(r.human).toContain("1 month");
    expect(r.human).not.toContain("1 months");
  });

  it("P2W → '2 weeks'", async () => {
    const r = await run({ action: "humanize", duration: "P2W" }) as any;
    expect(r.human).toContain("2 weeks");
  });

  it("P1W → '1 week' (단수)", async () => {
    const r = await run({ action: "humanize", duration: "P1W" }) as any;
    expect(r.human).toContain("1 week");
    expect(r.human).not.toContain("1 weeks");
  });
});

// ══════════════════════════════════════════
// default action → Error string
// ══════════════════════════════════════════

describe("DurationTool — unknown action → Error", () => {
  it("알 수 없는 action → Error 문자열 반환", async () => {
    const r = await run({ action: "nonexistent" });
    expect(String(r)).toContain("unsupported action");
  });
});

// ══════════════════════════════════════════
// subtract — duration2 파싱 실패
// ══════════════════════════════════════════

describe("DurationTool — subtract: duration2 파싱 실패", () => {
  it("duration2 invalid → error", async () => {
    const r = await run({ action: "subtract", duration: "PT1H", duration2: "not-valid" }) as any;
    expect(r.error).toBeDefined();
  });
});

// ══════════════════════════════════════════
// compare — duration2 파싱 실패
// ══════════════════════════════════════════

describe("DurationTool — compare: duration2 파싱 실패", () => {
  it("duration2 invalid → error", async () => {
    const r = await run({ action: "compare", duration: "PT1H", duration2: "not-valid" }) as any;
    expect(r.error).toBeDefined();
  });
});

// ══════════════════════════════════════════
// 자연어 파싱 — year/month/week/sec
// ══════════════════════════════════════════

describe("DurationTool — parse: 자연어 year/month/week/sec", () => {
  it("'1 year' → years: 1", async () => {
    const r = await run({ action: "parse", duration: "1 year" }) as any;
    expect(r.parts.years).toBe(1);
  });

  it("'2 months' → months: 2", async () => {
    const r = await run({ action: "parse", duration: "2 months" }) as any;
    expect(r.parts.months).toBe(2);
  });

  it("'3 weeks' → weeks: 3", async () => {
    const r = await run({ action: "parse", duration: "3 weeks" }) as any;
    expect(r.parts.weeks).toBe(3);
  });

  it("'30 seconds' → seconds: 30", async () => {
    const r = await run({ action: "parse", duration: "30 seconds" }) as any;
    expect(r.parts.seconds).toBe(30);
  });
});
