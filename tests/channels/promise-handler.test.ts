/**
 * PromiseHandler — promise 커맨드 핸들러 커버리지.
 */
import { describe, it, expect, vi } from "vitest";
import { PromiseHandler, type PromiseAccess, type PromiseServiceLike } from "@src/channels/commands/promise.handler.js";
import type { CommandContext } from "@src/channels/commands/types.js";

// ── 헬퍼 ─────────────────────────────────────────

function make_ctx(
  command_name: string,
  args: string[],
  provider = "slack",
  sender_id = "U123",
): CommandContext & { replies: string[] } {
  const replies: string[] = [];
  return {
    provider,
    message: {
      id: "msg-1",
      provider,
      channel: provider,
      sender_id,
      chat_id: "C001",
      content: `/${command_name} ${args.join(" ")}`,
      at: new Date().toISOString(),
    },
    command: {
      raw: `/${command_name} ${args.join(" ")}`,
      name: command_name,
      args,
      args_lower: args.map((a) => a.toLowerCase()),
    },
    text: args.join(" "),
    send_reply: async (content: string) => { replies.push(content); },
    replies,
  };
}

function make_promise_service(overrides: Partial<PromiseServiceLike> = {}): PromiseServiceLike {
  return {
    append_promise: vi.fn().mockResolvedValue({
      action: "created",
      record: { canonical_key: "rule.key", value: "some rule", updated_at: new Date().toISOString() },
    }),
    list_promises: vi.fn().mockResolvedValue([
      { priority: 0, canonical_key: "rule.key", value: "some rule" },
    ]),
    get_effective_promises: vi.fn().mockResolvedValue([
      { priority: 0, canonical_key: "rule.key", value: "some rule" },
    ]),
    ...overrides,
  };
}

function make_access(service: PromiseServiceLike | null = null): PromiseAccess {
  return { get_promise_service: () => service };
}

// ══════════════════════════════════════════
// can_handle
// ══════════════════════════════════════════

describe("PromiseHandler — can_handle", () => {
  it("'promise' → true", () => {
    const h = new PromiseHandler(make_access());
    expect(h.can_handle(make_ctx("promise", []))).toBe(true);
  });

  it("'약속' → true", () => {
    const h = new PromiseHandler(make_access());
    expect(h.can_handle(make_ctx("약속", []))).toBe(true);
  });

  it("'help' → false", () => {
    const h = new PromiseHandler(make_access());
    expect(h.can_handle(make_ctx("help", []))).toBe(false);
  });

  it("command 없음 → false", () => {
    const h = new PromiseHandler(make_access());
    const ctx = make_ctx("promise", []);
    (ctx as any).command = undefined;
    expect(h.can_handle(ctx)).toBe(false);
  });
});

// ══════════════════════════════════════════
// handle — promise service 없음
// ══════════════════════════════════════════

describe("PromiseHandler — service 없음", () => {
  it("promise service null → 'unavailable' 반환", async () => {
    const h = new PromiseHandler(make_access(null));
    const ctx = make_ctx("promise", ["list"]);
    const result = await h.handle(ctx);
    expect(result).toBe(true);
    expect(ctx.replies[0]).toContain("unavailable");
  });
});

// ══════════════════════════════════════════
// handle — set 액션
// ══════════════════════════════════════════

describe("PromiseHandler — set 액션", () => {
  it("set key=value → append_promise 호출", async () => {
    const svc = make_promise_service();
    const h = new PromiseHandler(make_access(svc));
    const ctx = make_ctx("promise", ["set", "rule.key=some", "rule"]);
    await h.handle(ctx);
    expect(svc.append_promise).toHaveBeenCalledWith(
      expect.objectContaining({ key: "rule.key", source: "user" }),
    );
    expect(ctx.replies[0]).toContain("저장 완료");
  });

  it("add key value → append_promise 호출", async () => {
    const svc = make_promise_service();
    const h = new PromiseHandler(make_access(svc));
    const ctx = make_ctx("promise", ["add", "my.key", "my value"]);
    await h.handle(ctx);
    expect(svc.append_promise).toHaveBeenCalledWith(
      expect.objectContaining({ key: "my.key", value: "my value" }),
    );
  });

  it("set pair 없음 → usage 안내", async () => {
    const svc = make_promise_service();
    const h = new PromiseHandler(make_access(svc));
    const ctx = make_ctx("promise", ["set"]); // 키=값 없음
    await h.handle(ctx);
    expect(svc.append_promise).not.toHaveBeenCalled();
  });

  it("추가 alias → set 처리", async () => {
    const svc = make_promise_service();
    const h = new PromiseHandler(make_access(svc));
    const ctx = make_ctx("promise", ["추가", "key", "value"]);
    await h.handle(ctx);
    expect(svc.append_promise).toHaveBeenCalledOnce();
  });
});

// ══════════════════════════════════════════
// handle — list/status (기본) 액션
// ══════════════════════════════════════════

describe("PromiseHandler — list/status 액션", () => {
  it("list → list_promises + get_effective_promises 호출", async () => {
    const svc = make_promise_service();
    const h = new PromiseHandler(make_access(svc));
    const ctx = make_ctx("promise", ["list"]);
    await h.handle(ctx);
    expect(svc.list_promises).toHaveBeenCalledOnce();
    expect(svc.get_effective_promises).toHaveBeenCalledOnce();
    expect(ctx.replies[0]).toContain("약속");
  });

  it("목록 alias → list 처리", async () => {
    const svc = make_promise_service();
    const h = new PromiseHandler(make_access(svc));
    const ctx = make_ctx("promise", ["목록"]);
    await h.handle(ctx);
    expect(svc.list_promises).toHaveBeenCalledOnce();
  });

  it("알 수 없는 action → status(기본) 처리", async () => {
    const svc = make_promise_service();
    const h = new PromiseHandler(make_access(svc));
    const ctx = make_ctx("promise", ["unknown_action"]);
    await h.handle(ctx);
    expect(svc.list_promises).toHaveBeenCalledOnce();
  });

  it("effective promises 없음 → '없음' 표시", async () => {
    const svc = make_promise_service({
      list_promises: vi.fn().mockResolvedValue([]),
      get_effective_promises: vi.fn().mockResolvedValue([]),
    });
    const h = new PromiseHandler(make_access(svc));
    const ctx = make_ctx("promise", ["list"]);
    await h.handle(ctx);
    expect(ctx.replies[0]).toContain("없음");
  });

  it("12개 초과 effective promises → 12개로 제한", async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      priority: 0,
      canonical_key: `key.${i}`,
      value: `value ${i}`,
    }));
    const svc = make_promise_service({
      list_promises: vi.fn().mockResolvedValue(many),
      get_effective_promises: vi.fn().mockResolvedValue(many),
    });
    const h = new PromiseHandler(make_access(svc));
    const ctx = make_ctx("promise", ["list"]);
    await h.handle(ctx);
    const reply = ctx.replies[0]!;
    // 12개까지만 표시
    const line_count = reply.split("\n").filter((l) => l.startsWith("- [P")).length;
    expect(line_count).toBeLessThanOrEqual(12);
  });

  it("결과에 action, key, value 포함 (set 결과)", async () => {
    const svc = make_promise_service({
      append_promise: vi.fn().mockResolvedValue({
        action: "updated",
        record: { canonical_key: "my.rule", value: "be concise", updated_at: "2024-01-01" },
      }),
    });
    const h = new PromiseHandler(make_access(svc));
    const ctx = make_ctx("promise", ["set", "my.rule=be", "concise"]);
    await h.handle(ctx);
    expect(ctx.replies[0]).toContain("updated");
    expect(ctx.replies[0]).toContain("my.rule");
    expect(ctx.replies[0]).toContain("be concise");
  });
});

// ══════════════════════════════════════════
// args 없음 (guide)
// ══════════════════════════════════════════

describe("PromiseHandler — args 없음", () => {
  it("args 없음 → 가이드 또는 기본 처리", async () => {
    const svc = make_promise_service();
    const h = new PromiseHandler(make_access(svc));
    const ctx = make_ctx("promise", []);
    await h.handle(ctx);
    // 가이드가 있으면 가이드, 없으면 list 처리
    expect(ctx.replies.length).toBeGreaterThan(0);
  });
});
