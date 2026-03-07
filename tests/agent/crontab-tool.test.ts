import { describe, it, expect } from "vitest";
import { CrontabTool } from "../../src/agent/tools/crontab.js";

function make_tool() {
  return new CrontabTool({ secret_vault: undefined as never });
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
