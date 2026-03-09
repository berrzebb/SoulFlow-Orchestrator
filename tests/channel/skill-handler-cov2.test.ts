/**
 * SkillHandler — 미커버 분기 커버리지 (L70-71).
 * 알 수 없는 action → format_list(false) 폴백.
 */
import { describe, it, expect, vi } from "vitest";
import { SkillHandler, type SkillAccess } from "@src/channels/commands/skill.handler.ts";
import type { CommandContext } from "@src/channels/commands/types.ts";

function make_access(): SkillAccess {
  return {
    list_skills: vi.fn().mockReturnValue([
      { name: "coder", summary: "코딩", type: "task", source: "builtin", always: false, model: null },
    ]),
    get_skill: vi.fn().mockReturnValue(null),
    list_role_skills: vi.fn().mockReturnValue([]),
    recommend: vi.fn().mockReturnValue([]),
    refresh: vi.fn().mockReturnValue(0),
  };
}

function make_ctx(args: string[] = []): CommandContext & { replies: string[] } {
  const replies: string[] = [];
  return {
    provider: "slack" as never,
    message: {
      id: "m1", provider: "slack", channel: "slack",
      sender_id: "U1", chat_id: "C1", content: `/skill ${args.join(" ")}`,
      at: new Date().toISOString(), metadata: {},
    },
    command: { raw: `/skill ${args.join(" ")}`, name: "skill", args, args_lower: args.map((a) => a.toLowerCase()) },
    text: `/skill ${args.join(" ")}`,
    send_reply: async (content: string) => { replies.push(content); },
    replies,
  };
}

describe("SkillHandler — unknown action → format_list(false) (L70-71)", () => {
  it("알 수 없는 action='foobar' → 스킬 목록(간략) 반환", async () => {
    const handler = new SkillHandler(make_access());
    const ctx = make_ctx(["foobar"]);
    const result = await handler.handle(ctx);

    expect(result).toBe(true);
    // format_list(false) 결과 포함
    expect(ctx.replies[0]).toContain("coder");
    expect(ctx.replies[0]).toContain("코딩");
    // detailed=false이므로 source(builtin) 미포함
    expect(ctx.replies[0]).not.toContain("builtin");
  });

  it("스킬 없고 unknown action → '등록된 스킬이 없습니다' 반환", async () => {
    const access = make_access();
    vi.mocked(access.list_skills).mockReturnValue([]);
    const handler = new SkillHandler(access);
    const ctx = make_ctx(["status"]);
    await handler.handle(ctx);

    expect(ctx.replies[0]).toContain("등록된 스킬이 없습니다");
  });
});
