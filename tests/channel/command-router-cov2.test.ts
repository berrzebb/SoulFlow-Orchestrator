/**
 * CommandRouter — 추가 미커버 분기 커버리지 (cov2):
 * - L34: fuzzy_match_command 빈 문자열 → null 반환
 * - L65: levenshtein(a, a) → 0 (동일 문자열 → 퍼지 매칭 제외)
 * - L67: levenshtein(something, "") → a.length (빈 핸들러 이름)
 * - fuzzy 매칭 성공 후 correct_context 경유 핸들러 위임
 */
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

// ══════════════════════════════════════════════════════════
// L34: fuzzy_match_command 빈 입력 → null 반환 (퍼지 미실행)
// ══════════════════════════════════════════════════════════

describe("CommandRouter — fuzzy_match_command 빈 입력 (L34)", () => {
  it("command.name='' → fuzzy 시도 안 함 → false 반환", async () => {
    const handleFn = vi.fn(async () => true);
    const handler = make_handler("help", (ctx) => ctx.command?.name === "help", handleFn);
    const router = new CommandRouter([handler]);

    // command.name이 빈 문자열이면 fuzzy_match_command("")가 null 반환
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
    // 핸들러는 exact match 단계에서도 퍼지 단계에서도 호출되지 않음
    expect(handleFn).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════
// L65: levenshtein(a, a) → 0 → d > 0 조건 불충족 → best에 포함 안 됨
// ══════════════════════════════════════════════════════════

describe("CommandRouter — levenshtein 동일 문자열 분기 (L65)", () => {
  it("입력과 핸들러 이름이 같으면 exact match 단계에서 처리됨 (퍼지 대상 아님)", async () => {
    // 동일 이름이면 levenshtein=0 → d>0 조건 false → fuzzy candidate 제외
    // (exact 매칭은 can_handle()이 결정)
    const handleFn = vi.fn(async () => true);
    // can_handle이 false → exact 단계 통과, fuzzy 시도
    // fuzzy에서 levenshtein("help", "help")=0 → best_dist 갱신 안 됨 → null 반환
    const handler = make_handler("help", () => false, handleFn);
    const router = new CommandRouter([handler]);

    const ctx = make_context({ command: { name: "help", args: "" } });
    const result = await router.try_handle(ctx);

    expect(result).toBe(false);  // levenshtein=0 → 퍼지 후보 아님 → 핸들러 미호출
    expect(handleFn).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════
// L67: levenshtein(a, "") → a.length (핸들러 이름이 빈 문자열)
// ══════════════════════════════════════════════════════════

describe("CommandRouter — levenshtein 빈 핸들러 이름 (L67)", () => {
  it("핸들러 name='' → levenshtein=input.length → distance > 2 → 퍼지 매칭 실패", async () => {
    // levenshtein("hi", "") = 2, distance ≤ 2이면 매칭될 수 있음
    // levenshtein("help", "") = 4 → 4 > 2 → null 반환
    const handleFn = vi.fn(async () => true);
    const handler = make_handler("", () => false, handleFn);
    const router = new CommandRouter([handler]);

    const ctx = make_context({ command: { name: "help", args: "" } });
    const result = await router.try_handle(ctx);

    expect(result).toBe(false);
    expect(handleFn).not.toHaveBeenCalled();
  });

  it("핸들러 name='' + 입력 1글자 → levenshtein=1 ≤ 2 → best='', but '' is falsy → 퍼지 분기 미실행", async () => {
    // levenshtein("a", "") = 1 → best_dist=1, best=""
    // 하지만 if (corrected) 에서 "" === falsy → 퍼지 분기 진입 안 함
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
    // exact 매칭은 name==="help" 체크이므로 "hlep"로는 매칭 안 됨
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
    // correct_context가 command.name을 "help"로 교정했는지 확인
    const called_ctx = handleFn.mock.calls[0][0] as CommandContext;
    expect(called_ctx.command?.name).toBe("help");
  });

  it("add_handler로 추가한 핸들러도 퍼지 매칭에 포함됨", async () => {
    const handleFn = vi.fn(async () => true);
    const router = new CommandRouter([]);
    router.add_handler(make_handler("status", (ctx) => ctx.command?.name === "status", handleFn));

    // "statuss" → levenshtein=1 → 퍼지 매칭 → "status"
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
