import { describe, it, expect } from "vitest";
import { DateTimeTool } from "@src/agent/tools/datetime.js";

function run(params: Record<string, unknown>): Promise<string> {
  const tool = new DateTimeTool();
  return tool.execute(params);
}

describe("DateTimeTool", () => {
  describe("action=now", () => {
    it("returns ISO string by default", async () => {
      const result = await run({ action: "now" });
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("accepts format parameter", async () => {
      const result = await run({ action: "now", format: "YYYY-MM-DD" });
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("accepts timezone parameter", async () => {
      const result = await run({ action: "now", from_tz: "Asia/Seoul" });
      const parsed = JSON.parse(result);
      expect(parsed.tz).toBe("Asia/Seoul");
      expect(parsed.iso).toBeTruthy();
      expect(parsed.unix_ms).toBeGreaterThan(0);
    });

    it("returns error for invalid timezone", async () => {
      const result = await run({ action: "now", from_tz: "Invalid/Zone" });
      expect(result).toContain("Error:");
    });
  });

  describe("action=add", () => {
    it("adds days", async () => {
      const result = await run({ action: "add", date: "2025-01-01T00:00:00Z", amount: 5, unit: "d" });
      expect(result).toBe("2025-01-06T00:00:00.000Z");
    });

    it("adds hours", async () => {
      const result = await run({ action: "add", date: "2025-01-01T00:00:00Z", amount: 3, unit: "h" });
      expect(result).toBe("2025-01-01T03:00:00.000Z");
    });

    it("adds months", async () => {
      const result = await run({ action: "add", date: "2025-01-15T00:00:00Z", amount: 2, unit: "month" });
      expect(result).toBe("2025-03-15T00:00:00.000Z");
    });

    it("adds years", async () => {
      const result = await run({ action: "add", date: "2025-01-01T00:00:00Z", amount: 1, unit: "year" });
      expect(result).toBe("2026-01-01T00:00:00.000Z");
    });

    it("subtracts with negative amount", async () => {
      const result = await run({ action: "add", date: "2025-01-10T00:00:00Z", amount: -3, unit: "d" });
      expect(result).toBe("2025-01-07T00:00:00.000Z");
    });

    it("adds weeks", async () => {
      const result = await run({ action: "add", date: "2025-01-01T00:00:00Z", amount: 2, unit: "week" });
      expect(result).toBe("2025-01-15T00:00:00.000Z");
    });

    it("returns error for invalid date", async () => {
      const result = await run({ action: "add", date: "not-a-date", amount: 1, unit: "d" });
      expect(result).toBe("Error: invalid date");
    });
  });

  describe("action=diff", () => {
    it("calculates positive difference", async () => {
      const result = await run({ action: "diff", date: "2025-01-01T00:00:00Z", date2: "2025-01-04T00:00:00Z" });
      const parsed = JSON.parse(result);
      expect(parsed.days).toBe(3);
      expect(parsed.hours).toBe(72);
      expect(parsed.ms).toBe(3 * 86400000);
    });

    it("calculates negative difference", async () => {
      const result = await run({ action: "diff", date: "2025-01-04T00:00:00Z", date2: "2025-01-01T00:00:00Z" });
      const parsed = JSON.parse(result);
      expect(parsed.days).toBe(-3);
    });

    it("includes human-readable format", async () => {
      const result = await run({ action: "diff", date: "2025-01-01T00:00:00Z", date2: "2025-01-03T05:30:00Z" });
      const parsed = JSON.parse(result);
      expect(parsed.human).toContain("2d");
      expect(parsed.human).toContain("5h");
      expect(parsed.human).toContain("30m");
    });

    it("returns error for invalid dates", async () => {
      const result = await run({ action: "diff", date: "bad", date2: "also-bad" });
      expect(result).toBe("Error: invalid date(s)");
    });
  });

  describe("action=timezone", () => {
    it("converts between timezones", async () => {
      const result = await run({
        action: "timezone",
        date: "2025-01-01T00:00:00Z",
        from_tz: "UTC",
        to_tz: "Asia/Seoul",
      });
      const parsed = JSON.parse(result);
      expect(parsed.from.timezone).toBe("UTC");
      expect(parsed.to.timezone).toBe("Asia/Seoul");
    });

    it("returns error for invalid timezone", async () => {
      const result = await run({
        action: "timezone",
        date: "2025-01-01T00:00:00Z",
        from_tz: "UTC",
        to_tz: "Invalid/TZ",
      });
      expect(result).toBe("Error: invalid timezone");
    });
  });

  describe("action=business_days", () => {
    it("counts business days Mon-Fri", async () => {
      // 2025-01-06 (Mon) to 2025-01-10 (Fri) = 5 business days
      const result = await run({ action: "business_days", date: "2025-01-06", date2: "2025-01-10" });
      const parsed = JSON.parse(result);
      expect(parsed.business_days).toBe(5);
      expect(parsed.calendar_days).toBe(5);
    });

    it("excludes weekends", async () => {
      // 2025-01-06 (Mon) to 2025-01-12 (Sun) = 5 business days, 7 calendar days
      const result = await run({ action: "business_days", date: "2025-01-06", date2: "2025-01-12" });
      const parsed = JSON.parse(result);
      expect(parsed.business_days).toBe(5);
      expect(parsed.calendar_days).toBe(7);
    });

    it("handles reversed order", async () => {
      const result = await run({ action: "business_days", date: "2025-01-12", date2: "2025-01-06" });
      const parsed = JSON.parse(result);
      expect(parsed.business_days).toBe(5);
    });
  });

  describe("action=format", () => {
    it("formats date with pattern", async () => {
      const result = await run({ action: "format", date: "2025-03-15T14:30:45Z", format: "YYYY-MM-DD HH:mm:ss" });
      expect(result).toBe("2025-03-15 14:30:45");
    });

    it("returns error for invalid date", async () => {
      const result = await run({ action: "format", date: "not-a-date" });
      expect(result).toBe("Error: invalid date");
    });
  });

  describe("action=parse", () => {
    it("parses ISO date", async () => {
      const result = await run({ action: "parse", date: "2025-06-15T12:00:00Z" });
      const parsed = JSON.parse(result);
      expect(parsed.year).toBe(2025);
      expect(parsed.month).toBe(6);
      expect(parsed.day).toBe(15);
      expect(parsed.hour).toBe(12);
    });

    it("returns error for invalid date", async () => {
      const result = await run({ action: "parse", date: "garbage" });
      expect(result).toBe("Error: invalid date");
    });
  });

  describe("action=day_info", () => {
    it("returns day metadata", async () => {
      // 2025-01-01 is Wednesday
      const result = await run({ action: "day_info", date: "2025-01-01T00:00:00Z" });
      const parsed = JSON.parse(result);
      expect(parsed.day_of_week).toBe("Wednesday");
      expect(parsed.day_of_week_num).toBe(3);
      expect(parsed.is_weekend).toBe(false);
      expect(parsed.quarter).toBe(1);
      expect(parsed.days_in_month).toBe(31);
    });

    it("detects weekend", async () => {
      // 2025-01-04 is Saturday
      const result = await run({ action: "day_info", date: "2025-01-04T00:00:00Z" });
      const parsed = JSON.parse(result);
      expect(parsed.day_of_week).toBe("Saturday");
      expect(parsed.is_weekend).toBe(true);
    });

    it("detects leap year", async () => {
      const result = await run({ action: "day_info", date: "2024-02-29T00:00:00Z" });
      const parsed = JSON.parse(result);
      expect(parsed.is_leap_year).toBe(true);
      expect(parsed.days_in_month).toBe(29);
    });

    it("detects non-leap year", async () => {
      const result = await run({ action: "day_info", date: "2025-02-15T00:00:00Z" });
      const parsed = JSON.parse(result);
      expect(parsed.is_leap_year).toBe(false);
      expect(parsed.days_in_month).toBe(28);
    });
  });

  describe("action=range", () => {
    it("generates date range", async () => {
      const result = await run({ action: "range", start_date: "2025-01-01", end_date: "2025-01-05" });
      const dates = JSON.parse(result) as string[];
      expect(dates).toEqual(["2025-01-01", "2025-01-02", "2025-01-03", "2025-01-04", "2025-01-05"]);
    });

    it("supports step_days", async () => {
      const result = await run({ action: "range", start_date: "2025-01-01", end_date: "2025-01-10", step_days: 3 });
      const dates = JSON.parse(result) as string[];
      expect(dates).toEqual(["2025-01-01", "2025-01-04", "2025-01-07", "2025-01-10"]);
    });

    it("step_days=0 defaults to 1 (falsy coercion)", async () => {
      const result = await run({ action: "range", start_date: "2025-01-01", end_date: "2025-01-03", step_days: 0 });
      const dates = JSON.parse(result) as string[];
      expect(dates).toEqual(["2025-01-01", "2025-01-02", "2025-01-03"]);
    });

    it("returns empty array when start > end", async () => {
      const result = await run({ action: "range", start_date: "2025-01-10", end_date: "2025-01-01" });
      const dates = JSON.parse(result) as string[];
      expect(dates).toEqual([]);
    });
  });

  describe("unsupported action", () => {
    it("returns error", async () => {
      const result = await run({ action: "unknown_action" });
      expect(result).toContain("Error:");
      expect(result).toContain("unknown_action");
    });
  });

  describe("tool interface", () => {
    it("has correct metadata", () => {
      const tool = new DateTimeTool();
      expect(tool.name).toBe("datetime");
      expect(tool.category).toBe("memory");
      expect(tool.description).toBeTruthy();
    });

    it("has valid schema", () => {
      const tool = new DateTimeTool();
      const schema = tool.to_schema();
      expect(schema.type).toBe("function");
      expect(schema.function.name).toBe("datetime");
      expect(schema.function.parameters.properties).toBeDefined();
    });
  });
});
