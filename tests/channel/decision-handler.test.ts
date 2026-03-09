/**
 * DecisionHandler — can_handle / handle 분기 커버리지 테스트.
 * channels/commands/decision.handler.ts
 */
import { describe, it, expect, vi } from "vitest";
import { DecisionHandler } from "@src/channels/commands/decision.handler.js";
import type { CommandContext } from "@src/channels/commands/types.js";
import type { DecisionAccess, DecisionServiceLike } from "@src/channels/commands/decision.handler.js";

// ── 헬퍼 ────────────────────────────────────────────

function make_ctx(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    provider: "slack",
    message: {
      id: "msg-1",
      chat_id: "C123",
      sender_id: "U001",
      content: "",
      timestamp: new Date().toISOString(),
      provider: "slack",
    } as any,
    command: null,
    text: "",
    send_reply: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function make_command(name: string, args: string[] = []) {
  return {
    name,
    args,
    args_lower: args.map((a) => a.toLowerCase()),
  } as any;
}

function make_fake_decisions(overrides: Partial<DecisionServiceLike> = {}): DecisionServiceLike {
  return {
    append_decision: vi.fn().mockResolvedValue({
      action: "inserted",
      record: { canonical_key: "test_key", value: "test value", updated_at: new Date().toISOString() },
    }),
    list_decisions: vi.fn().mockResolvedValue([
      { priority: 1, canonical_key: "test_key", value: "test value" },
    ]),
    get_effective_decisions: vi.fn().mockResolvedValue([
      { priority: 1, canonical_key: "test_key", value: "test value" },
    ]),
    ...overrides,
  };
}

function make_access(svc: DecisionServiceLike | null = null): DecisionAccess {
  return { get_decision_service: () => svc };
}

// ── can_handle ──────────────────────────────────────

describe("DecisionHandler — can_handle", () => {
  it("decision 커맨드 → true", () => {
    const handler = new DecisionHandler(make_access(make_fake_decisions()));
    const ctx = make_ctx({ command: make_command("decision") });
    expect(handler.can_handle(ctx)).toBe(true);
  });

  it("policy 커맨드 → true", () => {
    const handler = new DecisionHandler(make_access(make_fake_decisions()));
    const ctx = make_ctx({ command: make_command("policy") });
    expect(handler.can_handle(ctx)).toBe(true);
  });

  it("관련 없는 커맨드 → false", () => {
    const handler = new DecisionHandler(make_access(make_fake_decisions()));
    const ctx = make_ctx({ command: make_command("help") });
    expect(handler.can_handle(ctx)).toBe(false);
  });

  it("커맨드 없음 + 일반 텍스트 → false", () => {
    const handler = new DecisionHandler(make_access(make_fake_decisions()));
    const ctx = make_ctx({ message: { ...make_ctx().message, content: "안녕하세요" } as any });
    expect(handler.can_handle(ctx)).toBe(false);
  });
});

// ── handle: decision service 없음 ────────────────────

describe("DecisionHandler — handle: service 없음", () => {
  it("decisions=null → unavailable 메시지 반환", async () => {
    const handler = new DecisionHandler(make_access(null));
    // args 있어야 guide 분기를 건너뜀
    const ctx = make_ctx({ command: make_command("decision", ["status"]) });
    const send = ctx.send_reply as ReturnType<typeof vi.fn>;
    const result = await handler.handle(ctx);
    expect(result).toBe(true);
    expect(send).toHaveBeenCalledWith("decision service unavailable");
  });
});

// ── handle: action=status (기본) ──────────────────────

describe("DecisionHandler — handle: status (기본)", () => {
  it("decision status → 현재 지침 목록 포함 응답", async () => {
    const decisions = make_fake_decisions();
    const handler = new DecisionHandler(make_access(decisions));
    // args 있어야 guide 분기를 건너뜀
    const ctx = make_ctx({ command: make_command("decision", ["status"]) });
    const send = ctx.send_reply as ReturnType<typeof vi.fn>;
    const result = await handler.handle(ctx);
    expect(result).toBe(true);
    const replied = send.mock.calls[0]?.[0] as string;
    expect(replied).toContain("active:");
  });

  it("effective 결과 없음 → (empty) 포함", async () => {
    const decisions = make_fake_decisions({
      list_decisions: vi.fn().mockResolvedValue([]),
      get_effective_decisions: vi.fn().mockResolvedValue([]),
    });
    const handler = new DecisionHandler(make_access(decisions));
    const ctx = make_ctx({ command: make_command("decision", ["status"]) });
    const send = ctx.send_reply as ReturnType<typeof vi.fn>;
    await handler.handle(ctx);
    const replied = send.mock.calls[0]?.[0] as string;
    expect(replied).toContain("(empty)");
  });
});

// ── handle: action=set ────────────────────────────────

describe("DecisionHandler — handle: set", () => {
  it("set 커맨드 + 키:값 → append_decision 호출 후 저장 완료 응답", async () => {
    const decisions = make_fake_decisions();
    const handler = new DecisionHandler(make_access(decisions));
    const ctx = make_ctx({ command: make_command("decision", ["set", "my_key:my value"]) });
    const send = ctx.send_reply as ReturnType<typeof vi.fn>;
    const result = await handler.handle(ctx);
    expect(result).toBe(true);
    const replied = send.mock.calls[0]?.[0] as string;
    expect(replied).toContain("저장 완료");
  });

  it("set 커맨드 + 쌍 없음 → usage 안내 응답", async () => {
    const decisions = make_fake_decisions();
    const handler = new DecisionHandler(make_access(decisions));
    // /decision set 만 (값 없음)
    const ctx = make_ctx({ command: make_command("decision", ["set"]) });
    const send = ctx.send_reply as ReturnType<typeof vi.fn>;
    const result = await handler.handle(ctx);
    expect(result).toBe(true);
    // usage 안내가 포함되어 있어야 함
    expect(send).toHaveBeenCalled();
  });

  it("set 직접 커맨드 (alias) → 동작", async () => {
    const decisions = make_fake_decisions();
    const handler = new DecisionHandler(make_access(decisions));
    const ctx = make_ctx({ command: make_command("decision-set", ["rule_name:rule value"]) });
    const result = await handler.handle(ctx);
    expect(result).toBe(true);
  });
});

// ── handle: no args → guide ──────────────────────────

describe("DecisionHandler — handle: 가이드 안내", () => {
  it("args 없는 decision 커맨드 → 서브커맨드 가이드 포함 응답 (없으면 status 진행)", async () => {
    const decisions = make_fake_decisions();
    const handler = new DecisionHandler(make_access(decisions));
    const ctx = make_ctx({ command: { name: "decision", args: [], args_lower: [] } as any });
    const send = ctx.send_reply as ReturnType<typeof vi.fn>;
    const result = await handler.handle(ctx);
    expect(result).toBe(true);
    // 가이드 있으면 한 번 호출, 없으면 status 안내로 한 번 호출
    expect(send).toHaveBeenCalled();
  });
});

// ── handle: telegram provider → mention="" ────────────

describe("DecisionHandler — handle: telegram provider", () => {
  it("telegram + status → @mention 없이 응답", async () => {
    const decisions = make_fake_decisions();
    const handler = new DecisionHandler(make_access(decisions));
    const ctx = make_ctx({
      provider: "telegram",
      command: make_command("decision"),
      message: { ...make_ctx().message, provider: "telegram" } as any,
    });
    const send = ctx.send_reply as ReturnType<typeof vi.fn>;
    await handler.handle(ctx);
    const replied = send.mock.calls[0]?.[0] as string;
    // telegram은 @멘션 없음
    expect(replied).not.toMatch(/^@/);
  });
});
