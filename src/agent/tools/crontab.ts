/** Crontab 도구 — 사람이 읽는 크론 표현식 변환/검증/다음 실행 시각. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const DAY_ABBR: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

function parse_field(field: string, min: number, max: number): number[] {
  const results = new Set<number>();
  for (const part of field.split(",")) {
    const step_match = part.match(/^(.+)\/(\d+)$/);
    const step = step_match ? parseInt(step_match[2], 10) : 1;
    const range_part = step_match ? step_match[1] : part;
    if (range_part === "*") {
      for (let i = min; i <= max; i += step) results.add(i);
    } else if (range_part.includes("-")) {
      const [a, b] = range_part.split("-").map(Number);
      for (let i = a; i <= b; i += step) results.add(i);
    } else {
      results.add(parseInt(range_part, 10));
    }
  }
  return [...results].filter((n) => n >= min && n <= max).sort((a, b) => a - b);
}

function next_match(cron: string, from: Date, count: number): Date[] {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return [];
  const [min_f, hour_f, dom_f, mon_f, dow_f] = parts;
  const minutes = parse_field(min_f, 0, 59);
  const hours = parse_field(hour_f, 0, 23);
  const doms = parse_field(dom_f, 1, 31);
  const months = parse_field(mon_f, 1, 12);
  const dows = parse_field(dow_f, 0, 7).map((d) => d === 7 ? 0 : d);
  const results: Date[] = [];
  const d = new Date(from);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  const limit = 525960;
  for (let i = 0; i < limit && results.length < count; i++) {
    if (months.includes(d.getMonth() + 1) && doms.includes(d.getDate()) &&
        dows.includes(d.getDay()) && hours.includes(d.getHours()) && minutes.includes(d.getMinutes())) {
      results.push(new Date(d));
    }
    d.setMinutes(d.getMinutes() + 1);
  }
  return results;
}

export class CrontabTool extends Tool {
  readonly name = "crontab";
  readonly category = "data" as const;
  readonly description = "Cron expressions: human_to_cron, cron_to_human, next_n, validate, is_due, overlap.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["human_to_cron", "cron_to_human", "next_n", "validate", "is_due", "overlap"], description: "Operation" },
      expression: { type: "string", description: "Cron expression (5 fields)" },
      human: { type: "string", description: "Human-readable schedule description" },
      count: { type: "integer", description: "Number of next occurrences (default 5)" },
      from: { type: "string", description: "Start time ISO string" },
      expressions: { type: "string", description: "JSON array of cron expressions for overlap check" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "validate");

    switch (action) {
      case "human_to_cron": {
        const human = String(params.human || "").toLowerCase().trim();
        const cron = this.human_parse(human);
        if (!cron) return JSON.stringify({ error: "cannot parse expression", hint: "Try: 'every 5 minutes', 'daily at 9', 'every monday at 14:30'" });
        return JSON.stringify({ human, cron, next: next_match(cron, new Date(), 3).map((d) => d.toISOString()) });
      }
      case "cron_to_human": {
        const expr = String(params.expression || "");
        const parts = expr.trim().split(/\s+/);
        if (parts.length !== 5) return JSON.stringify({ error: "invalid cron: need 5 fields" });
        const desc = this.describe(parts);
        return JSON.stringify({ expression: expr, human: desc });
      }
      case "next_n": {
        const expr = String(params.expression || "");
        const count = Math.min(50, Math.max(1, Number(params.count || 5)));
        const from = params.from ? new Date(String(params.from)) : new Date();
        const dates = next_match(expr, from, count);
        return JSON.stringify({ expression: expr, from: from.toISOString(), next: dates.map((d) => d.toISOString()) });
      }
      case "validate": {
        const expr = String(params.expression || "");
        const parts = expr.trim().split(/\s+/);
        const valid = parts.length === 5 && parts.every((p) => /^[\d,*/-]+$/.test(p));
        return JSON.stringify({ expression: expr, valid, fields: parts.length });
      }
      case "is_due": {
        const expr = String(params.expression || "");
        const now = params.from ? new Date(String(params.from)) : new Date();
        const dates = next_match(expr, new Date(now.getTime() - 60000), 1);
        const due = dates.length > 0 && Math.abs(dates[0].getTime() - now.getTime()) < 60000;
        return JSON.stringify({ expression: expr, time: now.toISOString(), is_due: due });
      }
      case "overlap": {
        let expressions: string[];
        try { expressions = JSON.parse(String(params.expressions || "[]")); } catch { return JSON.stringify({ error: "invalid expressions JSON" }); }
        const from = params.from ? new Date(String(params.from)) : new Date();
        const all_times = expressions.map((e) => next_match(e, from, 20).map((d) => d.getTime()));
        const overlaps: { time: string; expressions: number[] }[] = [];
        const time_map = new Map<number, number[]>();
        all_times.forEach((times, idx) => {
          for (const t of times) {
            const arr = time_map.get(t) || [];
            arr.push(idx);
            time_map.set(t, arr);
          }
        });
        for (const [t, idxs] of time_map) {
          if (idxs.length > 1) overlaps.push({ time: new Date(t).toISOString(), expressions: idxs });
        }
        return JSON.stringify({ expressions, overlaps, has_overlap: overlaps.length > 0 });
      }
      default:
        return JSON.stringify({ error: `unknown action: ${action}` });
    }
  }

  private human_parse(text: string): string | null {
    if (/every\s+(\d+)\s+min/.test(text)) {
      const m = text.match(/every\s+(\d+)\s+min/)!;
      return `*/${m[1]} * * * *`;
    }
    if (/every\s+(\d+)\s+hour/.test(text)) {
      const m = text.match(/every\s+(\d+)\s+hour/)!;
      return `0 */${m[1]} * * *`;
    }
    if (/every\s+minute/.test(text)) return "* * * * *";
    if (/every\s+hour/.test(text)) return "0 * * * *";
    if (/daily\s+at\s+(\d{1,2})(?::(\d{2}))?/.test(text)) {
      const m = text.match(/daily\s+at\s+(\d{1,2})(?::(\d{2}))?/)!;
      return `${m[2] || "0"} ${m[1]} * * *`;
    }
    for (const [abbr, num] of Object.entries(DAY_ABBR)) {
      const full = DAYS[num];
      const re = new RegExp(`every\\s+(?:${full}|${abbr})\\s+at\\s+(\\d{1,2})(?::(\\d{2}))?`);
      if (re.test(text)) {
        const m = text.match(re)!;
        return `${m[2] || "0"} ${m[1]} * * ${num}`;
      }
      if (new RegExp(`every\\s+(?:${full}|${abbr})`).test(text)) return `0 0 * * ${num}`;
    }
    if (/midnight/.test(text)) return "0 0 * * *";
    if (/noon/.test(text)) return "0 12 * * *";
    if (/weekday/.test(text)) {
      const m = text.match(/at\s+(\d{1,2})(?::(\d{2}))?/);
      return m ? `${m[2] || "0"} ${m[1]} * * 1-5` : "0 9 * * 1-5";
    }
    return null;
  }

  private describe(parts: string[]): string {
    const [min, hour, dom, mon, dow] = parts;
    const pieces: string[] = [];
    if (min.startsWith("*/")) pieces.push(`every ${min.slice(2)} minutes`);
    else if (hour.startsWith("*/")) pieces.push(`every ${hour.slice(2)} hours at minute ${min}`);
    else if (min === "*" && hour === "*") pieces.push("every minute");
    else if (min !== "*" && hour === "*") pieces.push(`at minute ${min} of every hour`);
    else pieces.push(`at ${hour.padStart(2, "0")}:${min.padStart(2, "0")}`);
    if (dom !== "*") pieces.push(`on day ${dom}`);
    if (mon !== "*") pieces.push(`in month ${mon}`);
    if (dow !== "*") {
      const days = parse_field(dow, 0, 7).map((d) => DAYS[d === 7 ? 0 : d] || String(d));
      pieces.push(`on ${days.join(", ")}`);
    }
    return pieces.join(" ");
  }
}
