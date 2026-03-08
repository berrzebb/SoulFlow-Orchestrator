/**
 * IcalTool — iCalendar 이벤트 생성/파싱/추가/검증 테스트.
 */
import { describe, it, expect } from "vitest";
import { IcalTool } from "../../../src/agent/tools/ical.js";

const tool = new IcalTool();

async function exec(params: Record<string, unknown>): Promise<unknown> {
  const result = await tool.execute(params);
  try { return JSON.parse(String(result)); } catch { return result; }
}

const EVENTS = JSON.stringify([
  { summary: "Team Meeting", dtstart: "20240101T100000Z", dtend: "20240101T110000Z", description: "Weekly sync", location: "Zoom" },
  { summary: "Lunch", dtstart: "20240101T120000Z" },
]);

describe("IcalTool — generate", () => {
  it("ICS 파일 생성", async () => {
    const r = String(await exec({ action: "generate", events: EVENTS }));
    expect(r).toContain("BEGIN:VCALENDAR");
    expect(r).toContain("VERSION:2.0");
    expect(r).toContain("END:VCALENDAR");
    expect(r).toContain("BEGIN:VEVENT");
    expect(r).toContain("END:VEVENT");
    expect(r).toContain("SUMMARY:Team Meeting");
    expect(r).toContain("DTSTART:20240101T100000Z");
    expect(r).toContain("DTEND:20240101T110000Z");
    expect(r).toContain("DESCRIPTION:Weekly sync");
    expect(r).toContain("LOCATION:Zoom");
  });

  it("calendar_name 포함", async () => {
    const r = String(await exec({ action: "generate", events: EVENTS, calendar_name: "My Calendar" }));
    expect(r).toContain("X-WR-CALNAME:My Calendar");
  });

  it("빈 이벤트 목록", async () => {
    const r = String(await exec({ action: "generate", events: "[]" }));
    expect(r).toContain("BEGIN:VCALENDAR");
    expect(r).not.toContain("BEGIN:VEVENT");
  });

  it("잘못된 events JSON → Error", async () => {
    expect(String(await exec({ action: "generate", events: "bad" }))).toContain("Error");
  });

  it("선택 필드 없는 이벤트 (dtend 없음)", async () => {
    const r = String(await exec({ action: "generate", events: JSON.stringify([{ summary: "Solo", dtstart: "20240101T090000Z" }]) }));
    expect(r).toContain("SUMMARY:Solo");
    expect(r).not.toContain("DTEND");
  });

  it("status, organizer 필드 포함", async () => {
    const events = JSON.stringify([{
      summary: "Important", dtstart: "20240101T090000Z", status: "confirmed", organizer: "host@example.com",
    }]);
    const r = String(await exec({ action: "generate", events }));
    expect(r).toContain("STATUS:CONFIRMED");
    expect(r).toContain("ORGANIZER:mailto:host@example.com");
  });
});

describe("IcalTool — parse", () => {
  it("ICS 파싱", async () => {
    const ics = String(await exec({ action: "generate", events: EVENTS, calendar_name: "Test Cal" }));
    const r = await exec({ action: "parse", input: ics }) as Record<string, unknown>;
    expect(r.count).toBe(2);
    expect(r.calendar_name).toBe("Test Cal");
    const events = r.events as { summary: string; dtstart: string }[];
    expect(events.some((e) => e.summary === "Team Meeting")).toBe(true);
    expect(events.some((e) => e.summary === "Lunch")).toBe(true);
  });

  it("설명/위치 파싱", async () => {
    const ics = String(await exec({ action: "generate", events: EVENTS }));
    const r = await exec({ action: "parse", input: ics }) as Record<string, unknown>;
    const events = r.events as Record<string, unknown>[];
    const meeting = events.find((e) => e.summary === "Team Meeting");
    expect(meeting?.description).toBe("Weekly sync");
    expect(meeting?.location).toBe("Zoom");
  });
});

describe("IcalTool — add_event", () => {
  it("기존 ICS에 이벤트 추가", async () => {
    const ics = String(await exec({ action: "generate", events: EVENTS }));
    const new_event = JSON.stringify({ summary: "Dinner", dtstart: "20240101T180000Z" });
    const r = String(await exec({ action: "add_event", input: ics, event: new_event }));
    expect(r).toContain("SUMMARY:Dinner");
    // 기존 이벤트도 유지
    expect(r).toContain("SUMMARY:Team Meeting");
  });

  it("END:VCALENDAR 없는 ICS → Error", async () => {
    const bad_ics = "BEGIN:VCALENDAR\nVERSION:2.0\n";
    const new_event = JSON.stringify({ summary: "Test", dtstart: "20240101T100000Z" });
    expect(String(await exec({ action: "add_event", input: bad_ics, event: new_event }))).toContain("Error");
  });

  it("잘못된 event JSON → Error", async () => {
    const ics = String(await exec({ action: "generate", events: EVENTS }));
    expect(String(await exec({ action: "add_event", input: ics, event: "bad" }))).toContain("Error");
  });
});

describe("IcalTool — validate", () => {
  it("유효한 ICS → valid: true", async () => {
    const ics = String(await exec({ action: "generate", events: EVENTS }));
    const r = await exec({ action: "validate", input: ics }) as Record<string, unknown>;
    expect(r.valid).toBe(true);
    expect(r.event_count).toBe(2);
  });

  it("BEGIN:VCALENDAR 없음 → issue", async () => {
    const r = await exec({ action: "validate", input: "END:VCALENDAR\nVERSION:2.0" }) as Record<string, unknown>;
    expect(r.valid).toBe(false);
    expect((r.issues as string[]).some((i) => i.includes("BEGIN"))).toBe(true);
  });

  it("VERSION:2.0 없음 → issue", async () => {
    const r = await exec({ action: "validate", input: "BEGIN:VCALENDAR\nEND:VCALENDAR" }) as Record<string, unknown>;
    expect(r.valid).toBe(false);
    expect((r.issues as string[]).some((i) => i.includes("VERSION"))).toBe(true);
  });

  it("VEVENT 블록 불일치 → issue", async () => {
    const ics = "BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\n";
    const r = await exec({ action: "validate", input: ics }) as Record<string, unknown>;
    expect(r.valid).toBe(false);
    expect((r.issues as string[]).some((i) => i.includes("VEVENT"))).toBe(true);
  });
});
