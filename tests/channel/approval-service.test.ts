import { describe, it, expect, vi } from "vitest";
import { ApprovalService } from "@src/channels/approval.service.js";
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
});
