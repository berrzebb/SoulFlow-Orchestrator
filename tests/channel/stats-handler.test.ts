import { describe, it, expect, vi } from "vitest";
import { StatsHandler, type StatsAccess } from "@src/channels/commands/stats.handler.ts";
import type { CommandContext } from "@src/channels/commands/types.ts";

function make_access(overrides?: Partial<StatsAccess>): StatsAccess {
  return {
    get_cd_score: vi.fn().mockReturnValue({ total: 35, events: [
      { indicator: "clarify", points: 10, context: "ask_user: 질문", at: "2026-03-01T00:00:00Z" },
      { indicator: "correct", points: 25, context: "exec: 3 errors", at: "2026-03-01T00:01:00Z" },
    ] }),
    reset_cd: vi.fn(),
    get_active_task_count: vi.fn().mockReturnValue(2),
    get_active_loop_count: vi.fn().mockReturnValue(1),
    ...overrides,
  };
}

function make_ctx(args: string[] = []): CommandContext & { replies: string[] } {
  const replies: string[] = [];
  return {
    provider: "telegram" as never,
    message: {
      id: "msg-1", provider: "telegram", channel: "telegram",
      sender_id: "user-1", chat_id: "chat-1", content: `/stats ${args.join(" ")}`,
      at: new Date().toISOString(), metadata: {},
    },
    command: { raw: `/stats ${args.join(" ")}`, name: "stats", args, args_lower: args.map((a) => a.toLowerCase()) },
    text: `/stats ${args.join(" ")}`,
    send_reply: async (content: string) => { replies.push(content); },
    replies,
  };
}

describe("StatsHandler", () => {
  it("can_handle — /stats, /통계, /cd 별칭 인식", () => {
    const handler = new StatsHandler(make_access());

    expect(handler.can_handle(make_ctx())).toBe(true);

    const ctx_kr = make_ctx();
    ctx_kr.command!.name = "통계";
    expect(handler.can_handle(ctx_kr)).toBe(true);

    const ctx_cd = make_ctx();
    ctx_cd.command!.name = "cd";
    expect(handler.can_handle(ctx_cd)).toBe(true);
  });

  it("/stats — 세션 통계 개요", async () => {
    const handler = new StatsHandler(make_access());
    const ctx = make_ctx();
    await handler.handle(ctx);

    expect(ctx.replies[0]).toContain("세션 통계");
    expect(ctx.replies[0]).toContain("CD 점수: 35");
    expect(ctx.replies[0]).toContain("주의");
    expect(ctx.replies[0]).toContain("clarify(+10): 1회");
    expect(ctx.replies[0]).toContain("correct(+25): 1회");
    expect(ctx.replies[0]).toContain("활성 태스크: 2개");
    expect(ctx.replies[0]).toContain("활성 루프: 1개");
  });

  it("/stats — CD 점수 0 이면 건강 표시", async () => {
    const handler = new StatsHandler(make_access({
      get_cd_score: vi.fn().mockReturnValue({ total: 0, events: [] }),
    }));
    const ctx = make_ctx();
    await handler.handle(ctx);

    expect(ctx.replies[0]).toContain("CD 점수: 0");
    expect(ctx.replies[0]).toContain("건강");
  });

  it("/stats — CD 점수 55 이면 경고 표시", async () => {
    const handler = new StatsHandler(make_access({
      get_cd_score: vi.fn().mockReturnValue({ total: 55, events: [] }),
    }));
    const ctx = make_ctx();
    await handler.handle(ctx);

    expect(ctx.replies[0]).toContain("경고");
  });

  it("/stats cd — CD 이벤트 상세 목록", async () => {
    const handler = new StatsHandler(make_access());
    const ctx = make_ctx(["cd"]);
    await handler.handle(ctx);

    expect(ctx.replies[0]).toContain("CD 이벤트 2건");
    expect(ctx.replies[0]).toContain("총 35점");
    expect(ctx.replies[0]).toContain("❓");
    expect(ctx.replies[0]).toContain("🔄");
  });

  it("/stats cd — 이벤트 없으면 안내", async () => {
    const handler = new StatsHandler(make_access({
      get_cd_score: vi.fn().mockReturnValue({ total: 0, events: [] }),
    }));
    const ctx = make_ctx(["cd"]);
    await handler.handle(ctx);

    expect(ctx.replies[0]).toContain("CD 이벤트가 없습니다");
  });

  it("/stats reset — CD 점수 초기화", async () => {
    const reset_cd = vi.fn();
    const handler = new StatsHandler(make_access({ reset_cd }));
    const ctx = make_ctx(["reset"]);
    await handler.handle(ctx);

    expect(reset_cd).toHaveBeenCalled();
    expect(ctx.replies[0]).toContain("초기화되었습니다");
  });

  it("/stats 초기화 — 한글 액션", async () => {
    const reset_cd = vi.fn();
    const handler = new StatsHandler(make_access({ reset_cd }));
    const ctx = make_ctx(["초기화"]);
    await handler.handle(ctx);

    expect(reset_cd).toHaveBeenCalled();
  });
});
