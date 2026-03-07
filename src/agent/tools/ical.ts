/** iCal 도구 — iCalendar (.ics) 이벤트 생성/파싱. */

import { randomBytes } from "node:crypto";
import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

type CalEvent = { summary: string; dtstart: string; dtend?: string; description?: string; location?: string; uid?: string; status?: string; organizer?: string };

export class IcalTool extends Tool {
  readonly name = "ical";
  readonly category = "data" as const;
  readonly description = "iCalendar (.ics) utilities: generate, parse, add_event, validate.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["generate", "parse", "add_event", "validate"], description: "iCal operation" },
      events: { type: "string", description: "JSON array of events [{summary, dtstart, dtend, description, location}]" },
      event: { type: "string", description: "JSON event object (add_event)" },
      input: { type: "string", description: "ICS content (parse/add_event/validate)" },
      calendar_name: { type: "string", description: "Calendar name (default: Calendar)" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "generate");

    switch (action) {
      case "generate": {
        let events: CalEvent[];
        try { events = JSON.parse(String(params.events || "[]")); } catch { return "Error: events must be valid JSON array"; }
        const name = String(params.calendar_name || "Calendar");
        return this.generate_ics(name, events);
      }
      case "parse": {
        const input = String(params.input || "");
        return JSON.stringify(this.parse_ics(input));
      }
      case "add_event": {
        const input = String(params.input || "");
        let event: CalEvent;
        try { event = JSON.parse(String(params.event || "{}")); } catch { return "Error: event must be valid JSON"; }
        const event_block = this.event_to_ics(event);
        const insert_pos = input.lastIndexOf("END:VCALENDAR");
        if (insert_pos === -1) return "Error: invalid ICS — no END:VCALENDAR found";
        return input.slice(0, insert_pos) + event_block + "\n" + input.slice(insert_pos);
      }
      case "validate": {
        const input = String(params.input || "");
        const issues: string[] = [];
        if (!input.includes("BEGIN:VCALENDAR")) issues.push("missing BEGIN:VCALENDAR");
        if (!input.includes("END:VCALENDAR")) issues.push("missing END:VCALENDAR");
        if (!input.includes("VERSION:2.0")) issues.push("missing VERSION:2.0");
        const event_count = (input.match(/BEGIN:VEVENT/g) || []).length;
        const end_count = (input.match(/END:VEVENT/g) || []).length;
        if (event_count !== end_count) issues.push(`mismatched VEVENT blocks: ${event_count} begin vs ${end_count} end`);
        return JSON.stringify({ valid: issues.length === 0, issues, event_count });
      }
      default:
        return `Error: unsupported action "${action}"`;
    }
  }

  private generate_ics(name: string, events: CalEvent[]): string {
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      `PRODID:-//SoulFlow//${name}//EN`,
      `X-WR-CALNAME:${name}`,
    ];
    for (const event of events) {
      lines.push(this.event_to_ics(event));
    }
    lines.push("END:VCALENDAR");
    return lines.join("\r\n");
  }

  private event_to_ics(event: CalEvent): string {
    const uid = event.uid || `${randomBytes(8).toString("hex")}@soulflow`;
    const lines = [
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTAMP:${this.format_date(new Date())}`,
      `DTSTART:${this.normalize_date(event.dtstart)}`,
    ];
    if (event.dtend) lines.push(`DTEND:${this.normalize_date(event.dtend)}`);
    lines.push(`SUMMARY:${this.escape_ical(event.summary)}`);
    if (event.description) lines.push(`DESCRIPTION:${this.escape_ical(event.description)}`);
    if (event.location) lines.push(`LOCATION:${this.escape_ical(event.location)}`);
    if (event.status) lines.push(`STATUS:${event.status.toUpperCase()}`);
    if (event.organizer) lines.push(`ORGANIZER:mailto:${event.organizer}`);
    lines.push("END:VEVENT");
    return lines.join("\r\n");
  }

  private parse_ics(input: string): { calendar_name: string; events: CalEvent[]; count: number } {
    const cal_name = this.extract_prop(input, "X-WR-CALNAME") || this.extract_prop(input, "PRODID") || "Unknown";
    const events: CalEvent[] = [];
    const event_re = /BEGIN:VEVENT([\s\S]*?)END:VEVENT/g;
    let m: RegExpExecArray | null;
    while ((m = event_re.exec(input))) {
      const block = m[1]!;
      events.push({
        summary: this.extract_prop(block, "SUMMARY") || "",
        dtstart: this.extract_prop(block, "DTSTART") || "",
        dtend: this.extract_prop(block, "DTEND") || undefined,
        description: this.extract_prop(block, "DESCRIPTION") || undefined,
        location: this.extract_prop(block, "LOCATION") || undefined,
        uid: this.extract_prop(block, "UID") || undefined,
        status: this.extract_prop(block, "STATUS") || undefined,
      });
    }
    return { calendar_name: cal_name, events, count: events.length };
  }

  private extract_prop(block: string, prop: string): string | null {
    const re = new RegExp(`^${prop}(?:;[^:]*)?:(.*)$`, "mi");
    const m = re.exec(block);
    return m ? m[1]!.trim().replace(/\\n/g, "\n").replace(/\\,/g, ",").replace(/\\\\/g, "\\") : null;
  }

  private format_date(d: Date): string {
    return d.toISOString().replace(/[-:]/g, "").split(".")[0]! + "Z";
  }

  private normalize_date(str: string): string {
    if (/^\d{8}T\d{6}/.test(str)) return str;
    try {
      return this.format_date(new Date(str));
    } catch {
      return str;
    }
  }

  private escape_ical(str: string): string {
    return str.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/\n/g, "\\n");
  }
}
