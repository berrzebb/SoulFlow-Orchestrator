import { describe, it, expect, vi } from "vitest";
import { SkillHandler, type SkillAccess } from "@src/channels/commands/skill.handler.ts";
import type { CommandContext } from "@src/channels/commands/types.ts";

function make_access(overrides?: Partial<SkillAccess>): SkillAccess {
  return {
    list_skills: vi.fn().mockReturnValue([
      { name: "memory", summary: "메모리 관리", type: "tool", source: "builtin_skills", always: false, model: null },
      { name: "weather", summary: "날씨 조회", type: "tool", source: "workspace_skills", always: true, model: "haiku" },
    ]),
    get_skill: vi.fn().mockReturnValue(null),
    list_role_skills: vi.fn().mockReturnValue([]),
    recommend: vi.fn().mockReturnValue([]),
    refresh: vi.fn().mockReturnValue(5),
    ...overrides,
  };
}

function make_ctx(args: string[] = []): CommandContext & { replies: string[] } {
  const replies: string[] = [];
  return {
    provider: "telegram" as never,
    message: {
      id: "msg-1", provider: "telegram", channel: "telegram",
      sender_id: "user-1", chat_id: "chat-1", content: `/skill ${args.join(" ")}`,
      at: new Date().toISOString(), metadata: {},
    },
    command: { raw: `/skill ${args.join(" ")}`, name: "skill", args, args_lower: args.map((a) => a.toLowerCase()) },
    text: `/skill ${args.join(" ")}`,
    send_reply: async (content: string) => { replies.push(content); },
    replies,
  };
}

describe("SkillHandler", () => {
  it("can_handle — /skill 및 한글 별칭 인식", () => {
    const handler = new SkillHandler(make_access());
    expect(handler.can_handle(make_ctx())).toBe(true);

    const ctx_kr = make_ctx();
    ctx_kr.command!.name = "스킬";
    expect(handler.can_handle(ctx_kr)).toBe(true);
  });

  it("can_handle — 관련없는 명령 무시", () => {
    const handler = new SkillHandler(make_access());
    const ctx = make_ctx();
    ctx.command = { raw: "/help", name: "help", args: [], args_lower: [] };
    expect(handler.can_handle(ctx)).toBe(false);
  });

  it("/skill (인자 없음) → 세부 기능 가이드 표시", async () => {
    const handler = new SkillHandler(make_access());
    const ctx = make_ctx();
    await handler.handle(ctx);

    expect(ctx.replies[0]).toContain("/skill list");
    expect(ctx.replies[0]).toContain("/skill info");
    expect(ctx.replies[0]).toContain("/skill roles");
  });

  it("/skill list — 상세 목록 표시 (source 포함)", async () => {
    const handler = new SkillHandler(make_access());
    const ctx = make_ctx(["list"]);
    await handler.handle(ctx);

    expect(ctx.replies[0]).toContain("builtin_skills");
    expect(ctx.replies[0]).toContain("[always]");
  });

  it("/skill info <name> — 스킬 상세 정보", async () => {
    const handler = new SkillHandler(make_access({
      get_skill: vi.fn().mockReturnValue({
        name: "weather", summary: "날씨 조회", type: "tool",
        source: "workspace_skills", always: true, model: "haiku",
        tools: ["web_search"], requirements: ["API_KEY"], role: null,
        shared_protocols: [],
      }),
    }));
    const ctx = make_ctx(["info", "weather"]);
    await handler.handle(ctx);

    expect(ctx.replies[0]).toContain("weather");
    expect(ctx.replies[0]).toContain("web_search");
    expect(ctx.replies[0]).toContain("API_KEY");
  });

  it("/skill info — 이름 없으면 사용법 안내", async () => {
    const handler = new SkillHandler(make_access());
    const ctx = make_ctx(["info"]);
    await handler.handle(ctx);

    expect(ctx.replies[0]).toContain("/skill info");
  });

  it("/skill roles — 역할 스킬 목록", async () => {
    const handler = new SkillHandler(make_access({
      list_role_skills: vi.fn().mockReturnValue([
        { name: "role:implementer", role: "implementer", summary: "구현 전문" },
      ]),
    }));
    const ctx = make_ctx(["roles"]);
    await handler.handle(ctx);

    expect(ctx.replies[0]).toContain("역할 스킬 1개");
    expect(ctx.replies[0]).toContain("implementer");
  });

  it("/skill recommend <task> — 스킬 추천", async () => {
    const handler = new SkillHandler(make_access({
      recommend: vi.fn().mockReturnValue(["weather", "memory"]),
    }));
    const ctx = make_ctx(["recommend", "날씨", "검색"]);
    await handler.handle(ctx);

    expect(ctx.replies[0]).toContain("추천");
    expect(ctx.replies[0]).toContain("weather");
  });

  it("/skill refresh — 새로고침", async () => {
    const handler = new SkillHandler(make_access());
    const ctx = make_ctx(["refresh"]);
    await handler.handle(ctx);

    expect(ctx.replies[0]).toContain("새로고침");
    expect(ctx.replies[0]).toContain("5개");
  });

  it("스킬 없으면 안내 메시지", async () => {
    const handler = new SkillHandler(make_access({
      list_skills: vi.fn().mockReturnValue([]),
    }));
    const ctx = make_ctx(["list"]);
    await handler.handle(ctx);

    expect(ctx.replies[0]).toContain("등록된 스킬이 없습니다");
  });

  it("알 수 없는 action='foobar' → 스킬 목록(간략) 반환 (L70-71)", async () => {
    const handler = new SkillHandler(make_access());
    const ctx = make_ctx(["foobar"]);
    const result = await handler.handle(ctx);

    expect(result).toBe(true);
    expect(ctx.replies[0]).toContain("memory");
    expect(ctx.replies[0]).not.toContain("builtin_skills");
  });

  it("스킬 없고 unknown action → '등록된 스킬이 없습니다' 반환", async () => {
    const handler = new SkillHandler(make_access({
      list_skills: vi.fn().mockReturnValue([]),
    }));
    const ctx = make_ctx(["status"]);
    await handler.handle(ctx);

    expect(ctx.replies[0]).toContain("등록된 스킬이 없습니다");
  });
});
