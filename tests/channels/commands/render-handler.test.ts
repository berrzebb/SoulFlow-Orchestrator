/**
 * render.handler.ts — 미커버 분기 보충:
 * - L118: normalize_block_policy 반환 null → "policy 값이 필요합니다" 메시지
 * - L119: return true
 */
import { describe, it, expect, vi } from "vitest";
import { RenderHandler, InMemoryRenderProfileStore } from "@src/channels/commands/render.handler.js";
import type { CommandContext } from "@src/channels/commands/types.js";

function make_ctx(args: string[]): CommandContext {
  const send_reply = vi.fn().mockResolvedValue(undefined);
  return {
    provider: "slack",
    message: {
      id: "m1",
      provider: "slack",
      channel: "slack",
      sender_id: "U001",
      chat_id: "C001",
      content: `/${args.join(" ")}`,
      at: new Date().toISOString(),
      metadata: {},
    },
    command: {
      name: "render",
      args_lower: args.map((a) => a.toLowerCase()),
      raw: `/${args.join(" ")}`,
    },
    send_reply,
  } as unknown as CommandContext;
}

// ── L118-119: link/image + 유효하지 않은 policy → "policy 값이 필요합니다" ───

describe("RenderHandler — L118-119: target 있음 + policy 없음 → 오류 메시지", () => {
  it("link + 빈 policy → normalize_block_policy=null → L118 send_reply, L119 return true", async () => {
    const store = new InMemoryRenderProfileStore();
    const handler = new RenderHandler(store);

    const ctx = make_ctx(["link"]); // arg1 = "" → normalize_block_policy("") = null
    const result = await handler.handle(ctx);
    expect(result).toBe(true);
    expect(ctx.send_reply).toHaveBeenCalledWith(
      expect.stringContaining("policy 값이 필요합니다"),
    );
  });

  it("image + 잘못된 policy → normalize_block_policy(null) → L118 send_reply", async () => {
    const store = new InMemoryRenderProfileStore();
    const handler = new RenderHandler(store);

    const ctx = make_ctx(["image", "invalid_policy"]);
    const result = await handler.handle(ctx);
    expect(result).toBe(true);
    expect(ctx.send_reply).toHaveBeenCalledWith(
      expect.stringContaining("policy 값이 필요합니다"),
    );
  });
});
