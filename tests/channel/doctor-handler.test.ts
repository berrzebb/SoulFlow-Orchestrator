import { describe, it, expect, vi } from "vitest";
import { DoctorHandler, type DoctorAccess } from "@src/channels/commands/doctor.handler.ts";
import type { CommandContext } from "@src/channels/commands/types.ts";

function make_access(overrides?: Partial<DoctorAccess>): DoctorAccess {
  return {
    get_tool_count: vi.fn().mockReturnValue(12),
    get_skill_count: vi.fn().mockReturnValue(8),
    get_active_task_count: vi.fn().mockReturnValue(1),
    get_active_loop_count: vi.fn().mockReturnValue(2),
    list_backends: vi.fn().mockReturnValue(["claude_cli", "codex_cli"]),
    list_mcp_servers: vi.fn().mockReturnValue([
      { name: "fs-server", connected: true, tool_count: 5 },
      { name: "git-server", connected: false, tool_count: 0, error: "ENOENT" },
    ]),
    get_cron_job_count: vi.fn().mockReturnValue(3),
    ...overrides,
  };
}

function make_ctx(args: string[] = []): CommandContext & { replies: string[] } {
  const replies: string[] = [];
  return {
    provider: "slack" as never,
    message: {
      id: "msg-1", provider: "slack", channel: "slack",
      sender_id: "user-1", chat_id: "chat-1", content: `/doctor ${args.join(" ")}`,
      at: new Date().toISOString(), metadata: {},
    },
    command: { raw: `/doctor ${args.join(" ")}`, name: "doctor", args, args_lower: args.map((a) => a.toLowerCase()) },
    text: `/doctor ${args.join(" ")}`,
    send_reply: async (content: string) => { replies.push(content); },
    replies,
  };
}

describe("DoctorHandler", () => {
  it("can_handle — /doctor 및 한글 별칭 인식", () => {
    const handler = new DoctorHandler(make_access());
    expect(handler.can_handle(make_ctx())).toBe(true);

    const ctx_kr = make_ctx();
    ctx_kr.command!.name = "진단";
    expect(handler.can_handle(ctx_kr)).toBe(true);

    const ctx_health = make_ctx();
    ctx_health.command!.name = "health";
    expect(handler.can_handle(ctx_health)).toBe(true);
  });

  it("/doctor — 전체 진단 보고서", async () => {
    const handler = new DoctorHandler(make_access());
    const ctx = make_ctx();
    await handler.handle(ctx);

    expect(ctx.replies[0]).toContain("시스템 진단");
    expect(ctx.replies[0]).toContain("도구: 12개");
    expect(ctx.replies[0]).toContain("스킬: 8개");
    expect(ctx.replies[0]).toContain("claude_cli");
    expect(ctx.replies[0]).toContain("1/2개 연결");
    expect(ctx.replies[0]).toContain("크론 작업: 3개");
    expect(ctx.replies[0]).toContain("활성 태스크: 1개");
    expect(ctx.replies[0]).toContain("활성 에이전트 루프: 2개");
  });

  it("/doctor — async cron job count 처리", async () => {
    const handler = new DoctorHandler(make_access({
      get_cron_job_count: vi.fn().mockResolvedValue(7),
    }));
    const ctx = make_ctx();
    await handler.handle(ctx);

    expect(ctx.replies[0]).toContain("크론 작업: 7개");
  });

  it("/doctor mcp — MCP 서버 상태 상세", async () => {
    const handler = new DoctorHandler(make_access());
    const ctx = make_ctx(["mcp"]);
    await handler.handle(ctx);

    expect(ctx.replies[0]).toContain("MCP 서버 상태");
    expect(ctx.replies[0]).toContain("✅ fs-server");
    expect(ctx.replies[0]).toContain("도구 5개");
    expect(ctx.replies[0]).toContain("❌ git-server");
    expect(ctx.replies[0]).toContain("ENOENT");
  });

  it("/doctor mcp — MCP 서버 없을 때", async () => {
    const handler = new DoctorHandler(make_access({
      list_mcp_servers: vi.fn().mockReturnValue([]),
    }));
    const ctx = make_ctx(["mcp"]);
    await handler.handle(ctx);

    expect(ctx.replies[0]).toContain("등록된 MCP 서버가 없습니다");
  });

  it("/doctor backends — 백엔드 목록", async () => {
    const handler = new DoctorHandler(make_access());
    const ctx = make_ctx(["backends"]);
    await handler.handle(ctx);

    expect(ctx.replies[0]).toContain("에이전트 백엔드");
    expect(ctx.replies[0]).toContain("claude_cli");
    expect(ctx.replies[0]).toContain("codex_cli");
  });

  it("/doctor providers — backends와 동일", async () => {
    const handler = new DoctorHandler(make_access());
    const ctx = make_ctx(["providers"]);
    await handler.handle(ctx);

    expect(ctx.replies[0]).toContain("에이전트 백엔드");
  });
});
