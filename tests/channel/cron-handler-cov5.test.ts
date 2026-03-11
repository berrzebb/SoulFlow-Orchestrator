/**
 * CronHandler — 미커버 분기 (cov5):
 * - L285: handle() → no action, no natural_add, format_subcommand_guide null → return false
 *
 * format_subcommand_guide를 null 반환으로 mock → L285 return false 커버.
 * L215 (body trim → ""): normalize_text가 trim하므로 abs 정규식 자체가 매칭 안 됨 → dead code.
 * L221 (hour > 23): meridiem 조정 후 hour ≤ 23 보장 → dead code.
 */
import { describe, it, expect, vi } from "vitest";

// registry mock → format_subcommand_guide가 null 반환하도록 설정 → L285 커버
vi.mock("@src/channels/commands/registry.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@src/channels/commands/registry.js")>();
  return {
    ...mod,
    format_subcommand_guide: vi.fn(() => null),
  };
});

import { CronHandler } from "@src/channels/commands/cron.handler.js";
import type { CommandContext } from "@src/channels/commands/types.js";
import type { CronScheduler } from "@src/cron/contracts.js";

function make_ctx(content: string, provider = "slack"): CommandContext & { replies: string[] } {
  const replies: string[] = [];
  return {
    provider,
    message: {
      id: "m1", provider, channel: provider,
      sender_id: "U123", chat_id: "C001",
      content,
      at: new Date().toISOString(),
    },
    command: null as any,
    text: content,
    send_reply: async (c: string) => { replies.push(c); },
    replies,
  };
}

function make_cron(): CronScheduler {
  return {
    status: vi.fn().mockResolvedValue({ enabled: true, paused: false, jobs: 0, next_wake_at_ms: 0 }),
    list_jobs: vi.fn().mockResolvedValue([]),
    add_job: vi.fn().mockResolvedValue(null),
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

// ── L285: format_subcommand_guide null → return false ────────────────────────

describe("CronHandler — L285: format_subcommand_guide null → return false", () => {
  it("no action, no natural_add, guide=null → L285: return false", async () => {
    // 어떤 명령/자연어 패턴에도 매칭되지 않는 임의 텍스트
    const handler = new CronHandler(make_cron());
    const ctx = make_ctx("무작위 텍스트로 어떤 크론 패턴도 아닌 메시지");

    const result = await handler.handle(ctx);

    // guide가 null → send_reply 호출 없이 false 반환 (L285)
    expect(result).toBe(false);
    expect(ctx.replies).toHaveLength(0);
  });

  it("일반 텍스트 (크론 아님) → guide=null → L285 return false", async () => {
    const handler = new CronHandler(make_cron());
    const ctx = make_ctx("안녕하세요 오늘 날씨 좋네요");

    const result = await handler.handle(ctx);
    expect(result).toBe(false);
  });
});
