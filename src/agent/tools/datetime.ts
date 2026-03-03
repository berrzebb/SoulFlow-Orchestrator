import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

/** 에이전트가 현재 시간 조회 및 날짜 연산을 수행할 수 있는 도구. */
export class DateTimeTool extends Tool {
  readonly name = "datetime";
  readonly description = "현재 날짜/시간 조회 및 포맷 변환. action=now|format|diff";
  readonly parameters: JsonSchema = {
    type: "object",
    required: ["action"],
    properties: {
      action: { type: "string", enum: ["now", "format", "diff"], description: "수행할 작업" },
      tz: { type: "string", description: "타임존 ID (예: Asia/Seoul, UTC, America/New_York). 기본: UTC" },
      iso: { type: "string", description: "format/diff에서 입력 날짜 (ISO 8601)" },
      other_iso: { type: "string", description: "diff에서 비교할 날짜 (ISO 8601)" },
    },
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "now").trim();
    const tz = String(params.tz || "UTC").trim();

    if (action === "now") {
      const now = new Date();
      try {
        const localized = now.toLocaleString("sv-SE", { timeZone: tz, hour12: false });
        return JSON.stringify({ iso: now.toISOString(), localized, tz, unix_ms: now.getTime() });
      } catch {
        return `Error: invalid timezone "${tz}"`;
      }
    }

    if (action === "format") {
      const iso = String(params.iso || "").trim();
      if (!iso) return "Error: iso is required for format action";
      const d = new Date(iso);
      if (isNaN(d.getTime())) return `Error: invalid date "${iso}"`;
      try {
        const localized = d.toLocaleString("sv-SE", { timeZone: tz, hour12: false });
        return JSON.stringify({ iso: d.toISOString(), localized, tz, unix_ms: d.getTime() });
      } catch {
        return `Error: invalid timezone "${tz}"`;
      }
    }

    if (action === "diff") {
      const iso = String(params.iso || "").trim();
      const other_iso = String(params.other_iso || "").trim();
      if (!iso || !other_iso) return "Error: iso and other_iso are both required for diff action";
      const a = new Date(iso);
      const b = new Date(other_iso);
      if (isNaN(a.getTime())) return `Error: invalid date "${iso}"`;
      if (isNaN(b.getTime())) return `Error: invalid date "${other_iso}"`;
      const diff_ms = b.getTime() - a.getTime();
      const abs_ms = Math.abs(diff_ms);
      return JSON.stringify({
        diff_ms,
        seconds: Math.round(abs_ms / 1_000),
        minutes: Math.round(abs_ms / 60_000),
        hours: Math.round(abs_ms / 3_600_000),
        days: Math.round(abs_ms / 86_400_000),
        direction: diff_ms >= 0 ? "b_after_a" : "b_before_a",
      });
    }

    return `Error: unsupported action "${action}"`;
  }
}
