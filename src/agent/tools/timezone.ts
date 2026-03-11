/** Timezone 도구 — 타임존 변환/목록/DST 정보. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";
import { now_iso } from "../../utils/common.js";

interface TzInfo { id: string; offset: number; abbr: string; name: string; }

const TIMEZONES: TzInfo[] = [
  { id: "UTC", offset: 0, abbr: "UTC", name: "Coordinated Universal Time" },
  { id: "America/New_York", offset: -5, abbr: "EST", name: "Eastern Time" },
  { id: "America/Chicago", offset: -6, abbr: "CST", name: "Central Time" },
  { id: "America/Denver", offset: -7, abbr: "MST", name: "Mountain Time" },
  { id: "America/Los_Angeles", offset: -8, abbr: "PST", name: "Pacific Time" },
  { id: "America/Anchorage", offset: -9, abbr: "AKST", name: "Alaska Time" },
  { id: "Pacific/Honolulu", offset: -10, abbr: "HST", name: "Hawaii Time" },
  { id: "America/Toronto", offset: -5, abbr: "EST", name: "Eastern Time (Canada)" },
  { id: "America/Vancouver", offset: -8, abbr: "PST", name: "Pacific Time (Canada)" },
  { id: "America/Sao_Paulo", offset: -3, abbr: "BRT", name: "Brasilia Time" },
  { id: "America/Argentina/Buenos_Aires", offset: -3, abbr: "ART", name: "Argentina Time" },
  { id: "America/Mexico_City", offset: -6, abbr: "CST", name: "Mexico City Time" },
  { id: "Europe/London", offset: 0, abbr: "GMT", name: "Greenwich Mean Time" },
  { id: "Europe/Paris", offset: 1, abbr: "CET", name: "Central European Time" },
  { id: "Europe/Berlin", offset: 1, abbr: "CET", name: "Central European Time" },
  { id: "Europe/Moscow", offset: 3, abbr: "MSK", name: "Moscow Time" },
  { id: "Europe/Istanbul", offset: 3, abbr: "TRT", name: "Turkey Time" },
  { id: "Europe/Warsaw", offset: 1, abbr: "CET", name: "Central European Time" },
  { id: "Europe/Stockholm", offset: 1, abbr: "CET", name: "Central European Time" },
  { id: "Asia/Tokyo", offset: 9, abbr: "JST", name: "Japan Standard Time" },
  { id: "Asia/Seoul", offset: 9, abbr: "KST", name: "Korea Standard Time" },
  { id: "Asia/Shanghai", offset: 8, abbr: "CST", name: "China Standard Time" },
  { id: "Asia/Hong_Kong", offset: 8, abbr: "HKT", name: "Hong Kong Time" },
  { id: "Asia/Taipei", offset: 8, abbr: "CST", name: "Taipei Time" },
  { id: "Asia/Singapore", offset: 8, abbr: "SGT", name: "Singapore Time" },
  { id: "Asia/Kolkata", offset: 5.5, abbr: "IST", name: "India Standard Time" },
  { id: "Asia/Dubai", offset: 4, abbr: "GST", name: "Gulf Standard Time" },
  { id: "Asia/Bangkok", offset: 7, abbr: "ICT", name: "Indochina Time" },
  { id: "Asia/Ho_Chi_Minh", offset: 7, abbr: "ICT", name: "Vietnam Time" },
  { id: "Asia/Jakarta", offset: 7, abbr: "WIB", name: "Western Indonesia Time" },
  { id: "Asia/Riyadh", offset: 3, abbr: "AST", name: "Arabian Standard Time" },
  { id: "Asia/Jerusalem", offset: 2, abbr: "IST", name: "Israel Standard Time" },
  { id: "Australia/Sydney", offset: 11, abbr: "AEDT", name: "Australian Eastern Time" },
  { id: "Australia/Melbourne", offset: 11, abbr: "AEDT", name: "Australian Eastern Time" },
  { id: "Australia/Perth", offset: 8, abbr: "AWST", name: "Australian Western Time" },
  { id: "Pacific/Auckland", offset: 13, abbr: "NZDT", name: "New Zealand Time" },
  { id: "Africa/Cairo", offset: 2, abbr: "EET", name: "Eastern European Time" },
  { id: "Africa/Lagos", offset: 1, abbr: "WAT", name: "West Africa Time" },
  { id: "Africa/Nairobi", offset: 3, abbr: "EAT", name: "East Africa Time" },
  { id: "Africa/Johannesburg", offset: 2, abbr: "SAST", name: "South Africa Time" },
];

export class TimezoneTool extends Tool {
  readonly name = "timezone";
  readonly category = "data" as const;
  readonly description = "Timezone utilities: convert, list, info, now, offset, search.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["convert", "list", "info", "now", "offset", "search"], description: "Operation" },
      datetime: { type: "string", description: "ISO 8601 datetime string" },
      from: { type: "string", description: "Source timezone" },
      to: { type: "string", description: "Target timezone" },
      timezone: { type: "string", description: "Timezone ID" },
      query: { type: "string", description: "Search query" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "now");

    switch (action) {
      case "convert": {
        const dt = String(params.datetime || now_iso());
        const from_tz = this.find_tz(String(params.from || "UTC"));
        const to_tz = this.find_tz(String(params.to || "UTC"));
        if (!from_tz) return JSON.stringify({ error: `unknown timezone: ${params.from}` });
        if (!to_tz) return JSON.stringify({ error: `unknown timezone: ${params.to}` });
        const date = new Date(dt);
        if (isNaN(date.getTime())) return JSON.stringify({ error: "invalid datetime" });
        const utc_ms = date.getTime() - from_tz.offset * 3600000;
        const target_ms = utc_ms + to_tz.offset * 3600000;
        const target_date = new Date(target_ms);
        return JSON.stringify({
          from: { timezone: from_tz.id, datetime: date.toISOString() },
          to: { timezone: to_tz.id, datetime: target_date.toISOString(), offset: to_tz.offset },
          offset_diff: to_tz.offset - from_tz.offset,
        });
      }
      case "list": {
        return JSON.stringify({ count: TIMEZONES.length, timezones: TIMEZONES.map((t) => ({ id: t.id, offset: t.offset, abbr: t.abbr })) });
      }
      case "info": {
        const tz = this.find_tz(String(params.timezone || "UTC"));
        if (!tz) return JSON.stringify({ error: `unknown timezone: ${params.timezone}` });
        const offset_str = `UTC${tz.offset >= 0 ? "+" : ""}${tz.offset}`;
        return JSON.stringify({ ...tz, offset_string: offset_str });
      }
      case "now": {
        const tz = this.find_tz(String(params.timezone || "UTC"));
        if (!tz) return JSON.stringify({ error: `unknown timezone: ${params.timezone}` });
        const now = new Date();
        const local_ms = now.getTime() + (now.getTimezoneOffset() * 60000) + (tz.offset * 3600000);
        const local = new Date(local_ms);
        return JSON.stringify({
          timezone: tz.id, abbr: tz.abbr,
          datetime: local.toISOString().replace("Z", ""),
          utc: now.toISOString(),
        });
      }
      case "offset": {
        const tz = this.find_tz(String(params.timezone || "UTC"));
        if (!tz) return JSON.stringify({ error: `unknown timezone: ${params.timezone}` });
        const hours = Math.floor(Math.abs(tz.offset));
        const mins = Math.round((Math.abs(tz.offset) - hours) * 60);
        const sign = tz.offset >= 0 ? "+" : "-";
        return JSON.stringify({ timezone: tz.id, offset_hours: tz.offset, offset_string: `${sign}${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}` });
      }
      case "search": {
        const q = String(params.query || "").toLowerCase();
        const results = TIMEZONES.filter((t) =>
          t.id.toLowerCase().includes(q) || t.name.toLowerCase().includes(q) || t.abbr.toLowerCase().includes(q));
        return JSON.stringify({ count: results.length, results });
      }
      default:
        return JSON.stringify({ error: `unknown action: ${action}` });
    }
  }

  private find_tz(id: string): TzInfo | undefined {
    const lower = id.toLowerCase();
    return TIMEZONES.find((t) => t.id.toLowerCase() === lower || t.abbr.toLowerCase() === lower);
  }
}
