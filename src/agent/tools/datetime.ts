/** DateTime 도구 — 현재 시간 조회, 포맷 변환, 타임존 변환, 영업일 계산, 기간 계산, 날짜 가감. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

export class DateTimeTool extends Tool {
  readonly name = "datetime";
  readonly category = "memory" as const;
  readonly description =
    "Date/time operations: current time, add/subtract durations, diff, timezone conversion, business days, format, parse, day info, date range.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["now", "add", "diff", "timezone", "business_days", "format", "parse", "day_info", "range"],
        description: "Date operation",
      },
      date: { type: "string", description: "Input date string (ISO 8601 or common formats)" },
      date2: { type: "string", description: "Second date (for diff/business_days)" },
      amount: { type: "number", description: "Amount to add (can be negative)" },
      unit: { type: "string", enum: ["ms", "s", "min", "h", "d", "week", "month", "year"], description: "Time unit" },
      from_tz: { type: "string", description: "Source timezone (IANA, e.g. Asia/Seoul)" },
      to_tz: { type: "string", description: "Target timezone (IANA, e.g. America/New_York)" },
      format: { type: "string", description: "Output format pattern (e.g. YYYY-MM-DD)" },
      start_date: { type: "string", description: "Range start" },
      end_date: { type: "string", description: "Range end" },
      step_days: { type: "integer", description: "Range step in days (default: 1)" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "now");
    switch (action) {
      case "now": return this.now(String(params.format || ""), String(params.from_tz || ""));
      case "add": return this.add(String(params.date || ""), Number(params.amount ?? 0), String(params.unit || "d"));
      case "diff": return this.diff(String(params.date || ""), String(params.date2 || ""));
      case "timezone": return this.timezone(String(params.date || ""), String(params.from_tz || "UTC"), String(params.to_tz || "UTC"));
      case "business_days": return this.business_days(String(params.date || ""), String(params.date2 || ""));
      case "format": return this.format_date(String(params.date || ""), String(params.format || "YYYY-MM-DD"));
      case "parse": return this.parse_date(String(params.date || ""));
      case "day_info": return this.day_info(String(params.date || ""));
      case "range": return this.date_range(String(params.start_date || params.date || ""), String(params.end_date || params.date2 || ""), Number(params.step_days || 1));
      default: return `Error: unsupported action "${action}"`;
    }
  }

  private now(fmt: string, tz: string): string {
    const d = new Date();
    if (tz) {
      try {
        const localized = d.toLocaleString("sv-SE", { timeZone: tz, hour12: false });
        return JSON.stringify({ iso: d.toISOString(), localized, tz, unix_ms: d.getTime() });
      } catch {
        return `Error: invalid timezone "${tz}"`;
      }
    }
    return fmt ? this.apply_format(d, fmt) : d.toISOString();
  }

  private add(date: string, amount: number, unit: string): string {
    const d = this.safe_parse(date);
    if (!d) return "Error: invalid date";
    const ms_map: Record<string, number> = { ms: 1, s: 1000, min: 60_000, h: 3_600_000, d: 86_400_000, week: 604_800_000 };
    if (unit === "month") {
      d.setMonth(d.getMonth() + amount);
    } else if (unit === "year") {
      d.setFullYear(d.getFullYear() + amount);
    } else {
      const multiplier = ms_map[unit] ?? 86_400_000;
      d.setTime(d.getTime() + amount * multiplier);
    }
    return d.toISOString();
  }

  private diff(a: string, b: string): string {
    const da = this.safe_parse(a), db = this.safe_parse(b);
    if (!da || !db) return "Error: invalid date(s)";
    const ms = db.getTime() - da.getTime();
    const abs = Math.abs(ms);
    return JSON.stringify({
      ms,
      seconds: Math.round(ms / 1000),
      minutes: Math.round(ms / 60_000),
      hours: Math.round(ms / 3_600_000),
      days: Math.round(ms / 86_400_000),
      human: `${Math.floor(abs / 86_400_000)}d ${Math.floor((abs % 86_400_000) / 3_600_000)}h ${Math.floor((abs % 3_600_000) / 60_000)}m`,
    });
  }

  private timezone(date: string, from_tz: string, to_tz: string): string {
    const d = this.safe_parse(date);
    if (!d) return "Error: invalid date";
    try {
      const from_str = d.toLocaleString("en-US", { timeZone: from_tz });
      const to_str = d.toLocaleString("en-US", { timeZone: to_tz });
      const to_iso = new Date(d.toLocaleString("en-US", { timeZone: to_tz }));
      return JSON.stringify({
        from: { timezone: from_tz, local: from_str },
        to: { timezone: to_tz, local: to_str, iso: to_iso.toISOString() },
      }, null, 2);
    } catch {
      return "Error: invalid timezone";
    }
  }

  private business_days(a: string, b: string): string {
    const da = this.safe_parse(a), db = this.safe_parse(b);
    if (!da || !db) return "Error: invalid date(s)";
    let count = 0;
    const start = new Date(Math.min(da.getTime(), db.getTime()));
    const end = new Date(Math.max(da.getTime(), db.getTime()));
    const cursor = new Date(start);
    while (cursor <= end) {
      const dow = cursor.getDay();
      if (dow !== 0 && dow !== 6) count++;
      cursor.setDate(cursor.getDate() + 1);
    }
    return JSON.stringify({ business_days: count, calendar_days: Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1 });
  }

  private format_date(date: string, fmt: string): string {
    const d = this.safe_parse(date);
    if (!d) return "Error: invalid date";
    return this.apply_format(d, fmt);
  }

  private parse_date(date: string): string {
    const d = this.safe_parse(date);
    if (!d) return "Error: invalid date";
    return JSON.stringify({
      iso: d.toISOString(),
      unix_ms: d.getTime(),
      unix_s: Math.floor(d.getTime() / 1000),
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
      hour: d.getUTCHours(),
      minute: d.getUTCMinutes(),
      second: d.getUTCSeconds(),
    });
  }

  private day_info(date: string): string {
    const d = this.safe_parse(date);
    if (!d) return "Error: invalid date";
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const start_of_year = new Date(d.getUTCFullYear(), 0, 1);
    const day_of_year = Math.ceil((d.getTime() - start_of_year.getTime()) / 86_400_000) + 1;
    const week_number = Math.ceil(day_of_year / 7);
    return JSON.stringify({
      day_of_week: days[d.getUTCDay()],
      day_of_week_num: d.getUTCDay(),
      day_of_year,
      week_number,
      is_weekend: d.getUTCDay() === 0 || d.getUTCDay() === 6,
      is_leap_year: this.is_leap(d.getUTCFullYear()),
      days_in_month: new Date(d.getUTCFullYear(), d.getUTCMonth() + 1, 0).getDate(),
      quarter: Math.ceil((d.getUTCMonth() + 1) / 3),
    });
  }

  private date_range(start: string, end: string, step: number): string {
    const ds = this.safe_parse(start), de = this.safe_parse(end);
    if (!ds || !de) return "Error: invalid date(s)";
    if (step < 1) return "Error: step must be >= 1";
    const dates: string[] = [];
    const cursor = new Date(ds);
    const limit = 1000;
    while (cursor <= de && dates.length < limit) {
      dates.push(cursor.toISOString().slice(0, 10));
      cursor.setDate(cursor.getDate() + step);
    }
    return JSON.stringify(dates);
  }

  private safe_parse(s: string): Date | null {
    if (!s.trim()) return null;
    const ts = Number(s);
    if (!isNaN(ts) && s.length >= 10) {
      return new Date(ts);
    }
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  private apply_format(d: Date, fmt: string): string {
    const pad = (n: number, len = 2) => String(n).padStart(len, "0");
    return fmt
      .replace("YYYY", String(d.getUTCFullYear()))
      .replace("MM", pad(d.getUTCMonth() + 1))
      .replace("DD", pad(d.getUTCDate()))
      .replace("HH", pad(d.getUTCHours()))
      .replace("mm", pad(d.getUTCMinutes()))
      .replace("ss", pad(d.getUTCSeconds()));
  }

  private is_leap(y: number): boolean {
    return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  }
}
