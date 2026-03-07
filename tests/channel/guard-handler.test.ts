import { describe, it, expect, vi, beforeAll } from "vitest";
import { GuardHandler } from "@src/channels/commands/guard.handler.js";
import { ConfirmationGuard } from "@src/orchestration/confirmation-guard.js";
import { set_locale } from "@src/i18n/index.js";
import type { CommandContext } from "@src/channels/commands/types.js";

beforeAll(() => set_locale("ko"));

function make_guard(enabled = false): ConfirmationGuard {
  return new ConfirmationGuard({ enabled });
}

function make_ctx(args: string[] = []): CommandContext {
  return {
    provider: "slack",
    message: { id: "m1", provider: "slack", channel: "slack", sender_id: "u1", chat_id: "ch1", content: "", at: new Date().toISOString(), metadata: {} },
    command: { name: "guard", args, args_lower: args.map((a) => a.toLowerCase()) },
    send_reply: vi.fn(async () => ({ ok: true })),
    resolve_reply_to: vi.fn(() => "reply-to"),
  } as unknown as CommandContext;
}

describe("GuardHandler", () => {
  it("can_handle: guard/가드/확인 매칭", () => {
    const handler = new GuardHandler(make_guard());
    for (const name of ["guard", "가드", "확인"]) {
      expect(handler.can_handle({ command: { name } } as unknown as CommandContext)).toBe(true);
    }
    expect(handler.can_handle({ command: { name: "help" } } as unknown as CommandContext)).toBe(false);
  });

  it("/guard on → 활성화 + 메시지", async () => {
    const guard = make_guard(false);
    const handler = new GuardHandler(guard);
    const ctx = make_ctx(["on"]);

    await handler.handle(ctx);

    expect(guard.enabled).toBe(true);
    expect(ctx.send_reply).toHaveBeenCalledWith(expect.stringContaining("활성화"));
  });

  it("/guard off → 비활성화 + 메시지", async () => {
    const guard = make_guard(true);
    const handler = new GuardHandler(guard);
    const ctx = make_ctx(["off"]);

    await handler.handle(ctx);

    expect(guard.enabled).toBe(false);
    expect(ctx.send_reply).toHaveBeenCalledWith(expect.stringContaining("비활성화"));
  });

  it("/guard 활성 → 한글 토큰 인식", async () => {
    const guard = make_guard(false);
    const handler = new GuardHandler(guard);
    const ctx = make_ctx(["활성"]);

    await handler.handle(ctx);
    expect(guard.enabled).toBe(true);
  });

  it("/guard (인수 없음) → 상태 표시", async () => {
    const guard = make_guard(true);
    guard.store("slack", "ch1", "test", "summary", "task", []);
    const handler = new GuardHandler(guard);
    const ctx = make_ctx([]);

    await handler.handle(ctx);

    const reply = (ctx.send_reply as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(reply).toContain("확인 가드 상태");
    expect(reply).toContain("ON");
    expect(reply).toContain("1건");
  });

  it("handle은 항상 true 반환", async () => {
    const handler = new GuardHandler(make_guard());
    expect(await handler.handle(make_ctx(["on"]))).toBe(true);
    expect(await handler.handle(make_ctx([]))).toBe(true);
  });
});
