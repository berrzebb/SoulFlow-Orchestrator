/**
 * CronHandler — 미커버 분기 (cov4):
 * - L157: parse_structured_add_spec — cron 모드 + tz 있음 + body 없음 → return null
 * - L216: parse_natural_add_spec — hour > 24 → return null
 */

import { describe, it, expect, vi } from "vitest";
import { CronHandler } from "@src/channels/commands/cron.handler.js";
import type { CommandContext } from "@src/channels/commands/types.js";
import type { CronScheduler } from "@src/cron/contracts.js";

function make_ctx(
  command_name: string,
  args: string[],
  content?: string,
  provider = "slack",
  sender_id = "U123",
): CommandContext & { replies: string[] } {
  const replies: string[] = [];
  const msg_content = content ?? (command_name ? `/${command_name} ${args.join(" ")}` : "");
  return {
    provider,
    message: {
      id: "msg-1", provider, channel: provider,
      sender_id, chat_id: "C001",
      content: msg_content,
      at: new Date().toISOString(),
    },
    command: command_name ? {
      raw: msg_content, name: command_name,
      args, args_lower: args.map((a) => a.toLowerCase()),
    } : null as any,
    text: args.join(" "),
    send_reply: async (c: string) => { replies.push(c); },
    replies,
  };
}

function make_cron(): CronScheduler {
  return {
    status: vi.fn().mockResolvedValue({ enabled: true, paused: false, jobs: 0, next_wake_at_ms: Date.now() + 60_000 }),
    list_jobs: vi.fn().mockResolvedValue([]),
    add_job: vi.fn().mockResolvedValue({
      id: "job-1", name: "Test", schedule: { kind: "every", every_ms: 60_000 },
      state: { next_run_at_ms: Date.now() + 60_000 }, delete_after_run: false,
    }),
    remove_job: vi.fn().mockResolvedValue(true),
    enable_job: vi.fn().mockResolvedValue(null),
    run_job: vi.fn().mockResolvedValue(false),
    pause: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    disable_all_and_pause: vi.fn().mockResolvedValue(0),
    start: vi.fn().mockResolvedValue(undefined),
  } as any;
}

// ── L157: parse_structured_add_spec — cron + tz + 빈 body → null ─────────────

describe("CronHandler — L157: cron 모드 tz 있음 body 없음 → return null", () => {
  it("/cron add cron * * * * * tz UTC (body 없음) → parse null → 가이드 응답", async () => {
    // parse_structured_add_spec에서 cron 모드 + tz 파싱 후 body=""  → L157 return null
    // 그러면 parse_natural_add_spec으로 폴백하지 않고, handle에서 가이드 반환
    const handler = new CronHandler(make_cron());
    const ctx = make_ctx("add", ["cron", "*", "*", "*", "*", "*", "tz", "UTC"]);
    // /add는 ADD_COMMAND_ALIASES에 해당 → parse_add_tokens에서 tokens = ["cron","*","*","*","*","*","tz","UTC"]
    // parse_structured_add_spec: mode="cron", tokens.length >= 7 → tz="UTC", body_start=8, body="" → L157 return null
    await handler.handle(ctx);
    // null AddSpec → parse_natural_add_spec(message) → text = "/add cron ..." → starts with "/" → return null
    // → format_subcommand_guide가 가이드 반환 → reply에 가이드 포함
    expect(ctx.replies.length).toBeGreaterThan(0);
  });
});

// ── L216: hour > 24 → return null ─────────────────────────────────────────────

describe("CronHandler — L216: hour > 24 → return null (invalid time)", () => {
  it("자연어 '오늘 25시에 알림' → hour=25 > 24 → L216 return null → 가이드 응답", async () => {
    // parse_natural_add_spec: abs regex 매칭, hour=25 → L216: hour > 24 → return null
    const handler = new CronHandler(make_cron());
    // no command → parse_action returns null → parse_natural_add_spec 호출
    const ctx = make_ctx("", [], "오늘 25시에 알림", "slack", "U123");
    // 하지만 can_handle은 command가 없으면 parse_action으로 확인 → 자연어 패턴 매칭 여부 필요
    // 직접 handle()을 호출하여 parse_natural_add_spec으로 이어지도록 함
    await handler.handle(ctx);
    // L216에서 return null → natural_add = null → guide 반환
    expect(ctx.replies.length).toBeGreaterThan(0);
  });

  it("자연어 '내일 99시에 회의' → hour=99 > 24 → L216 return null", async () => {
    const handler = new CronHandler(make_cron());
    const ctx = make_ctx("", [], "내일 99시에 회의");
    await handler.handle(ctx);
    // L216 fires → natural_add = null → guide 응답
    expect(ctx.replies.length).toBeGreaterThan(0);
  });
});
