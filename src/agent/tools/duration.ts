/** Duration 도구 — ISO 8601 기간 파싱/포맷/연산/변환. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

type DurationParts = { years: number; months: number; weeks: number; days: number; hours: number; minutes: number; seconds: number };

export class DurationTool extends Tool {
  readonly name = "duration";
  readonly category = "data" as const;
  readonly description = "Duration utilities: parse, format, to_ms, from_ms, add, subtract, humanize, compare.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["parse", "format", "to_ms", "from_ms", "add", "subtract", "humanize", "compare"], description: "Duration operation" },
      duration: { type: "string", description: "ISO 8601 duration (e.g. P1DT2H30M) or human string (e.g. '2 hours 30 minutes')" },
      duration2: { type: "string", description: "Second duration for add/subtract/compare" },
      ms: { type: "number", description: "Milliseconds for from_ms" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "parse");

    switch (action) {
      case "parse": {
        const d = this.parse_duration(String(params.duration || ""));
        if (!d) return JSON.stringify({ error: "cannot parse duration" });
        return JSON.stringify({ parts: d, ms: this.to_ms(d) });
      }
      case "format": {
        const d = this.parse_duration(String(params.duration || ""));
        if (!d) return JSON.stringify({ error: "cannot parse duration" });
        return JSON.stringify({ iso: this.to_iso(d), human: this.humanize(d) });
      }
      case "to_ms": {
        const d = this.parse_duration(String(params.duration || ""));
        if (!d) return JSON.stringify({ error: "cannot parse duration" });
        return JSON.stringify({ ms: this.to_ms(d), seconds: Math.round(this.to_ms(d) / 1000) });
      }
      case "from_ms": {
        const ms = Number(params.ms ?? 0);
        const d = this.from_ms(ms);
        return JSON.stringify({ parts: d, iso: this.to_iso(d), human: this.humanize(d) });
      }
      case "add": {
        const a = this.parse_duration(String(params.duration || ""));
        const b = this.parse_duration(String(params.duration2 || ""));
        if (!a || !b) return JSON.stringify({ error: "cannot parse duration(s)" });
        const result = this.from_ms(this.to_ms(a) + this.to_ms(b));
        return JSON.stringify({ parts: result, iso: this.to_iso(result), ms: this.to_ms(a) + this.to_ms(b) });
      }
      case "subtract": {
        const a = this.parse_duration(String(params.duration || ""));
        const b = this.parse_duration(String(params.duration2 || ""));
        if (!a || !b) return JSON.stringify({ error: "cannot parse duration(s)" });
        const ms = Math.max(0, this.to_ms(a) - this.to_ms(b));
        const result = this.from_ms(ms);
        return JSON.stringify({ parts: result, iso: this.to_iso(result), ms });
      }
      case "humanize": {
        const d = this.parse_duration(String(params.duration || ""));
        if (!d) return JSON.stringify({ error: "cannot parse duration" });
        return JSON.stringify({ human: this.humanize(d) });
      }
      case "compare": {
        const a = this.parse_duration(String(params.duration || ""));
        const b = this.parse_duration(String(params.duration2 || ""));
        if (!a || !b) return JSON.stringify({ error: "cannot parse duration(s)" });
        const ms_a = this.to_ms(a), ms_b = this.to_ms(b);
        return JSON.stringify({ result: ms_a === ms_b ? 0 : ms_a > ms_b ? 1 : -1, a_ms: ms_a, b_ms: ms_b, equal: ms_a === ms_b });
      }
      default:
        return `Error: unsupported action "${action}"`;
    }
  }

  private parse_duration(input: string): DurationParts | null {
    if (!input) return null;

    const iso_match = input.match(/^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/);
    if (iso_match) {
      return {
        years: Number(iso_match[1] || 0),
        months: Number(iso_match[2] || 0),
        weeks: Number(iso_match[3] || 0),
        days: Number(iso_match[4] || 0),
        hours: Number(iso_match[5] || 0),
        minutes: Number(iso_match[6] || 0),
        seconds: Number(iso_match[7] || 0),
      };
    }

    const d: DurationParts = { years: 0, months: 0, weeks: 0, days: 0, hours: 0, minutes: 0, seconds: 0 };
    const patterns: [RegExp, keyof DurationParts][] = [
      [/(\d+)\s*(?:year|yr|y)s?/i, "years"],
      [/(\d+)\s*(?:month|mon)s?/i, "months"],
      [/(\d+)\s*(?:week|wk|w)s?/i, "weeks"],
      [/(\d+)\s*(?:day|d)s?/i, "days"],
      [/(\d+)\s*(?:hour|hr|h)s?/i, "hours"],
      [/(\d+)\s*(?:minute|min|m)s?(?!\w)/i, "minutes"],
      [/(\d+(?:\.\d+)?)\s*(?:second|sec|s)s?/i, "seconds"],
    ];
    let matched = false;
    for (const [re, field] of patterns) {
      const m = re.exec(input);
      if (m) { d[field] = Number(m[1]); matched = true; }
    }

    if (!matched) {
      const ms = Number(input);
      if (!isNaN(ms)) return this.from_ms(ms);
      return null;
    }
    return d;
  }

  private to_ms(d: DurationParts): number {
    return (
      d.years * 365.25 * 24 * 3600 * 1000 +
      d.months * 30.4375 * 24 * 3600 * 1000 +
      d.weeks * 7 * 24 * 3600 * 1000 +
      d.days * 24 * 3600 * 1000 +
      d.hours * 3600 * 1000 +
      d.minutes * 60 * 1000 +
      d.seconds * 1000
    );
  }

  private from_ms(ms: number): DurationParts {
    let remaining = Math.abs(ms);
    const days = Math.floor(remaining / (24 * 3600 * 1000));
    remaining %= 24 * 3600 * 1000;
    const hours = Math.floor(remaining / (3600 * 1000));
    remaining %= 3600 * 1000;
    const minutes = Math.floor(remaining / (60 * 1000));
    remaining %= 60 * 1000;
    const seconds = Math.round(remaining / 1000);
    return { years: 0, months: 0, weeks: 0, days, hours, minutes, seconds };
  }

  private to_iso(d: DurationParts): string {
    let date_part = "";
    if (d.years) date_part += `${d.years}Y`;
    if (d.months) date_part += `${d.months}M`;
    if (d.weeks) date_part += `${d.weeks}W`;
    if (d.days) date_part += `${d.days}D`;
    let time_part = "";
    if (d.hours) time_part += `${d.hours}H`;
    if (d.minutes) time_part += `${d.minutes}M`;
    if (d.seconds) time_part += `${d.seconds}S`;
    if (!date_part && !time_part) return "PT0S";
    return `P${date_part}${time_part ? `T${time_part}` : ""}`;
  }

  private humanize(d: DurationParts): string {
    const parts: string[] = [];
    if (d.years) parts.push(`${d.years} year${d.years !== 1 ? "s" : ""}`);
    if (d.months) parts.push(`${d.months} month${d.months !== 1 ? "s" : ""}`);
    if (d.weeks) parts.push(`${d.weeks} week${d.weeks !== 1 ? "s" : ""}`);
    if (d.days) parts.push(`${d.days} day${d.days !== 1 ? "s" : ""}`);
    if (d.hours) parts.push(`${d.hours} hour${d.hours !== 1 ? "s" : ""}`);
    if (d.minutes) parts.push(`${d.minutes} minute${d.minutes !== 1 ? "s" : ""}`);
    if (d.seconds) parts.push(`${d.seconds} second${d.seconds !== 1 ? "s" : ""}`);
    return parts.join(", ") || "0 seconds";
  }
}
