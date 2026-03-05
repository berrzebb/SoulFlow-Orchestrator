import { describe, it, expect, vi } from "vitest";
import { StatusHandler, type StatusAccess } from "@src/channels/commands/status.handler.js";
import type { CommandContext } from "@src/channels/commands/types.js";
import type { InboundMessage } from "@src/bus/types.js";

function make_access(overrides?: Partial<StatusAccess>): StatusAccess {
  return {
    list_tools: () => [{ name: "shell" }, { name: "message" }, { name: "spawn" }],
    list_skills: () => [
      { name: "cron", summary: "크론 스케줄링", always: "false" },
      { name: "search", summary: "웹 검색", always: "true" },
    ],
    ...overrides,
  };
}

function make_ctx(text: string, slash_name?: string): CommandContext & { replies: string[] } {
  const replies: string[] = [];
  return {
    provider: "slack" as const,
    message: { id: "m1", provider: "slack", channel: "ch1", chat_id: "ch1", sender_id: "U123", content: text, at: new Date().toISOString(), metadata: {} } as InboundMessage,
    command: slash_name ? { name: slash_name, args: [], args_lower: [], raw: `/${slash_name}` } : null,
    text,
    send_reply: vi.fn(async (content: string) => { replies.push(content); }),
    replies,
  };
}

describe("StatusHandler", () => {
  const handler = new StatusHandler(make_access());

  describe("can_handle — 슬래시 명령만 매칭", () => {
    it("matches /tools slash command", () => {
      expect(handler.can_handle(make_ctx("/tools", "tools"))).toBe(true);
    });

    it("matches /skills slash command", () => {
      expect(handler.can_handle(make_ctx("/skills", "skills"))).toBe(true);
    });

    it("matches /status slash command", () => {
      expect(handler.can_handle(make_ctx("/status", "status"))).toBe(true);
    });

    it("matches /도구 slash command", () => {
      expect(handler.can_handle(make_ctx("/도구", "도구"))).toBe(true);
    });

    it("does NOT match natural language — 오케스트레이터 LLM이 처리", () => {
      expect(handler.can_handle(make_ctx("사용 가능한 도구는?"))).toBe(false);
      expect(handler.can_handle(make_ctx("현재 사용가능한 스킬 목록"))).toBe(false);
      expect(handler.can_handle(make_ctx("도구 목록 알려줘"))).toBe(false);
      expect(handler.can_handle(make_ctx("뭐 할 수 있어?"))).toBe(false);
      expect(handler.can_handle(make_ctx("what can you do"))).toBe(false);
      expect(handler.can_handle(make_ctx("스킬 뭐가 있어?"))).toBe(false);
    });

    it("does not match unrelated text", () => {
      expect(handler.can_handle(make_ctx("오늘 날씨 어때?"))).toBe(false);
    });

    it("does not match unrelated slash command", () => {
      expect(handler.can_handle(make_ctx("/help", "help"))).toBe(false);
    });
  });

  describe("handle - /tools", () => {
    it("returns tool list", async () => {
      const ctx = make_ctx("/tools", "tools");
      const result = await handler.handle(ctx);
      expect(result).toBe(true);
      expect(ctx.replies[0]).toContain("도구는 3개입니다");
      expect(ctx.replies[0]).toContain("shell");
      expect(ctx.replies[0]).toContain("message");
    });
  });

  describe("handle - /skills", () => {
    it("returns skill list with summary", async () => {
      const ctx = make_ctx("/skills", "skills");
      const result = await handler.handle(ctx);
      expect(result).toBe(true);
      expect(ctx.replies[0]).toContain("스킬은 2개입니다");
      expect(ctx.replies[0]).toContain("cron");
      expect(ctx.replies[0]).toContain("크론 스케줄링");
      expect(ctx.replies[0]).toContain("[always]");
    });
  });

  describe("handle - empty state", () => {
    it("shows empty message when no tools", async () => {
      const empty_handler = new StatusHandler(make_access({ list_tools: () => [] }));
      const ctx = make_ctx("/tools", "tools");
      await empty_handler.handle(ctx);
      expect(ctx.replies[0]).toContain("등록된 도구가 없습니다");
    });

    it("shows empty message when no skills", async () => {
      const empty_handler = new StatusHandler(make_access({ list_skills: () => [] }));
      const ctx = make_ctx("/skills", "skills");
      await empty_handler.handle(ctx);
      expect(ctx.replies[0]).toContain("등록된 스킬이 없습니다");
    });
  });
});
