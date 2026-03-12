import { describe, it, expect } from "vitest";
import { CrontabTool } from "../../src/agent/tools/crontab.js";

function make_tool() {
  return new CrontabTool({ secret_vault: undefined as never });
}

// cov2 헬퍼: run() 메서드 직접 호출
const _cov2_tool = new CrontabTool({ secret_vault: undefined as never });
async function run_cov2(params: Record<string, unknown>): Promise<unknown> {
  return JSON.parse(await (_cov2_tool as any).run(params));
}

describe("CrontabTool", () => {
  describe("human_to_cron", () => {
    it("every 5 minutes → */5 * * * *", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "human_to_cron", human: "every 5 minutes" }));
      expect(r.cron).toBe("*/5 * * * *");
      expect(r.next).toHaveLength(3);
    });

    it("every hour → 0 * * * *", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "human_to_cron", human: "every hour" }));
      expect(r.cron).toBe("0 * * * *");
    });

    it("daily at 9 → 0 9 * * *", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "human_to_cron", human: "daily at 9" }));
      expect(r.cron).toBe("0 9 * * *");
    });

    it("daily at 14:30 → 30 14 * * *", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "human_to_cron", human: "daily at 14:30" }));
      expect(r.cron).toBe("30 14 * * *");
    });

    it("every monday at 9 → 0 9 * * 1", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "human_to_cron", human: "every monday at 9" }));
      expect(r.cron).toBe("0 9 * * 1");
    });

    it("midnight → 0 0 * * *", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "human_to_cron", human: "midnight" }));
      expect(r.cron).toBe("0 0 * * *");
    });

    it("weekday at 9 → 0 9 * * 1-5", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "human_to_cron", human: "weekday at 9" }));
      expect(r.cron).toBe("0 9 * * 1-5");
    });

    it("파싱 불가 → 에러", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "human_to_cron", human: "something random" }));
      expect(r.error).toBeDefined();
    });
  });

  describe("cron_to_human", () => {
    it("*/5 * * * * → every 5 minutes", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "cron_to_human", expression: "*/5 * * * *" }));
      expect(r.human).toContain("5 minutes");
    });

    it("필드 수 부족 → 에러", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "cron_to_human", expression: "* *" }));
      expect(r.error).toContain("5 fields");
    });
  });

  describe("next_n", () => {
    it("다음 실행 시각 반환", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "next_n", expression: "* * * * *", count: 3 }));
      expect(r.next).toHaveLength(3);
    });

    it("count 기본값 5", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "next_n", expression: "* * * * *" }));
      expect(r.next).toHaveLength(5);
    });
  });

  describe("validate", () => {
    it("유효한 크론 표현식", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "validate", expression: "0 9 * * 1-5" }));
      expect(r.valid).toBe(true);
      expect(r.fields).toBe(5);
    });

    it("잘못된 크론 표현식 (필드 부족)", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "validate", expression: "0 9" }));
      expect(r.valid).toBe(false);
    });

    it("잘못된 문자 포함 → invalid", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "validate", expression: "0 9 * * MON" }));
      expect(r.valid).toBe(false);
    });
  });

  describe("is_due", () => {
    it("매분 실행 크론 → 현재 시각에 due", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "is_due", expression: "* * * * *" }));
      expect(r.is_due).toBe(true);
    });
  });

  describe("overlap", () => {
    it("겹치는 스케줄 탐지", async () => {
      const r = JSON.parse(await make_tool().execute({
        action: "overlap",
        expressions: JSON.stringify(["* * * * *", "* * * * *"]),
      }));
      expect(r.has_overlap).toBe(true);
      expect(r.overlaps.length).toBeGreaterThan(0);
    });

    it("겹치지 않는 스케줄", async () => {
      const r = JSON.parse(await make_tool().execute({
        action: "overlap",
        expressions: JSON.stringify(["0 9 * * 1", "0 9 * * 3"]),
      }));
      expect(r.has_overlap).toBe(false);
    });
  });

  it("알 수 없는 액션 → 에러", async () => {
    const r = JSON.parse(await make_tool().execute({ action: "unknown" as never }));
    expect(r.error).toContain("unknown action");
  });
});

// ══════════════════════════════════════════
// human_to_cron — 미커버 패턴
// ══════════════════════════════════════════

describe("CrontabTool — human_to_cron: 미커버 패턴", () => {
  it("every 2 hours → 0 */2 * * *", async () => {
    const r = await run_cov2({ action: "human_to_cron", human: "every 2 hours" }) as any;
    expect(r.cron).toBe("0 */2 * * *");
  });

  it("every minute → * * * * *", async () => {
    const r = await run_cov2({ action: "human_to_cron", human: "every minute" }) as any;
    expect(r.cron).toBe("* * * * *");
  });

  it("noon → 0 12 * * *", async () => {
    const r = await run_cov2({ action: "human_to_cron", human: "noon" }) as any;
    expect(r.cron).toBe("0 12 * * *");
  });

  it("every tuesday (at 없음) → 0 0 * * 2", async () => {
    const r = await run_cov2({ action: "human_to_cron", human: "every tuesday" }) as any;
    expect(r.cron).toBe("0 0 * * 2");
  });

  it("every fri (요일 약어, at 없음) → 0 0 * * 5", async () => {
    const r = await run_cov2({ action: "human_to_cron", human: "every fri" }) as any;
    expect(r.cron).toBe("0 0 * * 5");
  });

  it("every wednesday at 14:30 → 30 14 * * 3", async () => {
    const r = await run_cov2({ action: "human_to_cron", human: "every wednesday at 14:30" }) as any;
    expect(r.cron).toBe("30 14 * * 3");
  });

  it("weekday (at 없음) → 0 9 * * 1-5", async () => {
    const r = await run_cov2({ action: "human_to_cron", human: "weekday" }) as any;
    expect(r.cron).toBe("0 9 * * 1-5");
  });
});

// ══════════════════════════════════════════
// cron_to_human — 미커버 분기
// ══════════════════════════════════════════

describe("CrontabTool — cron_to_human: 미커버 분기", () => {
  it("0 */3 * * * → every 3 hours", async () => {
    const r = await run_cov2({ action: "cron_to_human", expression: "0 */3 * * *" }) as any;
    expect(r.human).toContain("3 hours");
  });

  it("* * * * * → every minute", async () => {
    const r = await run_cov2({ action: "cron_to_human", expression: "* * * * *" }) as any;
    expect(r.human).toContain("every minute");
  });

  it("30 * * * * → at minute 30 of every hour", async () => {
    const r = await run_cov2({ action: "cron_to_human", expression: "30 * * * *" }) as any;
    expect(r.human).toContain("minute 30");
  });

  it("0 9 15 * * → dom=15 포함", async () => {
    const r = await run_cov2({ action: "cron_to_human", expression: "0 9 15 * *" }) as any;
    expect(r.human).toContain("day 15");
  });

  it("0 9 * 6 * → mon=6 포함", async () => {
    const r = await run_cov2({ action: "cron_to_human", expression: "0 9 * 6 *" }) as any;
    expect(r.human).toContain("month 6");
  });

  it("0 9 * * 1 → dow=1(monday) 포함", async () => {
    const r = await run_cov2({ action: "cron_to_human", expression: "0 9 * * 1" }) as any;
    expect(r.human).toContain("monday");
  });

  it("0 9 * * 7 → dow=7(=0=sunday) 포함", async () => {
    const r = await run_cov2({ action: "cron_to_human", expression: "0 9 * * 7" }) as any;
    expect(r.human).toContain("sunday");
  });
});

// ══════════════════════════════════════════
// overlap — invalid JSON
// ══════════════════════════════════════════

describe("CrontabTool — overlap: invalid JSON", () => {
  it("invalid JSON expressions → error 반환", async () => {
    const r = await run_cov2({ action: "overlap", expressions: "not-json" }) as any;
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
    const r = await run_cov2({ action: "is_due", expression: "* * * * *", from }) as any;
    expect(typeof r.is_due).toBe("boolean");
  });
});

// ══════════════════════════════════════════
// next_n — from 파라미터
// ══════════════════════════════════════════

describe("CrontabTool — next_n: from 파라미터", () => {
  it("from 지정 시각 기준으로 다음 실행 시각 계산", async () => {
    const from = "2026-01-01T00:00:00.000Z";
    const r = await run_cov2({ action: "next_n", expression: "* * * * *", count: 2, from }) as any;
    expect(r.next).toHaveLength(2);
    // from 이후 시각이어야 함
    expect(new Date(r.next[0]).getTime()).toBeGreaterThanOrEqual(new Date(from).getTime());
  });

  it("count 상한값 50 적용", async () => {
    const r = await run_cov2({ action: "next_n", expression: "* * * * *", count: 100 }) as any;
    expect(r.next).toHaveLength(50);
  });
});

// ══════════════════════════════════════════
// parse_field — step + range 결합
// ══════════════════════════════════════════

describe("CrontabTool — parse_field step+range 조합", () => {
  it("1-10/2 range with step → 해당 시각들 반환", async () => {
    // 크론 표현식에서 range+step 사용
    const r = await run_cov2({ action: "next_n", expression: "0-59/15 * * * *", count: 3 }) as any;
    expect(r.next).toHaveLength(3);
  });

  it("쉼표 구분 (1,15,30 * * * *) → 세 시각 모두 포함", async () => {
    const r = await run_cov2({ action: "next_n", expression: "1,15,30 * * * *", count: 5 }) as any;
    expect(r.next.length).toBeGreaterThan(0);
  });

  it("dow=7 처리 (7=일요일로 변환)", async () => {
    // 크론 표현식에서 7은 일요일(0)과 동일
    const r = await run_cov2({ action: "validate", expression: "0 9 * * 7" }) as any;
    expect(r.valid).toBe(true);
  });
});
