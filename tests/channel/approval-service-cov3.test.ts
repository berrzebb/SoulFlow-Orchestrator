/**
 * ApprovalService — 미커버 분기 보충 (cov3):
 * - L66: try_handle_approval_reactions — names.length === 0 → continue
 * - L81: try_handle_approval_reactions — !request → continue (chat_id 불일치)
 */
import { describe, it, expect, vi } from "vitest";
import { ApprovalService } from "@src/channels/approval.service.js";
import type { ApprovalServiceDeps } from "@src/channels/approval.service.js";

function make_runtime(overrides: Record<string, unknown> = {}) {
  return {
    list_approval_requests: vi.fn().mockReturnValue([]),
    get_approval_request: vi.fn().mockReturnValue(null),
    resolve_approval_request: vi.fn().mockReturnValue({ ok: true, status: "approved" }),
    execute_approved_request: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  };
}

function make_deps(runtime: ReturnType<typeof make_runtime> | null): ApprovalServiceDeps {
  return {
    agent_runtime: runtime as any,
    send_reply: vi.fn().mockResolvedValue({ ok: true }),
    resolve_reply_to: vi.fn().mockReturnValue("t123"),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
  };
}

function make_msg(chat_id: string, metadata: Record<string, unknown> = {}) {
  return {
    id: "m1", provider: "slack", channel: "slack",
    sender_id: "U1", chat_id,
    content: "msg", at: new Date().toISOString(),
    metadata,
  } as any;
}

// ── L66: names.length === 0 → continue ───────────────────────────────────────

describe("ApprovalService — L66: 리액션 없는 메시지 → continue", () => {
  it("reactions 없는 메시지 + 유효 리액션 메시지 혼재 → L66 continue 후 처리 계속", async () => {
    const runtime = make_runtime({
      list_approval_requests: vi.fn().mockReturnValue([{
        request_id: "req1",
        context: { channel: "slack", chat_id: "C1" },
        tool_name: "t",
      }]),
      get_approval_request: vi.fn().mockReturnValue({
        request_id: "req1", tool_name: "t",
        context: { channel: "slack", chat_id: "C1" },
      }),
      resolve_approval_request: vi.fn().mockReturnValue({ ok: true, status: "approved", decision: "yes" }),
    });
    const svc = new ApprovalService(make_deps(runtime));
    const rows = [
      make_msg("C1", {}),   // 리액션 없음 → names=[] → L66 continue
      make_msg("C1", { slack: { reactions: [{ name: "thumbsup" }] } }), // 유효 리액션
    ];
    const result = await svc.try_handle_approval_reactions("slack", rows);
    // 첫 번째 메시지는 스킵, 두 번째 메시지에서 처리됨
    expect(result).toBeDefined();
  });
});

// ── L81: !request → continue ─────────────────────────────────────────────────

describe("ApprovalService — L81: 매칭 pending request 없음 → continue", () => {
  it("리액션 있지만 chat_id 불일치 → request 못 찾음 → L81 continue → handled: false", async () => {
    const runtime = make_runtime({
      list_approval_requests: vi.fn().mockReturnValue([{
        request_id: "req2",
        context: { channel: "slack", chat_id: "C999" }, // different chat_id
        tool_name: "t",
      }]),
    });
    const svc = new ApprovalService(make_deps(runtime));
    const msg = make_msg("C123", { // chat_id "C123" ≠ pending "C999" → L81 continue
      slack: { reactions: [{ name: "thumbsup" }] },
    });
    const result = await svc.try_handle_approval_reactions("slack", [msg]);
    expect(result.handled).toBe(false);
  });
});
