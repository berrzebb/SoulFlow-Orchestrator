import { describe, it, expect, vi } from "vitest";
import {
  ApprovalService,
  extract_reaction_names,
  is_control_stop_reaction,
} from "@src/channels/approval.service.js";
import type { InboundMessage } from "@src/bus/types.js";

function make_message(overrides?: Partial<InboundMessage>): InboundMessage {
  return {
    id: `msg-${Date.now()}`,
    provider: "slack",
    channel: "slack",
    sender_id: "user1",
    chat_id: "C123",
    content: "yes",
    at: new Date().toISOString(),
    metadata: {},
    ...overrides,
  };
}

function make_runtime(pending: any[] = []) {
  return {
    list_approval_requests: vi.fn((status: string) =>
      status === "pending" ? pending : [],
    ),
    get_approval_request: vi.fn((id: string) =>
      pending.find((p: any) => p.request_id === id) || null,
    ),
    resolve_approval_request: vi.fn((_id: string, _text: string) => ({
      ok: true,
      decision: "approve",
      status: "approved",
      confidence: 0.9,
    })),
    execute_approved_request: vi.fn(async (_id: string) => ({
      ok: true,
      status: "approved",
      tool_name: "exec",
      result: "done",
    })),
  };
}

function make_deps(runtime?: any) {
  const send_reply = vi.fn(async () => ({ ok: true }));
  const resolve_reply_to = vi.fn(() => "reply-to-id");
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(function(this: any) { return this; }),
  };

  return {
    agent_runtime: runtime || null,
    send_reply,
    resolve_reply_to,
    logger: logger as any,
  };
}

describe("ApprovalService", () => {
  it("returns { handled: false } when no runtime is configured", async () => {
    const deps = make_deps(null);
    const service = new ApprovalService(deps);
    const result = await service.try_handle_text_reply("slack", make_message());
    expect(result.handled).toBe(false);
  });

  it("returns { handled: false } when no pending approvals exist", async () => {
    const runtime = make_runtime([]);
    const deps = make_deps(runtime);
    const service = new ApprovalService(deps);
    const result = await service.try_handle_text_reply("slack", make_message());
    expect(result.handled).toBe(false);
  });

  it("handles text approval when matching pending request exists", async () => {
    const pending = [{
      request_id: "req-abc123",
      tool_name: "exec",
      params: { command: "rm -rf /tmp/test" },
      detail: "restricted operation",
      created_at: new Date().toISOString(),
      status: "pending",
      context: { channel: "slack", chat_id: "C123", task_id: "task-42" },
    }];
    const runtime = make_runtime(pending);
    const deps = make_deps(runtime);
    const service = new ApprovalService(deps);

    const msg = make_message({ content: "yes 승인" });
    const result = await service.try_handle_text_reply("slack", msg);

    expect(result.handled).toBe(true);
    expect(result.task_id).toBe("task-42");
    expect(result.tool_result).toBe("done");
    expect(runtime.resolve_approval_request).toHaveBeenCalledWith("req-abc123", "yes 승인");
    expect(runtime.execute_approved_request).toHaveBeenCalledWith("req-abc123");
    expect(deps.send_reply).toHaveBeenCalled();
  });

  it("handles explicit request_id in message", async () => {
    const pending = [
      {
        request_id: "abc12345",
        tool_name: "exec",
        params: {},
        detail: "test",
        created_at: new Date().toISOString(),
        status: "pending",
        context: { channel: "slack", chat_id: "other-chat" },
      },
    ];
    const runtime = make_runtime(pending);
    const deps = make_deps(runtime);
    const service = new ApprovalService(deps);

    const msg = make_message({ content: "request_id: abc12345 approve" });
    const result = await service.try_handle_text_reply("slack", msg);

    expect(result.handled).toBe(true);
    expect(runtime.resolve_approval_request).toHaveBeenCalledWith(
      "abc12345",
      expect.any(String),
    );
  });

  it("handles denial", async () => {
    const pending = [{
      request_id: "req-deny123",
      tool_name: "exec",
      params: {},
      detail: "test",
      created_at: new Date().toISOString(),
      status: "pending",
      context: { channel: "slack", chat_id: "C123" },
    }];
    const runtime = make_runtime(pending);
    runtime.resolve_approval_request.mockReturnValue({
      ok: true,
      decision: "deny",
      status: "denied",
      confidence: 0.95,
    });
    const deps = make_deps(runtime);
    const service = new ApprovalService(deps);

    const msg = make_message({ content: "no 거절" });
    const result = await service.try_handle_text_reply("slack", msg);

    expect(result.handled).toBe(true);
    expect(result.task_id).toBeUndefined();
    const reply = deps.send_reply.mock.calls[0][1];
    expect(reply.content).toContain("거부");
  });

  it("try_handle_approval_reactions returns { handled: false } without runtime", async () => {
    const deps = make_deps(null);
    const service = new ApprovalService(deps);

    const result = await service.try_handle_approval_reactions("telegram", [make_message()]);
    expect(result.handled).toBe(false);
  });

  it("try_handle_approval_reactions processes slack reactions", async () => {
    const pending = [{
      request_id: "rxn-test12",
      tool_name: "exec",
      params: {},
      detail: "test",
      created_at: new Date().toISOString(),
      status: "pending",
      context: { channel: "slack", chat_id: "C123" },
    }];
    const runtime = make_runtime(pending);
    const deps = make_deps(runtime);
    const service = new ApprovalService(deps);

    const msg = make_message({
      content: "request_id: rxn-test12",
      metadata: {
        slack: {
          reactions: [{ name: "white_check_mark", count: 1 }],
        },
      },
    });

    const result = await service.try_handle_approval_reactions("slack", [msg]);
    expect(result.handled).toBe(true);
    expect(runtime.resolve_approval_request).toHaveBeenCalledWith("rxn-test12", "✅");
  });

  it("try_handle_approval_reactions processes telegram emoji reactions", async () => {
    const pending = [{
      request_id: "tg-rxn-001",
      tool_name: "exec",
      params: {},
      detail: "test",
      created_at: new Date().toISOString(),
      status: "pending",
      context: { channel: "telegram", chat_id: "C123" },
    }];
    const runtime = make_runtime(pending);
    const deps = make_deps(runtime);
    const service = new ApprovalService(deps);

    const msg = make_message({
      content: "",
      metadata: {
        is_reaction: true,
        telegram_reaction: {
          message_id: "456",
          emoji: ["👍"],
        },
      },
    });

    const result = await service.try_handle_approval_reactions("telegram", [msg]);
    expect(result.handled).toBe(true);
    expect(runtime.resolve_approval_request).toHaveBeenCalledWith("tg-rxn-001", "✅");
  });

  it("try_handle_approval_reactions: telegram 👎 emoji → deny", async () => {
    const pending = [{
      request_id: "tg-deny-01",
      tool_name: "exec",
      params: {},
      detail: "test",
      created_at: new Date().toISOString(),
      status: "pending",
      context: { channel: "telegram", chat_id: "C123" },
    }];
    const runtime = make_runtime(pending);
    runtime.resolve_approval_request.mockReturnValue({
      ok: true, decision: "deny", status: "denied", confidence: 0.9,
    });
    const deps = make_deps(runtime);
    const service = new ApprovalService(deps);

    const msg = make_message({
      content: "",
      metadata: {
        is_reaction: true,
        telegram_reaction: { message_id: "789", emoji: ["👎"] },
      },
    });

    const result = await service.try_handle_approval_reactions("telegram", [msg]);
    expect(result.handled).toBe(true);
    expect(runtime.resolve_approval_request).toHaveBeenCalledWith("tg-deny-01", "❌");
  });

  it("try_handle_approval_reactions: no matching pending request → handled: false", async () => {
    const pending = [{
      request_id: "other-chat",
      tool_name: "exec",
      params: {},
      created_at: new Date().toISOString(),
      status: "pending",
      context: { channel: "telegram", chat_id: "DIFFERENT" },
    }];
    const runtime = make_runtime(pending);
    const deps = make_deps(runtime);
    const service = new ApprovalService(deps);

    const msg = make_message({
      content: "",
      metadata: {
        is_reaction: true,
        telegram_reaction: { message_id: "1", emoji: ["👍"] },
      },
    });

    const result = await service.try_handle_approval_reactions("telegram", [msg]);
    expect(result.handled).toBe(false);
  });

  it("prune_seen removes old entries", () => {
    const deps = make_deps(make_runtime());
    const service = new ApprovalService(deps);
    // Access private field for testing
    const seen = (service as any).reaction_seen as Map<string, number>;
    seen.set("old-key", Date.now() - 100_000);
    seen.set("new-key", Date.now());

    service.prune_seen(50_000, 100);
    expect(seen.has("old-key")).toBe(false);
    expect(seen.has("new-key")).toBe(true);
  });

  it("try_handle_approval_reactions processes discord reactions", async () => {
    const pending = [{
      request_id: "dc-rxn-001",
      tool_name: "exec",
      params: {},
      detail: "test",
      created_at: new Date().toISOString(),
      status: "pending",
      context: { channel: "discord", chat_id: "C123" },
    }];
    const runtime = make_runtime(pending);
    const deps = make_deps(runtime);
    const service = new ApprovalService(deps);

    const msg = make_message({
      provider: "discord",
      content: "",
      metadata: {
        is_reaction: true,
        discord: {
          reactions: [{ emoji: { name: "white_check_mark" }, count: 1 }],
        },
      },
    });

    const result = await service.try_handle_approval_reactions("discord", [msg]);
    expect(result.handled).toBe(true);
  });

  it("returns { handled: false } for empty message content", async () => {
    const runtime = make_runtime([{
      request_id: "r1",
      context: { channel: "slack", chat_id: "C123" },
    }]);
    const deps = make_deps(runtime);
    const service = new ApprovalService(deps);

    const result = await service.try_handle_text_reply("slack", make_message({ content: "" }));
    expect(result.handled).toBe(false);
  });

  // ── cov2: is_control_stop_reaction ──

  describe("is_control_stop_reaction", () => {
    it("octagonal_sign → true", () => {
      expect(is_control_stop_reaction(["octagonal_sign"])).toBe(true);
    });
    it("stop_sign → true", () => {
      expect(is_control_stop_reaction(["stop_sign"])).toBe(true);
    });
    it("thumbsup → false", () => {
      expect(is_control_stop_reaction(["thumbsup"])).toBe(false);
    });
    it("빈 배열 → false", () => {
      expect(is_control_stop_reaction([])).toBe(false);
    });
  });

  // ── cov2: extract_reaction_names ──

  describe("extract_reaction_names", () => {
    it("metadata 없음 → []", () => {
      const msg = make_message({ metadata: undefined });
      expect(extract_reaction_names(msg)).toEqual([]);
    });
    it("metadata 빈 객체 → []", () => {
      const msg = make_message({ metadata: {} });
      expect(extract_reaction_names(msg)).toEqual([]);
    });
  });

  // ── cov2: defer/cancel 리액션 ──

  describe("defer/cancel 리액션", () => {
    it("pause_button → defer 결정", async () => {
      const runtime = make_runtime([{
        request_id: "req-defer1",
        context: { channel: "slack", chat_id: "C123" },
        tool_name: "my_tool",
      }]);
      runtime.get_approval_request.mockReturnValue({
        request_id: "req-defer1", tool_name: "my_tool",
        context: { channel: "slack", chat_id: "C123" },
      });
      runtime.resolve_approval_request.mockReturnValue({
        ok: true, status: "deferred", decision: "⏸️",
      });
      const deps = make_deps(runtime);
      const service = new ApprovalService(deps);
      const msg = make_message({
        metadata: { slack: { reactions: [{ name: "pause_button" }] } },
      });
      const r = await service.try_handle_approval_reactions("slack", [msg]);
      expect(r.handled).toBe(true);
      expect(r.approval_status).toBe("deferred");
    });

    it("octagonal_sign → cancel 결정", async () => {
      const runtime = make_runtime([{
        request_id: "req-cancel1",
        context: { channel: "slack", chat_id: "C123" },
        tool_name: "my_tool",
      }]);
      runtime.get_approval_request.mockReturnValue({
        request_id: "req-cancel1", tool_name: "my_tool",
        context: { channel: "slack", chat_id: "C123" },
      });
      runtime.resolve_approval_request.mockReturnValue({
        ok: true, status: "cancelled", decision: "⛔",
      });
      const deps = make_deps(runtime);
      const service = new ApprovalService(deps);
      const msg = make_message({
        metadata: { slack: { reactions: [{ name: "octagonal_sign" }] } },
      });
      const r = await service.try_handle_approval_reactions("slack", [msg]);
      expect(r.handled).toBe(true);
      expect(r.approval_status).toBe("cancelled");
    });

    it("thinking_face → defer 결정 (telegram)", async () => {
      const runtime = make_runtime([{
        request_id: "req-think1",
        context: { channel: "telegram", chat_id: "T99" },
        tool_name: "search",
      }]);
      runtime.get_approval_request.mockReturnValue({
        request_id: "req-think1", tool_name: "search",
        context: { channel: "telegram", chat_id: "T99" },
      });
      runtime.resolve_approval_request.mockReturnValue({
        ok: true, status: "deferred", decision: "⏸️",
      });
      const deps = make_deps(runtime);
      const service = new ApprovalService(deps);
      const msg = make_message({
        chat_id: "T99",
        metadata: { telegram_reaction: { emoji: ["🤔"] } },
      });
      const r = await service.try_handle_approval_reactions("telegram", [msg]);
      expect(r.handled).toBe(true);
    });
  });

  // ── cov2: execute 실패, resolve 실패, prune overflow, unknown reaction ──

  it("execute_approved_request 실패 → 실패 메시지 전송", async () => {
    const runtime = make_runtime([{
      request_id: "req-fail1",
      context: { channel: "slack", chat_id: "C123" },
      tool_name: "risky_tool",
    }]);
    runtime.get_approval_request.mockReturnValue({
      request_id: "req-fail1", tool_name: "risky_tool",
      context: { channel: "slack", chat_id: "C123", task_id: "task-001" },
    });
    runtime.execute_approved_request.mockResolvedValue({
      ok: false, error: "Permission denied", tool_name: "risky_tool",
    });
    const deps = make_deps(runtime);
    const service = new ApprovalService(deps);
    const r = await service.try_handle_text_reply("slack", make_message({ content: "승인" }));
    expect(r.handled).toBe(true);
    expect(deps.send_reply).toHaveBeenCalled();
  });

  it("resolve_approval_request ok=false → handled: false", async () => {
    const runtime = make_runtime([{
      request_id: "req-nores1",
      context: { channel: "slack", chat_id: "C123" },
      tool_name: "t",
    }]);
    runtime.get_approval_request.mockReturnValue({
      request_id: "req-nores1", tool_name: "t",
      context: { channel: "slack", chat_id: "C123" },
    });
    runtime.resolve_approval_request.mockReturnValue({ ok: false });
    const deps = make_deps(runtime);
    const service = new ApprovalService(deps);
    const r = await service.try_handle_text_reply("slack", make_message({ content: "maybe" }));
    expect(r.handled).toBe(false);
  });

  it("prune_seen overflow → 가장 오래된 항목 제거", () => {
    const deps = make_deps(make_runtime());
    const service = new ApprovalService(deps);
    const map = (service as any).reaction_seen as Map<string, number>;
    for (let i = 0; i < 5; i++) map.set(`key-${i}`, Date.now());
    service.prune_seen(99999, 2);
    expect(map.size).toBeLessThanOrEqual(2);
  });

  it("unknown 이모지(smile) → handled: false", async () => {
    const runtime = make_runtime([{
      request_id: "req-unk",
      context: { channel: "slack", chat_id: "C000" },
      tool_name: "t",
    }]);
    const deps = make_deps(runtime);
    const service = new ApprovalService(deps);
    const msg = make_message({
      chat_id: "C000",
      metadata: { slack: { reactions: [{ name: "smile" }] } },
    });
    const r = await service.try_handle_approval_reactions("slack", [msg]);
    expect(r.handled).toBe(false);
  });

  // ── cov3: names.length === 0 → continue ──

  it("리액션 없는 메시지 + 유효 메시지 혼재 → continue 후 처리", async () => {
    const pending = [{
      request_id: "req1",
      context: { channel: "slack", chat_id: "C123" },
      tool_name: "t",
    }];
    const runtime = make_runtime(pending);
    runtime.get_approval_request.mockReturnValue({
      request_id: "req1", tool_name: "t",
      context: { channel: "slack", chat_id: "C123" },
    });
    const deps = make_deps(runtime);
    const service = new ApprovalService(deps);
    const rows = [
      make_message({ metadata: {} }),
      make_message({ metadata: { slack: { reactions: [{ name: "thumbsup" }] } } }),
    ];
    const result = await service.try_handle_approval_reactions("slack", rows);
    expect(result).toBeDefined();
  });

  // ── cov4: reaction_seen dedup + get_approval_request null ──

  it("동일 리액션 두 번 → reaction_seen 적중 → handled: false", async () => {
    const runtime = make_runtime([{
      request_id: "req1",
      context: { channel: "slack", chat_id: "C123" },
      tool_name: "test",
    }]);
    runtime.get_approval_request.mockReturnValue({
      request_id: "req1", tool_name: "test",
      context: { channel: "slack", chat_id: "C123" },
    });
    const deps = make_deps(runtime);
    const service = new ApprovalService(deps);
    const msg = make_message({ metadata: { slack: { reactions: [{ name: "thumbsup" }] } } });
    await service.try_handle_approval_reactions("slack", [msg]);
    const second = await service.try_handle_approval_reactions("slack", [msg]);
    expect(second.handled).toBe(false);
  });

  it("get_approval_request null → handled: false", async () => {
    const runtime = make_runtime([{
      request_id: "req_missing",
      context: { channel: "slack", chat_id: "C123" },
      tool_name: "test",
    }]);
    runtime.get_approval_request.mockReturnValue(null);
    const deps = make_deps(runtime);
    const service = new ApprovalService(deps);
    const msg = make_message({ metadata: { slack: { reactions: [{ name: "thumbsup" }] } } });
    const result = await service.try_handle_approval_reactions("slack", [msg]);
    expect(result.handled).toBe(false);
  });

  // ── cov5: apply_decision private method with null runtime ──

  describe("apply_decision — null runtime guard", () => {
    it("source='text' → { handled: false }", async () => {
      const service = new ApprovalService({
        agent_runtime: null,
        send_reply: vi.fn().mockResolvedValue({ ok: true }),
        resolve_reply_to: vi.fn().mockReturnValue("reply-to"),
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
      });
      const result = await (service as any).apply_decision(
        "slack", make_message(), "req-id-001", "yes", "text",
      );
      expect(result).toEqual({ handled: false });
    });

    it("source='reaction' → { handled: false }", async () => {
      const service = new ApprovalService({
        agent_runtime: null,
        send_reply: vi.fn().mockResolvedValue({ ok: true }),
        resolve_reply_to: vi.fn().mockReturnValue("reply-to"),
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
      });
      const result = await (service as any).apply_decision(
        "telegram", make_message({ chat_id: "tg-chat" }), "req-id-002", "✅", "reaction",
      );
      expect(result).toEqual({ handled: false });
    });
  });
});
