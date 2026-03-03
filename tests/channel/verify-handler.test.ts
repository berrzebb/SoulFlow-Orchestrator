import { describe, it, expect, vi } from "vitest";
import { VerifyHandler, type VerifyAccess } from "@src/channels/commands/verify.handler.ts";
import type { CommandContext } from "@src/channels/commands/types.ts";

function make_access(overrides?: Partial<VerifyAccess>): VerifyAccess {
  return {
    get_last_output: vi.fn().mockReturnValue(null),
    run_verification: vi.fn().mockResolvedValue({ ok: true, content: "모든 항목이 정확합니다." }),
    ...overrides,
  };
}

function make_ctx(args: string[] = []): CommandContext & { replies: string[] } {
  const replies: string[] = [];
  return {
    provider: "telegram" as never,
    message: {
      id: "msg-1", provider: "telegram", channel: "telegram",
      sender_id: "user-1", chat_id: "chat-1", content: `/verify ${args.join(" ")}`,
      at: new Date().toISOString(), metadata: {},
    },
    command: { raw: `/verify ${args.join(" ")}`, name: "verify", args, args_lower: args.map((a) => a.toLowerCase()) },
    text: `/verify ${args.join(" ")}`,
    send_reply: async (content: string) => { replies.push(content); },
    replies,
  };
}

describe("VerifyHandler", () => {
  it("can_handle — /verify 및 한글 별칭 인식", () => {
    const handler = new VerifyHandler(make_access());
    expect(handler.can_handle(make_ctx())).toBe(true);

    for (const alias of ["검증", "확인", "리뷰"]) {
      const ctx = make_ctx();
      ctx.command!.name = alias;
      expect(handler.can_handle(ctx)).toBe(true);
    }
  });

  it("/verify — 이전 출력 없으면 안내 메시지", async () => {
    const handler = new VerifyHandler(make_access());
    const ctx = make_ctx();
    await handler.handle(ctx);

    expect(ctx.replies[0]).toContain("검증할 이전 출력이 없습니다");
  });

  it("/verify — 이전 출력 있으면 검증 실행 후 PASS", async () => {
    const handler = new VerifyHandler(make_access({
      get_last_output: vi.fn().mockReturnValue("에이전트가 생성한 코드입니다."),
      run_verification: vi.fn().mockResolvedValue({ ok: true, content: "코드가 정확합니다." }),
    }));
    const ctx = make_ctx();
    await handler.handle(ctx);

    expect(ctx.replies.length).toBe(2);
    expect(ctx.replies[0]).toContain("검증을 시작합니다");
    expect(ctx.replies[1]).toContain("✅ PASS");
    expect(ctx.replies[1]).toContain("코드가 정확합니다");
  });

  it("/verify — 검증 결과 FAIL", async () => {
    const handler = new VerifyHandler(make_access({
      get_last_output: vi.fn().mockReturnValue("결과물"),
      run_verification: vi.fn().mockResolvedValue({ ok: false, content: "타입 에러가 있습니다." }),
    }));
    const ctx = make_ctx();
    await handler.handle(ctx);

    expect(ctx.replies[1]).toContain("❌ FAIL");
    expect(ctx.replies[1]).toContain("타입 에러");
  });

  it("/verify <criteria> — 사용자 정의 기준으로 검증", async () => {
    const run = vi.fn().mockResolvedValue({ ok: true, content: "OK" });
    const handler = new VerifyHandler(make_access({
      get_last_output: vi.fn().mockReturnValue("출력물"),
      run_verification: run,
    }));
    const ctx = make_ctx(["보안", "취약점", "검사"]);
    await handler.handle(ctx);

    expect(run).toHaveBeenCalled();
    const task_arg = run.mock.calls[0][0] as string;
    expect(task_arg).toContain("보안 취약점 검사");
  });

  it("/verify — 검증 중 오류 발생 시 에러 메시지", async () => {
    const handler = new VerifyHandler(make_access({
      get_last_output: vi.fn().mockReturnValue("출력물"),
      run_verification: vi.fn().mockRejectedValue(new Error("spawn timeout")),
    }));
    const ctx = make_ctx();
    await handler.handle(ctx);

    expect(ctx.replies[1]).toContain("검증 중 오류");
    expect(ctx.replies[1]).toContain("spawn timeout");
  });

  it("긴 출력은 200자로 잘린 스니펫 표시", async () => {
    const long_output = "A".repeat(300);
    const handler = new VerifyHandler(make_access({
      get_last_output: vi.fn().mockReturnValue(long_output),
    }));
    const ctx = make_ctx();
    await handler.handle(ctx);

    expect(ctx.replies[0]).toContain("...");
    expect(ctx.replies[0]).not.toContain(long_output);
  });
});
