import { describe, it, expect, vi } from "vitest";
import { AgentHandler, type AgentAccess } from "@src/channels/commands/agent.handler.ts";
import type { CommandContext } from "@src/channels/commands/types.ts";

function make_agent_info(patch?: Record<string, unknown>) {
  return {
    id: "sub-abc", role: "implementer", status: "running",
    label: "코드 구현", created_at: "2026-03-01T00:00:00Z",
    ...patch,
  };
}

function make_access(overrides?: Partial<AgentAccess>): AgentAccess {
  return {
    list: vi.fn().mockReturnValue([]),
    list_running: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
    cancel: vi.fn().mockReturnValue(false),
    get_running_count: vi.fn().mockReturnValue(0),
    ...overrides,
  };
}

function make_ctx(args: string[] = []): CommandContext & { replies: string[] } {
  const replies: string[] = [];
  return {
    provider: "telegram" as never,
    message: {
      id: "msg-1", provider: "telegram", channel: "telegram",
      sender_id: "user-1", chat_id: "chat-1", content: `/agent ${args.join(" ")}`,
      at: new Date().toISOString(), metadata: {},
    },
    command: { raw: `/agent ${args.join(" ")}`, name: "agent", args, args_lower: args.map((a) => a.toLowerCase()) },
    text: `/agent ${args.join(" ")}`,
    send_reply: async (content: string) => { replies.push(content); },
    replies,
  };
}

describe("AgentHandler", () => {
  it("can_handle — /agent 및 한글 별칭", () => {
    const handler = new AgentHandler(make_access());
    expect(handler.can_handle(make_ctx())).toBe(true);

    const ctx_kr = make_ctx();
    ctx_kr.command!.name = "에이전트";
    expect(handler.can_handle(ctx_kr)).toBe(true);
  });

  it("/agent — 에이전트 없으면 안내", async () => {
    const handler = new AgentHandler(make_access());
    const ctx = make_ctx();
    await handler.handle(ctx);

    expect(ctx.replies[0]).toContain("등록된 서브에이전트가 없습니다");
  });

  it("/agent — 에이전트 목록 표시", async () => {
    const a = make_agent_info();
    const handler = new AgentHandler(make_access({
      list: vi.fn().mockReturnValue([a]),
      get_running_count: vi.fn().mockReturnValue(1),
    }));
    const ctx = make_ctx();
    await handler.handle(ctx);

    expect(ctx.replies[0]).toContain("서브에이전트 1개");
    expect(ctx.replies[0]).toContain("실행 중 1개");
    expect(ctx.replies[0]).toContain("sub-abc");
    expect(ctx.replies[0]).toContain("implementer");
  });

  it("/agent running — 실행 중인 에이전트만", async () => {
    const a = make_agent_info();
    const handler = new AgentHandler(make_access({
      list_running: vi.fn().mockReturnValue([a]),
    }));
    const ctx = make_ctx(["running"]);
    await handler.handle(ctx);

    expect(ctx.replies[0]).toContain("실행 중 1개");
    expect(ctx.replies[0]).toContain("sub-abc");
  });

  it("/agent running — 실행 중인 에이전트 없을 때", async () => {
    const handler = new AgentHandler(make_access());
    const ctx = make_ctx(["running"]);
    await handler.handle(ctx);

    expect(ctx.replies[0]).toContain("실행 중인 서브에이전트가 없습니다");
  });

  it("/agent status <id> — 상세 표시", async () => {
    const a = make_agent_info();
    const handler = new AgentHandler(make_access({
      get: vi.fn().mockReturnValue(a),
    }));
    const ctx = make_ctx(["status", "sub-abc"]);
    await handler.handle(ctx);

    expect(ctx.replies[0]).toContain("서브에이전트 상세");
    expect(ctx.replies[0]).toContain("sub-abc");
    expect(ctx.replies[0]).toContain("implementer");
  });

  it("/agent status — ID 없으면 사용법 안내", async () => {
    const handler = new AgentHandler(make_access());
    const ctx = make_ctx(["status"]);
    await handler.handle(ctx);

    expect(ctx.replies[0]).toContain("사용법");
  });

  it("/agent cancel <id> — 취소 성공", async () => {
    const handler = new AgentHandler(make_access({
      cancel: vi.fn().mockReturnValue(true),
    }));
    const ctx = make_ctx(["cancel", "sub-abc"]);
    await handler.handle(ctx);

    expect(ctx.replies[0]).toContain("취소됨");
    expect(ctx.replies[0]).toContain("sub-abc");
  });

  it("/agent cancel <id> — 취소 실패 (없거나 종료됨)", async () => {
    const handler = new AgentHandler(make_access());
    const ctx = make_ctx(["cancel", "no-agent"]);
    await handler.handle(ctx);

    expect(ctx.replies[0]).toContain("취소할 수 없습니다");
  });

  it("/agent cancel all — 전체 취소", async () => {
    const a1 = make_agent_info({ id: "sub-1" });
    const a2 = make_agent_info({ id: "sub-2" });
    const handler = new AgentHandler(make_access({
      list_running: vi.fn().mockReturnValue([a1, a2]),
      cancel: vi.fn().mockReturnValue(true),
    }));
    const ctx = make_ctx(["cancel", "all"]);
    await handler.handle(ctx);

    expect(ctx.replies[0]).toContain("2/2개 서브에이전트 취소됨");
  });

  it("/agent cancel all — 실행 중 없으면 안내", async () => {
    const handler = new AgentHandler(make_access());
    const ctx = make_ctx(["cancel", "all"]);
    await handler.handle(ctx);

    expect(ctx.replies[0]).toContain("취소할 실행 중인 서브에이전트가 없습니다");
  });

  it("20개 초과 에이전트는 잘림", async () => {
    const agents = Array.from({ length: 25 }, (_, i) => make_agent_info({ id: `sub-${i}` }));
    const handler = new AgentHandler(make_access({
      list: vi.fn().mockReturnValue(agents),
      get_running_count: vi.fn().mockReturnValue(0),
    }));
    const ctx = make_ctx();
    await handler.handle(ctx);

    expect(ctx.replies[0]).toContain("서브에이전트 25개");
    expect(ctx.replies[0]).toContain("외 5개");
  });
});
