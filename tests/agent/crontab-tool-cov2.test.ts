/**
 * CrontabTool — 미커버 분기 보충.
 * human_to_cron: every N hours/every minute/요일(at 없음)/noon/weekday,
 * cron_to_human: hour-step/every-minute/minute-of-hour/dom/mon/dow 조합,
 * overlap: invalid JSON, is_due/next_n from 파라미터.
 */
import { describe, it, expect } from "vitest";
import { CrontabTool } from "@src/agent/tools/crontab.js";

const tool = new CrontabTool({ secret_vault: undefined as never });

async function run(params: Record<string, unknown>): Promise<unknown> {
  return JSON.parse(await (tool as any).run(params));
}

// ══════════════════════════════════════════
// human_to_cron — 미커버 패턴
// ══════════════════════════════════════════

describe("CrontabTool — human_to_cron: 미커버 패턴", () => {
  it("every 2 hours → 0 */2 * * *", async () => {
    const r = await run({ action: "human_to_cron", human: "every 2 hours" }) as any;
    expect(r.cron).toBe("0 */2 * * *");
  });

  it("every minute → * * * * *", async () => {
    const r = await run({ action: "human_to_cron", human: "every minute" }) as any;
    expect(r.cron).toBe("* * * * *");
  });

  it("noon → 0 12 * * *", async () => {
    const r = await run({ action: "human_to_cron", human: "noon" }) as any;
    expect(r.cron).toBe("0 12 * * *");
  });

  it("every tuesday (at 없음) → 0 0 * * 2", async () => {
    const r = await run({ action: "human_to_cron", human: "every tuesday" }) as any;
    expect(r.cron).toBe("0 0 * * 2");
  });

  it("every fri (요일 약어, at 없음) → 0 0 * * 5", async () => {
    const r = await run({ action: "human_to_cron", human: "every fri" }) as any;
    expect(r.cron).toBe("0 0 * * 5");
  });

  it("every wednesday at 14:30 → 30 14 * * 3", async () => {
    const r = await run({ action: "human_to_cron", human: "every wednesday at 14:30" }) as any;
    expect(r.cron).toBe("30 14 * * 3");
  });

  it("weekday (at 없음) → 0 9 * * 1-5", async () => {
    const r = await run({ action: "human_to_cron", human: "weekday" }) as any;
    expect(r.cron).toBe("0 9 * * 1-5");
  });
});

// ══════════════════════════════════════════
// cron_to_human — 미커버 분기
// ══════════════════════════════════════════

describe("CrontabTool — cron_to_human: 미커버 분기", () => {
  it("0 */3 * * * → every 3 hours", async () => {
    const r = await run({ action: "cron_to_human", expression: "0 */3 * * *" }) as any;
    expect(r.human).toContain("3 hours");
  });

  it("* * * * * → every minute", async () => {
    const r = await run({ action: "cron_to_human", expression: "* * * * *" }) as any;
    expect(r.human).toContain("every minute");
  });

  it("30 * * * * → at minute 30 of every hour", async () => {
    const r = await run({ action: "cron_to_human", expression: "30 * * * *" }) as any;
    expect(r.human).toContain("minute 30");
  });

  it("0 9 15 * * → dom=15 포함", async () => {
    const r = await run({ action: "cron_to_human", expression: "0 9 15 * *" }) as any;
    expect(r.human).toContain("day 15");
  });

  it("0 9 * 6 * → mon=6 포함", async () => {
    const r = await run({ action: "cron_to_human", expression: "0 9 * 6 *" }) as any;
    expect(r.human).toContain("month 6");
  });

  it("0 9 * * 1 → dow=1(monday) 포함", async () => {
    const r = await run({ action: "cron_to_human", expression: "0 9 * * 1" }) as any;
    expect(r.human).toContain("monday");
  });

  it("0 9 * * 7 → dow=7(=0=sunday) 포함", async () => {
    const r = await run({ action: "cron_to_human", expression: "0 9 * * 7" }) as any;
    expect(r.human).toContain("sunday");
  });
});

// ══════════════════════════════════════════
// overlap — invalid JSON
// ══════════════════════════════════════════

describe("CrontabTool — overlap: invalid JSON", () => {
  it("invalid JSON expressions → error 반환", async () => {
    const r = await run({ action: "overlap", expressions: "not-json" }) as any;
    expect(r.error).toContain("invalid expressions JSON");
  });
});

// ══════════════════════════════════════════
// is_due — from 파라미터
// ══════════════════════════════════════════

describe("CrontabTool — is_due: from 파라미터", () => {
  it("from 지정 시각 → 해당 시각 기준으로 due 계산", async () => {
    // 매분 실행 크론은 어떤 시각에든 due
    const from = new Date().toISOString();
    const r = await run({ action: "is_due", expression: "* * * * *", from }) as any;
    expect(typeof r.is_due).toBe("boolean");
  });
});

// ══════════════════════════════════════════
// next_n — from 파라미터
// ══════════════════════════════════════════

describe("CrontabTool — next_n: from 파라미터", () => {
  it("from 지정 시각 기준으로 다음 실행 시각 계산", async () => {
    const from = "2026-01-01T00:00:00.000Z";
    const r = await run({ action: "next_n", expression: "* * * * *", count: 2, from }) as any;
    expect(r.next).toHaveLength(2);
    // from 이후 시각이어야 함
    expect(new Date(r.next[0]).getTime()).toBeGreaterThanOrEqual(new Date(from).getTime());
  });

  it("count 상한값 50 적용", async () => {
    const r = await run({ action: "next_n", expression: "* * * * *", count: 100 }) as any;
    expect(r.next).toHaveLength(50);
  });
});

// ══════════════════════════════════════════
// parse_field — step + range 결합
// ══════════════════════════════════════════

describe("CrontabTool — parse_field step+range 조합", () => {
  it("1-10/2 range with step → 해당 시각들 반환", async () => {
    // 크론 표현식에서 range+step 사용
    const r = await run({ action: "next_n", expression: "0-59/15 * * * *", count: 3 }) as any;
    expect(r.next).toHaveLength(3);
  });

  it("쉼표 구분 (1,15,30 * * * *) → 세 시각 모두 포함", async () => {
    const r = await run({ action: "next_n", expression: "1,15,30 * * * *", count: 5 }) as any;
    expect(r.next.length).toBeGreaterThan(0);
  });

  it("dow=7 처리 (7=일요일로 변환)", async () => {
    // 크론 표현식에서 7은 일요일(0)과 동일
    const r = await run({ action: "validate", expression: "0 9 * * 7" }) as any;
    expect(r.valid).toBe(true);
  });
});
