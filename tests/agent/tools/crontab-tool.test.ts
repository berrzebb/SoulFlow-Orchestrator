/**
 * CrontabTool — cron 표현식 파싱/검증/다음 실행 시각 + 미커버 분기.
 */
import { describe, it, expect } from "vitest";
import { CrontabTool } from "@src/agent/tools/crontab.js";

const tool = new CrontabTool();

describe("CrontabTool — 기본 동작", () => {
  it("validate: 유효한 크론 표현식", async () => {
    const r = JSON.parse(await tool.execute({ action: "validate", expression: "*/5 * * * *" }));
    expect(r.valid).toBe(true);
  });

  it("cron_to_human: 5필드 → 설명 반환", async () => {
    const r = JSON.parse(await tool.execute({ action: "cron_to_human", expression: "0 9 * * 1" }));
    expect(r.human).toBeDefined();
  });

  it("next_n: 다음 실행 시각 5개", async () => {
    const r = JSON.parse(await tool.execute({ action: "next_n", expression: "*/5 * * * *" }));
    expect(Array.isArray(r.next)).toBe(true);
    expect(r.next.length).toBeGreaterThan(0);
  });

  it("human_to_cron: 사람이 읽는 표현 → 크론", async () => {
    const r = JSON.parse(await tool.execute({ action: "human_to_cron", human: "every 5 minutes" }));
    expect(r.cron).toBeDefined();
  });
});

describe("CrontabTool — 미커버 분기 (L29)", () => {
  it("next_n: 5필드 아닌 표현식 → next_match L29 return [] → empty next", async () => {
    const r = JSON.parse(await tool.execute({ action: "next_n", expression: "* * *" }));
    expect(r.next).toEqual([]);
  });
});

// ── 추가 미커버 분기 ──────────────────────────────────────────
describe("CrontabTool — parse_field range (L18/L19)", () => {
  it("cron_to_human range 표현식(1-5 dow) → describe L173/L174", async () => {
    // dow "1-5" → parse_field range 분기 (L18/L19)
    const r = JSON.parse(await tool.execute({ action: "cron_to_human", expression: "0 9 * * 1-5" }));
    expect(r.human).toBeDefined();
    expect(typeof r.human).toBe("string");
  });
});

describe("CrontabTool — human_to_cron 실패/다양한 패턴", () => {
  it("parse 불가 표현 → L76 error", async () => {
    const r = JSON.parse(await tool.execute({ action: "human_to_cron", human: "gibberish xyz" }));
    expect(r.error).toBeDefined();
    expect(r.error).toContain("cannot parse");
  });

  it("'every 2 hours' → L135-L137 every N hours", async () => {
    const r = JSON.parse(await tool.execute({ action: "human_to_cron", human: "every 2 hours" }));
    expect(r.cron).toContain("*/2");
  });

  it("'every minute' → L139 * * * * *", async () => {
    const r = JSON.parse(await tool.execute({ action: "human_to_cron", human: "every minute" }));
    expect(r.cron).toBe("* * * * *");
  });

  it("'every hour' → L140 0 * * * *", async () => {
    const r = JSON.parse(await tool.execute({ action: "human_to_cron", human: "every hour" }));
    expect(r.cron).toBe("0 * * * *");
  });

  it("'daily at 9' → L141-L143", async () => {
    const r = JSON.parse(await tool.execute({ action: "human_to_cron", human: "daily at 9" }));
    expect(r.cron).toContain("9");
  });

  it("'daily at 9:30' → L141-L143 with minutes", async () => {
    const r = JSON.parse(await tool.execute({ action: "human_to_cron", human: "daily at 9:30" }));
    expect(r.cron).toBe("30 9 * * *");
  });

  it("'every monday at 14' → L145-L151 day of week with time", async () => {
    const r = JSON.parse(await tool.execute({ action: "human_to_cron", human: "every monday at 14" }));
    expect(r.cron).toContain("14");
  });

  it("'every monday' → L152 day of week without time", async () => {
    const r = JSON.parse(await tool.execute({ action: "human_to_cron", human: "every monday" }));
    expect(r.cron).toContain("* * 1");
  });

  it("'midnight' → L154 0 0 * * *", async () => {
    const r = JSON.parse(await tool.execute({ action: "human_to_cron", human: "midnight" }));
    expect(r.cron).toBe("0 0 * * *");
  });

  it("'noon' → L155 0 12 * * *", async () => {
    const r = JSON.parse(await tool.execute({ action: "human_to_cron", human: "noon" }));
    expect(r.cron).toBe("0 12 * * *");
  });

  it("'weekday at 9' → L156-L158", async () => {
    const r = JSON.parse(await tool.execute({ action: "human_to_cron", human: "weekday at 9" }));
    expect(r.cron).toContain("1-5");
  });

  it("'weekday' (no time) → L158 default 0 9 * * 1-5", async () => {
    const r = JSON.parse(await tool.execute({ action: "human_to_cron", human: "weekday" }));
    expect(r.cron).toBe("0 9 * * 1-5");
  });
});

describe("CrontabTool — cron_to_human 오류", () => {
  it("5필드 아닌 표현식 → L82 error", async () => {
    const r = JSON.parse(await tool.execute({ action: "cron_to_human", expression: "* * *" }));
    expect(r.error).toContain("invalid cron");
  });
});

describe("CrontabTool — is_due", () => {
  it("is_due: 유효한 cron → is_due 반환", async () => {
    const r = JSON.parse(await tool.execute({ action: "is_due", expression: "* * * * *" }));
    expect(typeof r.is_due).toBe("boolean");
  });

  it("is_due: from 날짜 지정", async () => {
    const r = JSON.parse(await tool.execute({ action: "is_due", expression: "0 0 * * *", from: "2025-01-01T00:01:00Z" }));
    expect(typeof r.is_due).toBe("boolean");
  });
});

describe("CrontabTool — overlap", () => {
  it("overlap: 두 표현식 겹침 확인", async () => {
    const r = JSON.parse(await tool.execute({ action: "overlap", expressions: JSON.stringify(["*/5 * * * *", "*/10 * * * *"]) }));
    expect(typeof r.has_overlap).toBe("boolean");
  });

  it("overlap: 잘못된 JSON → error", async () => {
    const r = JSON.parse(await tool.execute({ action: "overlap", expressions: "{bad" }));
    expect(r.error).toBeDefined();
  });
});

describe("CrontabTool — unknown action", () => {
  it("unknown action → L126 error", async () => {
    const r = JSON.parse(await tool.execute({ action: "bogus" }));
    expect(r.error).toContain("unknown action");
  });
});

describe("CrontabTool — describe 분기 (L167-L170)", () => {
  it("hour.startsWith('*/') → every N hours at minute M (L167)", async () => {
    const r = JSON.parse(await tool.execute({ action: "cron_to_human", expression: "30 */2 * * *" }));
    expect(r.human).toContain("every 2 hours");
  });

  it("min='*' hour='*' → every minute (L168)", async () => {
    const r = JSON.parse(await tool.execute({ action: "cron_to_human", expression: "* * * * *" }));
    expect(r.human).toContain("every minute");
  });

  it("min!='*' hour='*' → at minute M of every hour (L169)", async () => {
    const r = JSON.parse(await tool.execute({ action: "cron_to_human", expression: "15 * * * *" }));
    expect(r.human).toContain("minute 15");
  });

  it("dom!='*' → on day D (L171)", async () => {
    const r = JSON.parse(await tool.execute({ action: "cron_to_human", expression: "0 9 15 * *" }));
    expect(r.human).toContain("day 15");
  });

  it("mon!='*' → in month M (L172)", async () => {
    const r = JSON.parse(await tool.execute({ action: "cron_to_human", expression: "0 9 * 6 *" }));
    expect(r.human).toContain("month 6");
  });
});
