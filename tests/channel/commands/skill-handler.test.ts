/**
 * SkillHandler — 미커버 분기 보충:
 * - L113: format_roles() — 역할 스킬 없음 → "등록된 역할 스킬이 없습니다."
 * - L119: format_recommend("") — task 없음 → usage 반환
 * - L121: format_recommend("task") — 추천 없음 → "추천할 스킬이 없습니다."
 */
import { describe, it, expect, vi } from "vitest";
import { SkillHandler } from "@src/channels/commands/skill.handler.js";
import type { SkillAccess } from "@src/channels/commands/skill.handler.js";

function make_access(overrides: Partial<SkillAccess> = {}): SkillAccess {
  return {
    list_skills: vi.fn().mockReturnValue([]),
    get_skill: vi.fn().mockReturnValue(null),
    list_role_skills: vi.fn().mockReturnValue([]),
    recommend: vi.fn().mockReturnValue([]),
    refresh: vi.fn().mockReturnValue(0),
    ...overrides,
  };
}

function make_ctx(action: string, extra_args: string[] = []) {
  const send_reply = vi.fn().mockResolvedValue(undefined);
  return {
    provider: "slack",
    message: { sender_id: "U1" },
    command: {
      name: "skill",
      args: [action, ...extra_args],
      args_lower: [action.toLowerCase(), ...extra_args.map((a) => a.toLowerCase())],
    },
    send_reply,
  } as any;
}

// ── L113: format_roles() — 역할 스킬 없음 ────────────────────────────────────

describe("SkillHandler — L113: format_roles 역할 스킬 없음", () => {
  it("roles 액션 + list_role_skills=[] → L113 '등록된 역할 스킬이 없습니다.' 반환", async () => {
    const access = make_access({ list_role_skills: vi.fn().mockReturnValue([]) });
    const handler = new SkillHandler(access);
    const ctx = make_ctx("roles");
    await handler.handle(ctx);
    expect(ctx.send_reply).toHaveBeenCalledWith(
      expect.stringContaining("등록된 역할 스킬이 없습니다."),
    );
  });
});

// ── L119: format_recommend("") — task 없음 ───────────────────────────────────

describe("SkillHandler — L119: format_recommend task 없음", () => {
  it("recommend 액션 + args 없음 → L119 format_subcommand_usage 반환", async () => {
    const access = make_access();
    const handler = new SkillHandler(access);
    // action = "recommend", extra_args = [] → task = ""
    const ctx = make_ctx("recommend");
    await handler.handle(ctx);
    // access.recommend는 호출되지 않음
    expect(access.recommend).not.toHaveBeenCalled();
    expect(ctx.send_reply).toHaveBeenCalled();
  });
});

// ── L121: format_recommend — 추천 없음 ───────────────────────────────────────

describe("SkillHandler — L121: format_recommend 추천 없음", () => {
  it("recommend 액션 + task 있지만 recommend=[] → L121 '추천할 스킬이 없습니다.' 반환", async () => {
    const access = make_access({ recommend: vi.fn().mockReturnValue([]) });
    const handler = new SkillHandler(access);
    const ctx = make_ctx("recommend", ["분석", "해줘"]);
    await handler.handle(ctx);
    expect(access.recommend).toHaveBeenCalled();
    expect(ctx.send_reply).toHaveBeenCalledWith(
      expect.stringContaining("추천할 스킬이 없습니다."),
    );
  });
});
