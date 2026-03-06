import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

/** 에이전트가 현재 시간 조회 및 날짜 연산을 수행할 수 있는 도구. */
export class DateTimeTool extends Tool {
  readonly name = "datetime";
  readonly category = "memory" as const;
  readonly description = "날짜/시간: 현재 시간 조회, 포맷 변환, 차이 계산, 상대 시간 연산. action=now|format|diff|add";
  readonly parameters: JsonSchema = {
    type: "object",
    required: ["action"],
    properties: {
      action: { type: "string", enum: ["now", "format", "diff", "add"], description: "수행할 작업 (add: iso 기준으로 offset만큼 가감)" },
      tz: { type: "string", description: "타임존 ID (예: Asia/Seoul, UTC, America/New_York). 기본: UTC" },
      iso: { type: "string", description: "format/diff/add에서 입력 날짜 (ISO 8601). add에서 생략 시 현재 시간" },
      other_iso: { type: "string", description: "diff에서 비교할 날짜 (ISO 8601)" },
      offset: { type: "string", description: "add에서 사용. 예: '3d' (3일 후), '-2h' (2시간 전), '30m', '1w', '-1M' (1개월 전). 단위: s/m/h/d/w/M/y" },
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

    if (action === "add") {
      const offset_str = String(params.offset || "").trim();
      if (!offset_str) return "Error: offset is required for add action (e.g. '3d', '-2h', '30m')";
      const match = offset_str.match(/^(-?\d+)\s*([smhdwMy])$/);
      if (!match) return `Error: invalid offset "${offset_str}". Use format: <number><unit> (s/m/h/d/w/M/y)`;
      const amount = Number(match[1]);
      const unit = match[2];
      const base_iso = String(params.iso || "").trim();
      const base = base_iso ? new Date(base_iso) : new Date();
      if (isNaN(base.getTime())) return `Error: invalid date "${base_iso}"`;

      const result = new Date(base.getTime());
      switch (unit) {
        case "s": result.setTime(result.getTime() + amount * 1_000); break;
        case "m": result.setTime(result.getTime() + amount * 60_000); break;
        case "h": result.setTime(result.getTime() + amount * 3_600_000); break;
        case "d": result.setDate(result.getDate() + amount); break;
        case "w": result.setDate(result.getDate() + amount * 7); break;
        case "M": result.setMonth(result.getMonth() + amount); break;
        case "y": result.setFullYear(result.getFullYear() + amount); break;
      }

      try {
        const localized = result.toLocaleString("sv-SE", { timeZone: tz, hour12: false });
        return JSON.stringify({ iso: result.toISOString(), localized, tz, unix_ms: result.getTime(), offset: offset_str, base: base.toISOString() });
      } catch {
        return `Error: invalid timezone "${tz}"`;
      }
    }

    return `Error: unsupported action "${action}"`;
  }
}
