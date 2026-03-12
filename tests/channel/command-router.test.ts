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

// ══════════════════════════════════════════════════════════
// fuzzy_match_command 빈 입력 → null 반환 (퍼지 미실행)
// ══════════════════════════════════════════════════════════

describe("CommandRouter — fuzzy_match_command 빈 입력", () => {
  it("command.name='' → fuzzy 시도 안 함 → false 반환", async () => {
    const handleFn = vi.fn(async () => true);
    const handler = make_handler("help", (ctx) => ctx.command?.name === "help", handleFn);
    const router = new CommandRouter([handler]);

    const ctx = make_context({
      command: { name: "", args: "" },
      message: {
        id: "msg-1",
        provider: "slack",
        channel: "slack",
        sender_id: "user1",
        chat_id: "C123",
        content: "/",
        at: new Date().toISOString(),
        metadata: {},
      },
    });
    const result = await router.try_handle(ctx);

    expect(result).toBe(false);
    expect(handleFn).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════
// levenshtein 동일 문자열 분기
// ══════════════════════════════════════════════════════════

describe("CommandRouter — levenshtein 동일 문자열 분기", () => {
  it("입력과 핸들러 이름이 같으면 exact match 단계에서 처리됨 (퍼지 대상 아님)", async () => {
    const handleFn = vi.fn(async () => true);
    const handler = make_handler("help", () => false, handleFn);
    const router = new CommandRouter([handler]);

    const ctx = make_context({ command: { name: "help", args: "" } });
    const result = await router.try_handle(ctx);

    expect(result).toBe(false);
    expect(handleFn).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════
// levenshtein 빈 핸들러 이름
// ══════════════════════════════════════════════════════════

describe("CommandRouter — levenshtein 빈 핸들러 이름", () => {
  it("핸들러 name='' → levenshtein=input.length → distance > 2 → 퍼지 매칭 실패", async () => {
    const handleFn = vi.fn(async () => true);
    const handler = make_handler("", () => false, handleFn);
    const router = new CommandRouter([handler]);

    const ctx = make_context({ command: { name: "help", args: "" } });
    const result = await router.try_handle(ctx);

    expect(result).toBe(false);
    expect(handleFn).not.toHaveBeenCalled();
  });

  it("핸들러 name='' + 입력 1글자 → levenshtein=1 ≤ 2 → best='', but '' is falsy → 퍼지 분기 미실행", async () => {
    const handleFn = vi.fn(async () => true);
    const handler = make_handler("", () => false, handleFn);
    const router = new CommandRouter([handler]);

    const ctx = make_context({ command: { name: "a", args: "" } });
    const result = await router.try_handle(ctx);

    expect(result).toBe(false);
    expect(handleFn).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════
// 퍼지 매칭 성공 → correct_context 경유 → 핸들러 위임
// ══════════════════════════════════════════════════════════

describe("CommandRouter — 퍼지 매칭 성공 후 correct_context 경유", () => {
  it("오타 'hlep' → 퍼지 매칭 'help' → correct_context → 핸들러 호출됨", async () => {
    const handleFn = vi.fn(async () => true);
    const handler = make_handler("help", (ctx) => ctx.command?.name === "help", handleFn);
    const router = new CommandRouter([handler]);

    const ctx = make_context({
      command: { name: "hlep", args: "" },
      text: "/hlep",
      message: {
        id: "msg-1",
        provider: "slack",
        channel: "slack",
        sender_id: "user1",
        chat_id: "C123",
        content: "/hlep",
        at: new Date().toISOString(),
        metadata: {},
      },
    });
    const result = await router.try_handle(ctx);

    expect(result).toBe(true);
    expect(handleFn).toHaveBeenCalled();
    const called_ctx = handleFn.mock.calls[0][0] as CommandContext;
    expect(called_ctx.command?.name).toBe("help");
  });

  it("add_handler로 추가한 핸들러도 퍼지 매칭에 포함됨", async () => {
    const handleFn = vi.fn(async () => true);
    const router = new CommandRouter([]);
    router.add_handler(make_handler("status", (ctx) => ctx.command?.name === "status", handleFn));

    const ctx = make_context({
      command: { name: "statuss", args: "" },
      text: "/statuss",
      message: {
        id: "msg-1",
        provider: "slack",
        channel: "slack",
        sender_id: "user1",
        chat_id: "C123",
        content: "/statuss",
        at: new Date().toISOString(),
        metadata: {},
      },
    });
    const result = await router.try_handle(ctx);

    expect(result).toBe(true);
    expect(handleFn).toHaveBeenCalled();
  });
});
