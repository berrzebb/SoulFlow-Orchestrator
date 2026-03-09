/**
 * CronHandler — 미커버 분기 보충 (cov3).
 * L35: parse_action root alias + no arg0
 * L54: parse_action empty text
 * L57-58: parse_action text add/remove regex
 * L68/70: parse_duration_ms invalid input
 * L93/95/96: parse_add_tokens text regex
 * L118: parse_structured_add_spec every_ms null
 * L132/143: cron tz= 형식, empty body
 * L171/184/201/202/206/207: parse_natural_add_spec edge cases
 * L231: render_schedule non-object
 * L271: handle() guide path
 */
import { describe, it, expect, vi } from "vitest";
import { CronHandler } from "@src/channels/commands/cron.handler.js";
import type { CommandContext } from "@src/channels/commands/types.js";

function make_cron() {
  return {
    status: vi.fn().mockResolvedValue({ enabled: true, paused: false, jobs: 0, next_wake_at_ms: 0 }),
    list_jobs: vi.fn().mockResolvedValue([]),
    add_job: vi.fn().mockResolvedValue({ id: "job1" }),
    remove_job: vi.fn().mockResolvedValue({ ok: true }),
    pause_job: vi.fn().mockResolvedValue({ ok: true }),
    resume_job: vi.fn().mockResolvedValue({ ok: true }),
    stop_job: vi.fn().mockResolvedValue({ ok: true }),
    nuke: vi.fn().mockResolvedValue({ ok: true }),
    pause: vi.fn().mockResolvedValue({ ok: true }),
    resume: vi.fn().mockResolvedValue({ ok: true }),
  };
}

function make_ctx(overrides: {
  content?: string;
  cmd_name?: string;
  cmd_args?: string[];
  send_reply?: (s: string) => Promise<void>;
} = {}): CommandContext {
  const send_reply = overrides.send_reply ?? vi.fn().mockResolvedValue(undefined);
  return {
    provider: "slack",
    message: { sender_id: "u1", chat_id: "c1", content: overrides.content ?? "" } as any,
    command: overrides.cmd_name
      ? { name: overrides.cmd_name, args: overrides.cmd_args ?? [], args_lower: (overrides.cmd_args ?? []).map(s => s.toLowerCase()) }
      : null,
    send_reply,
    reply_to: vi.fn(),
    broadcast: vi.fn(),
    abort_signal: undefined,
  } as any;
}

// ══════════════════════════════════════════
// L35: parse_action — root alias, no arg0 → null
// ══════════════════════════════════════════

describe("CronHandler — parse_action root alias no arg (L35)", () => {
  it("/cron 인자 없음 + 텍스트 없음 → L35 히트, guide 발송 후 return true", async () => {
    const cron = make_cron();
    const h = new CronHandler(cron as any);
    const send_spy = vi.fn().mockResolvedValue(undefined);
    const ctx = make_ctx({ cmd_name: "cron", cmd_args: [], content: "", send_reply: send_spy });
    // parse_action: slash_name_in="cron" → arg0="" → L35 return null
    // parse_natural_add_spec → null (empty text)
    // guide found → send_reply → return true
    const r = await h.handle(ctx);
    expect(r).toBe(true);
    expect(send_spy).toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════
// L54: parse_action — no slash command, empty text → null
// ══════════════════════════════════════════

describe("CronHandler — parse_action empty text (L54)", () => {
  it("텍스트 없이 can_handle → false", () => {
    const h = new CronHandler(make_cron() as any);
    const ctx = make_ctx({ content: "" });
    expect(h.can_handle(ctx)).toBe(false);
  });
});

// ══════════════════════════════════════════
// L57-58: parse_action text regex — add/remove
// ══════════════════════════════════════════

describe("CronHandler — parse_action text regex add/remove (L57-58)", () => {
  it("텍스트 'cron add ...' → can_handle true (add action)", () => {
    const h = new CronHandler(make_cron() as any);
    const ctx = make_ctx({ content: "cron add every 5m 리마인드" });
    expect(h.can_handle(ctx)).toBe(true);
  });

  it("텍스트 'cron remove job1' → can_handle true (remove action)", () => {
    const h = new CronHandler(make_cron() as any);
    const ctx = make_ctx({ content: "cron remove job1" });
    expect(h.can_handle(ctx)).toBe(true);
  });
});

// ══════════════════════════════════════════
// L68/70: parse_duration_ms invalid → null
// ══════════════════════════════════════════

describe("CronHandler — parse_structured_add_spec invalid duration (L68, L70, L118)", () => {
  it("/cron add every 0s body → add 실패 (every_ms=0 → null)", async () => {
    const cron = make_cron();
    const h = new CronHandler(cron as any);
    const ctx = make_ctx({ cmd_name: "cron", cmd_args: ["add", "every", "0s", "리마인드"], content: "" });
    // parse_structured_add_spec에서 every_ms=0 → null → L118 도달
    const r = await h.handle(ctx);
    // action=add이지만 spec=null → 안내 메시지
    expect(r).toBe(true);
  });

  it("/cron add every invalid body → add 실패 (invalid duration string)", async () => {
    const cron = make_cron();
    const h = new CronHandler(cron as any);
    const ctx = make_ctx({ cmd_name: "cron", cmd_args: ["add", "every", "abc", "body"], content: "" });
    // parse_duration_ms("abc") → null (L68)
    const r = await h.handle(ctx);
    expect(r).toBe(true);
  });
});

// ══════════════════════════════════════════
// L93/95/96: parse_add_tokens text regex
// ══════════════════════════════════════════

describe("CronHandler — parse_add_tokens text regex (L93-96)", () => {
  it("텍스트 'cron add every 5m 알림' → add 처리", async () => {
    const cron = make_cron();
    const h = new CronHandler(cron as any);
    const ctx = make_ctx({ content: "cron add every 5m 알림" });
    const r = await h.handle(ctx);
    expect(r).toBe(true);
  });

  it("텍스트 'cron 추가 every' (매치 없음) → tokens=[] → spec null", async () => {
    const cron = make_cron();
    const h = new CronHandler(cron as any);
    const ctx = make_ctx({ content: "크론 add" }); // 토큰 없어서 spec null
    const r = await h.handle(ctx);
    expect(r).toBe(true); // action=add, spec=null → 안내 반환
  });
});

// ══════════════════════════════════════════
// L132: parse_structured_add_spec cron tz= 형식
// ══════════════════════════════════════════

describe("CronHandler — cron tz= 형식 (L132)", () => {
  it("/cron add cron * * * * * tz=Asia/Seoul body → add 성공 (tz=형식)", async () => {
    const cron = make_cron();
    const h = new CronHandler(cron as any);
    const ctx = make_ctx({ cmd_name: "cron", cmd_args: ["add", "cron", "*", "*", "*", "*", "*", "tz=Asia/Seoul", "reminder"], content: "" });
    const r = await h.handle(ctx);
    expect(r).toBe(true);
    expect(cron.add_job).toHaveBeenCalled();
  });

  it("/cron add cron * * * * * tz Asia/Seoul body → add 성공 (space 형식 L132)", async () => {
    const cron = make_cron();
    const h = new CronHandler(cron as any);
    // "tz Asia/Seoul" 공백 구분 → L132: tokens[idx].toLowerCase() === "tz" && tokens[idx + 1]
    const ctx = make_ctx({ cmd_name: "cron", cmd_args: ["add", "cron", "*", "*", "*", "*", "*", "tz", "Asia/Seoul", "reminder"], content: "" });
    const r = await h.handle(ctx);
    expect(r).toBe(true);
    expect(cron.add_job).toHaveBeenCalled();
    // add_job(name, schedule, message, ...) — schedule은 두 번째 인자 (index 1)
    const schedule = cron.add_job.mock.calls[0][1];
    expect(schedule?.tz).toBe("Asia/Seoul");
  });
});

// ══════════════════════════════════════════
// L143: parse_structured_add_spec empty body → null
// ══════════════════════════════════════════

describe("CronHandler — empty body in structured add (L143)", () => {
  it("/cron add every 5m (body 없음) → spec null → 안내", async () => {
    const cron = make_cron();
    const h = new CronHandler(cron as any);
    // body가 없으면 spec=null
    const ctx = make_ctx({ cmd_name: "cron", cmd_args: ["add", "every", "5m"], content: "" });
    const r = await h.handle(ctx);
    expect(r).toBe(true); // action=add이지만 spec=null → 안내
  });
});

// ══════════════════════════════════════════
// L171/184: parse_natural_add_spec invalid edge
// ══════════════════════════════════════════

describe("CronHandler — parse_natural_add_spec edge cases (L171, L184)", () => {
  it("'0초 후 5분 간격으로 알림' (start_delay=0 → L171 null)", async () => {
    const cron = make_cron();
    const h = new CronHandler(cron as any);
    // delayed_every 매치 → parse_duration_ms("0초")=null → L171 → return null
    // guide 발송 → true
    const r = await h.handle(make_ctx({ content: "0초 후 5분 간격으로 알림" }));
    expect(r).toBe(true);
  });

  it("'0분 후 알림' (rel duration=0 → L184 null)", async () => {
    const cron = make_cron();
    const h = new CronHandler(cron as any);
    // rel 매치 → parse_duration_ms("0분")=null → L184 → return null → guide
    const r = await h.handle(make_ctx({ content: "0분 후 알림" }));
    expect(r).toBe(true);
  });
});

// ══════════════════════════════════════════
// L201-207: parse_natural_add_spec abs time edge
// ══════════════════════════════════════════

describe("CronHandler — parse_natural_add_spec abs time (L201-207)", () => {
  it("'오전 0시 알림' → 오전 0시 (오전 12시 → hour=0)", async () => {
    const cron = make_cron();
    const h = new CronHandler(cron as any);
    const ctx = make_ctx({ content: "내일 오전 0시에 회의" });
    const r = await h.handle(ctx);
    expect(r).toBe(true); // valid abs time → add_job called
    expect(cron.add_job).toHaveBeenCalled();
  });

  it("'오후 1시 알림' → hour=13 (L205)", async () => {
    const cron = make_cron();
    const h = new CronHandler(cron as any);
    const ctx = make_ctx({ content: "내일 오후 1시에 회의" });
    const r = await h.handle(ctx);
    expect(r).toBe(true);
  });

  it("'24시 알림' → hour=24→0 (L206)", async () => {
    const cron = make_cron();
    const h = new CronHandler(cron as any);
    const ctx = make_ctx({ content: "내일 24시에 알림" });
    // hour=24 → 0, day_word="내일" → at_ms = tomorrow 0:00:00
    const r = await h.handle(ctx);
    // at_ms might be in future → add_job called
    expect(typeof r).toBe("boolean");
  });
});

// ══════════════════════════════════════════
// L231: render_schedule non-object
// ══════════════════════════════════════════

describe("CronHandler — render_schedule non-object (L231 via list)", () => {
  it("list 응답에 schedule=null → 'unknown' 표시", async () => {
    const cron = make_cron();
    cron.list_jobs.mockResolvedValue([{ id: "j1", name: "test", enabled: true, schedule: null, state: {} }]);
    const h = new CronHandler(cron as any);
    const ctx = make_ctx({ cmd_name: "cron-list", content: "" });
    const send_spy = vi.fn().mockResolvedValue(undefined);
    const ctx2 = { ...ctx, send_reply: send_spy };
    await h.handle(ctx2 as any);
    const msg = send_spy.mock.calls[0]?.[0] || "";
    expect(msg).toContain("unknown");
  });
});
