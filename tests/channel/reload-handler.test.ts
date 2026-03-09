/**
 * ReloadHandler — reload_tools/reload_skills 실패 분기 커버리지 (L47-48, L55-56).
 */
import { describe, it, expect, vi } from "vitest";
import { ReloadHandler } from "@src/channels/commands/reload.handler.ts";
import type { CommandContext } from "@src/channels/commands/types.ts";

function make_ctx(args: string[] = ["all"]): CommandContext {
  return {
    command: { name: "reload", args },
    send_reply: vi.fn().mockResolvedValue(undefined),
    provider: "slack",
    chat_id: "C001",
    sender_id: "U001",
    channel: "slack",
    message_id: "m1",
  } as any;
}

describe("ReloadHandler — error 분기 (L47-48, L55-56)", () => {
  it("reload_tools 실패 → tools: failed 메시지 포함 (L47-48)", async () => {
    const handler = new ReloadHandler({
      reload_config: vi.fn().mockResolvedValue(undefined),
      reload_tools: vi.fn().mockRejectedValue(new Error("tool load failed")),
      reload_skills: vi.fn().mockResolvedValue(2),
    });
    const ctx = make_ctx(["all"]);
    const result = await handler.handle(ctx);

    expect(result).toBe(true);
    const reply = vi.mocked(ctx.send_reply).mock.calls[0][0] as string;
    expect(reply).toContain("tools: failed");
    expect(reply).toContain("tool load failed");
    // skills는 성공
    expect(reply).toContain("skills: 2 reloaded");
  });

  it("reload_skills 실패 → skills: failed 메시지 포함 (L55-56)", async () => {
    const handler = new ReloadHandler({
      reload_config: vi.fn().mockResolvedValue(undefined),
      reload_tools: vi.fn().mockResolvedValue(3),
      reload_skills: vi.fn().mockRejectedValue(new Error("skill load failed")),
    });
    const ctx = make_ctx(["all"]);
    const result = await handler.handle(ctx);

    expect(result).toBe(true);
    const reply = vi.mocked(ctx.send_reply).mock.calls[0][0] as string;
    expect(reply).toContain("skills: failed");
    expect(reply).toContain("skill load failed");
    // tools는 성공
    expect(reply).toContain("tools: 3 reloaded");
  });

  it("reload_config + reload_tools + reload_skills 모두 성공", async () => {
    const handler = new ReloadHandler({
      reload_config: vi.fn().mockResolvedValue(undefined),
      reload_tools: vi.fn().mockResolvedValue(5),
      reload_skills: vi.fn().mockResolvedValue(8),
    });
    const ctx = make_ctx(["all"]);
    await handler.handle(ctx);

    const reply = vi.mocked(ctx.send_reply).mock.calls[0][0] as string;
    expect(reply).toContain("config: reloaded");
    expect(reply).toContain("tools: 5 reloaded");
    expect(reply).toContain("skills: 8 reloaded");
  });
});
