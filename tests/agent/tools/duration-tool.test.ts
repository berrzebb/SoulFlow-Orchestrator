/**
 * DurationTool — parse/format/to_ms/from_ms/add/subtract/humanize/compare 테스트.
 */
import { describe, it, expect } from "vitest";
import { DurationTool } from "../../../src/agent/tools/duration.js";

const tool = new DurationTool();

async function exec(params: Record<string, unknown>): Promise<unknown> {
  const result = await tool.execute(params);
  try { return JSON.parse(String(result)); } catch { return result; }
}

describe("DurationTool — parse", () => {
  it("ISO 8601 기간 파싱 (P1DT2H30M)", async () => {
    const r = await exec({ action: "parse", duration: "P1DT2H30M" }) as Record<string, unknown>;
    const parts = r.parts as Record<string, number>;
    expect(parts.days).toBe(1);
    expect(parts.hours).toBe(2);
    expect(parts.minutes).toBe(30);
    expect(r.ms).toBeGreaterThan(0);
  });

  it("자연어 기간 파싱 (2 hours 30 minutes)", async () => {
    const r = await exec({ action: "parse", duration: "2 hours 30 minutes" }) as Record<string, unknown>;
    const parts = r.parts as Record<string, number>;
    expect(parts.hours).toBe(2);
    expect(parts.minutes).toBe(30);
  });

  it("단축 표현 파싱 (1h30m)", async () => {
    const r = await exec({ action: "parse", duration: "1h 30m" }) as Record<string, unknown>;
    const parts = r.parts as Record<string, number>;
    expect(parts.hours).toBe(1);
    expect(parts.minutes).toBe(30);
  });

  it("잘못된 기간 → error", async () => {
    const r = await exec({ action: "parse", duration: "not-a-duration" }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
  });
});

describe("DurationTool — to_ms", () => {
  it("1시간 → 3600000ms", async () => {
    const r = await exec({ action: "to_ms", duration: "PT1H" }) as Record<string, unknown>;
    expect(r.ms).toBe(3600000);
    expect(r.seconds).toBe(3600);
  });

  it("1일 → 86400000ms", async () => {
    const r = await exec({ action: "to_ms", duration: "P1D" }) as Record<string, unknown>;
    expect(r.ms).toBe(86400000);
  });
});

describe("DurationTool — from_ms", () => {
  it("3600000ms → 1시간", async () => {
    const r = await exec({ action: "from_ms", ms: 3600000 }) as Record<string, unknown>;
    const parts = r.parts as Record<string, number>;
    expect(parts.hours).toBe(1);
  });

  it("90000ms → 1분 30초", async () => {
    const r = await exec({ action: "from_ms", ms: 90000 }) as Record<string, unknown>;
    const parts = r.parts as Record<string, number>;
    expect(parts.minutes).toBe(1);
    expect(parts.seconds).toBe(30);
  });

  it("ISO 형식 반환", async () => {
    const r = await exec({ action: "from_ms", ms: 3600000 }) as Record<string, unknown>;
    expect(String(r.iso)).toContain("H");
  });
});

describe("DurationTool — format", () => {
  it("ISO와 human 형식 모두 반환", async () => {
    const r = await exec({ action: "format", duration: "P1DT2H" }) as Record<string, unknown>;
    expect(r.iso).toBeDefined();
    expect(r.human).toBeDefined();
    expect(String(r.human)).toContain("hour");
  });
});

describe("DurationTool — add", () => {
  it("두 기간 합산", async () => {
    const r = await exec({ action: "add", duration: "PT1H", duration2: "PT30M" }) as Record<string, unknown>;
    expect(Number(r.ms)).toBe(5400000); // 1.5시간
  });

  it("잘못된 기간 → error", async () => {
    const r = await exec({ action: "add", duration: "invalid", duration2: "PT1H" }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
  });
});

describe("DurationTool — subtract", () => {
  it("기간 빼기", async () => {
    const r = await exec({ action: "subtract", duration: "PT2H", duration2: "PT30M" }) as Record<string, unknown>;
    expect(Number(r.ms)).toBe(5400000); // 1.5시간
  });

  it("음수 결과 → 0 (최솟값)", async () => {
    const r = await exec({ action: "subtract", duration: "PT1H", duration2: "PT2H" }) as Record<string, unknown>;
    expect(Number(r.ms)).toBe(0);
  });
});

describe("DurationTool — humanize", () => {
  it("사람이 읽기 쉬운 형식 반환", async () => {
    const r = await exec({ action: "humanize", duration: "P1DT2H30M" }) as Record<string, unknown>;
    const h = String(r.human);
    expect(h).toContain("day");
    expect(h).toContain("hour");
    expect(h).toContain("minute");
  });

  it("0s → '0 seconds'", async () => {
    const r = await exec({ action: "humanize", duration: "PT0S" }) as Record<string, unknown>;
    expect(r.human).toBe("0 seconds");
  });
});

describe("DurationTool — compare", () => {
  it("동일한 기간 → result: 0", async () => {
    const r = await exec({ action: "compare", duration: "PT1H", duration2: "PT60M" }) as Record<string, unknown>;
    expect(r.result).toBe(0);
    expect(r.equal).toBe(true);
  });

  it("a > b → result: 1", async () => {
    const r = await exec({ action: "compare", duration: "PT2H", duration2: "PT1H" }) as Record<string, unknown>;
    expect(r.result).toBe(1);
  });

  it("a < b → result: -1", async () => {
    const r = await exec({ action: "compare", duration: "PT1H", duration2: "PT2H" }) as Record<string, unknown>;
    expect(r.result).toBe(-1);
  });
});

describe("DurationTool — 파싱 실패 (L35, L40, L65)", () => {
  it("format: 잘못된 duration → error (L35)", async () => {
    const r = JSON.parse(await new (await import("@src/agent/tools/duration.js")).DurationTool().execute({ action: "format", duration: "not-a-duration" }));
    expect(r.error).toContain("cannot parse duration");
  });

  it("to_ms: 잘못된 duration → error (L40)", async () => {
    const r = JSON.parse(await new (await import("@src/agent/tools/duration.js")).DurationTool().execute({ action: "to_ms", duration: "invalid" }));
    expect(r.error).toContain("cannot parse duration");
  });

  it("humanize: 잘못된 duration → error (L65)", async () => {
    const r = JSON.parse(await new (await import("@src/agent/tools/duration.js")).DurationTool().execute({ action: "humanize", duration: "garbage" }));
    expect(r.error).toContain("cannot parse duration");
  });
});
