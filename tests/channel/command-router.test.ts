import { describe, it, expect, vi } from "vitest";
import { CommandRouter } from "@src/channels/commands/router.js";
import type { CommandContext, CommandHandler } from "@src/channels/commands/types.js";

function make_context(overrides?: Partial<CommandContext>): CommandContext {
  return {
    provider: "slack",
    message: {
      id: "msg-1",
      provider: "slack",
      channel: "slack",
      sender_id: "user1",
      chat_id: "C123",
      content: "/help",
      at: new Date().toISOString(),
      metadata: {},
    },
    command: { name: "help", args: "" },
    text: "/help",
    send_reply: vi.fn(async () => {}),
    ...overrides,
  };
}

function make_handler(
  name: string,
  can: (ctx: CommandContext) => boolean,
  handle?: (ctx: CommandContext) => Promise<boolean>,
): CommandHandler {
  return {
    name,
    can_handle: can,
    handle: handle || (async () => true),
  };
}

describe("CommandRouter", () => {
  it("routes to first matching handler", async () => {
    const handler1 = make_handler("help", (ctx) => ctx.command?.name === "help");
    const handler2 = make_handler("stop", (ctx) => ctx.command?.name === "stop");

    const router = new CommandRouter([handler1, handler2]);
    const ctx = make_context();
    const result = await router.try_handle(ctx);

    expect(result).toBe(true);
  });

  it("returns false when no handler matches", async () => {
    const handler = make_handler("help", (ctx) => ctx.command?.name === "help");
    const router = new CommandRouter([handler]);
    const ctx = make_context({ command: { name: "unknown", args: "" } });
    const result = await router.try_handle(ctx);

    expect(result).toBe(false);
  });

  it("skips handler that can_handle returns false", async () => {
    const handleFn = vi.fn(async () => true);
    const handler1 = make_handler("skip", () => false, handleFn);
    const handler2 = make_handler("match", () => true);

    const router = new CommandRouter([handler1, handler2]);
    await router.try_handle(make_context());

    expect(handleFn).not.toHaveBeenCalled();
  });

  it("stops at first successful handler", async () => {
    const handle1 = vi.fn(async () => true);
    const handle2 = vi.fn(async () => true);

    const router = new CommandRouter([
      make_handler("first", () => true, handle1),
      make_handler("second", () => true, handle2),
    ]);

    await router.try_handle(make_context());

    expect(handle1).toHaveBeenCalledTimes(1);
    expect(handle2).not.toHaveBeenCalled();
  });

  it("tries next handler if handle returns false", async () => {
    const handle1 = vi.fn(async () => false);
    const handle2 = vi.fn(async () => true);

    const router = new CommandRouter([
      make_handler("partial", () => true, handle1),
      make_handler("full", () => true, handle2),
    ]);

    const result = await router.try_handle(make_context());

    expect(result).toBe(true);
    expect(handle1).toHaveBeenCalled();
    expect(handle2).toHaveBeenCalled();
  });

  it("works with empty handler list", async () => {
    const router = new CommandRouter([]);
    const result = await router.try_handle(make_context());
    expect(result).toBe(false);
  });

  it("passes context to handler", async () => {
    const handleFn = vi.fn(async (ctx: CommandContext) => {
      await ctx.send_reply("handled!");
      return true;
    });
    const handler = make_handler("test", () => true, handleFn);
    const router = new CommandRouter([handler]);
    const ctx = make_context();

    await router.try_handle(ctx);

    expect(handleFn).toHaveBeenCalledWith(ctx);
    expect(ctx.send_reply).toHaveBeenCalledWith("handled!");
  });
});
