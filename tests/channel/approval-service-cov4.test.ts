/**
 * ApprovalService — 미커버 분기 (cov4):
 * - L81: try_handle_approval_reactions — reaction_seen.has(sig) → continue
 * - L111: apply_decision — get_approval_request(id) null → handled: false
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

// ── L81: reaction_seen.has(sig) → continue ───────────────────────────────────

describe("ApprovalService — L81: 중복 리액션 → reaction_seen 적중 → continue", () => {
  it("동일 리액션 두 번 호출 → 두 번째는 L81 continue → handled: false", async () => {
    const runtime = make_runtime({
      list_approval_requests: vi.fn().mockReturnValue([{
        request_id: "req1",
        context: { channel: "slack", chat_id: "C1" },
        tool_name: "test",
      }]),
      get_approval_request: vi.fn().mockReturnValue({
        request_id: "req1", tool_name: "test",
        context: { channel: "slack", chat_id: "C1" },
      }),
      resolve_approval_request: vi.fn().mockReturnValue({ ok: true, status: "approved" }),
    });
    const svc = new ApprovalService(make_deps(runtime));
    const msg = make_msg("C1", { slack: { reactions: [{ name: "thumbsup" }] } });

    // 첫 번째 호출 → reaction_seen에 sig 추가 + apply_decision 실행
    await svc.try_handle_approval_reactions("slack", [msg]);

    // 두 번째 호출 → sig가 reaction_seen에 있음 → L81: reaction_seen.has(sig) → continue
    const second = await svc.try_handle_approval_reactions("slack", [msg]);
    expect(second.handled).toBe(false);
  });
});

// ── L111: apply_decision — get_approval_request null → handled: false ────────

describe("ApprovalService — L111: get_approval_request null → handled: false", () => {
  it("list_approval_requests는 있지만 get_approval_request null → L111 early return", async () => {
    const runtime = make_runtime({
      list_approval_requests: vi.fn().mockReturnValue([{
        request_id: "req_missing",
        context: { channel: "slack", chat_id: "C2" },
        tool_name: "test",
      }]),
      // get_approval_request는 null 반환 → L111
      get_approval_request: vi.fn().mockReturnValue(null),
    });
    const svc = new ApprovalService(make_deps(runtime));
    const msg = make_msg("C2", { slack: { reactions: [{ name: "thumbsup" }] } });

    const result = await svc.try_handle_approval_reactions("slack", [msg]);
    // apply_decision → L111: get_approval_request null → { handled: false }
    expect(result.handled).toBe(false);
  });
});
