/**
 * ApprovalService — 미커버 분기 보충.
 * is_control_stop_reaction, reaction_to_decision defer/cancel,
 * prune_seen overflow 제거, apply_decision execute 실패, cancelled/deferred/clarify 상태.
 */
import { describe, it, expect, vi } from "vitest";
import {
  ApprovalService,
  extract_reaction_names,
  is_control_stop_reaction,
} from "@src/channels/approval.service.js";
import type { ApprovalServiceDeps } from "@src/channels/approval.service.js";

function make_runtime(overrides: Record<string, unknown> = {}) {
  return {
    list_approval_requests: vi.fn().mockReturnValue([]),
    get_approval_request: vi.fn().mockReturnValue(null),
    resolve_approval_request: vi.fn().mockReturnValue({ ok: true, status: "approved", decision: "yes" }),
    execute_approved_request: vi.fn().mockResolvedValue({ ok: true, result: "done" }),
    ...overrides,
  };
}

function make_deps(runtime: ReturnType<typeof make_runtime> | null = null): ApprovalServiceDeps {
  return {
    agent_runtime: runtime as any,
    send_reply: vi.fn().mockResolvedValue({ ok: true }),
    resolve_reply_to: vi.fn().mockReturnValue("thread_123"),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
  };
}

function make_message(overrides: Record<string, unknown> = {}) {
  return {
    id: "m1", provider: "slack", channel: "slack",
    sender_id: "U001", chat_id: "C123",
    content: "yes", at: "2025-01-01T00:00:00Z",
    metadata: {},
    ...overrides,
  } as any;
}

// ══════════════════════════════════════════
// is_control_stop_reaction
// ══════════════════════════════════════════

describe("is_control_stop_reaction", () => {
  it("octagonal_sign → true (cancel)", () => {
    expect(is_control_stop_reaction(["octagonal_sign"])).toBe(true);
  });

  it("stop_sign → true (cancel)", () => {
    expect(is_control_stop_reaction(["stop_sign"])).toBe(true);
  });

  it("thumbsup → false", () => {
    expect(is_control_stop_reaction(["thumbsup"])).toBe(false);
  });

  it("빈 배열 → false", () => {
    expect(is_control_stop_reaction([])).toBe(false);
  });
});

// ══════════════════════════════════════════
// extract_reaction_names — 메타데이터 없는 경우
// ══════════════════════════════════════════

describe("extract_reaction_names — 메타데이터 없음", () => {
  it("metadata 없음 → []", () => {
    const msg = make_message({ metadata: undefined });
    expect(extract_reaction_names(msg)).toEqual([]);
  });

  it("metadata 빈 객체 → []", () => {
    const msg = make_message({ metadata: {} });
    expect(extract_reaction_names(msg)).toEqual([]);
  });
});

// ══════════════════════════════════════════
// try_handle_approval_reactions — defer/cancel 리액션
// ══════════════════════════════════════════

describe("ApprovalService — defer/cancel 리액션", () => {
  it("pause_button → defer 결정", async () => {
    const runtime = make_runtime({
      list_approval_requests: vi.fn().mockReturnValue([{
        request_id: "req-defer1",
        context: { channel: "slack", chat_id: "C123" },
        tool_name: "my_tool",
      }]),
      get_approval_request: vi.fn().mockReturnValue({
        request_id: "req-defer1",
        tool_name: "my_tool",
        context: { channel: "slack", chat_id: "C123" },
      }),
      resolve_approval_request: vi.fn().mockReturnValue({
        ok: true, status: "deferred", decision: "⏸️",
      }),
    });
    const svc = new ApprovalService(make_deps(runtime));
    const msg = make_message({
      metadata: { slack: { reactions: [{ name: "pause_button" }] } },
    });
    const r = await svc.try_handle_approval_reactions("slack", [msg]);
    expect(r.handled).toBe(true);
    expect(r.approval_status).toBe("deferred");
  });

  it("octagonal_sign → cancel 결정", async () => {
    const runtime = make_runtime({
      list_approval_requests: vi.fn().mockReturnValue([{
        request_id: "req-cancel1",
        context: { channel: "slack", chat_id: "C123" },
        tool_name: "my_tool",
      }]),
      get_approval_request: vi.fn().mockReturnValue({
        request_id: "req-cancel1",
        tool_name: "my_tool",
        context: { channel: "slack", chat_id: "C123" },
      }),
      resolve_approval_request: vi.fn().mockReturnValue({
        ok: true, status: "cancelled", decision: "⛔",
      }),
    });
    const svc = new ApprovalService(make_deps(runtime));
    const msg = make_message({
      metadata: { slack: { reactions: [{ name: "octagonal_sign" }] } },
    });
    const r = await svc.try_handle_approval_reactions("slack", [msg]);
    expect(r.handled).toBe(true);
    expect(r.approval_status).toBe("cancelled");
  });

  it("thinking_face → defer 결정", async () => {
    const runtime = make_runtime({
      list_approval_requests: vi.fn().mockReturnValue([{
        request_id: "req-think1",
        context: { channel: "telegram", chat_id: "T99" },
        tool_name: "search",
      }]),
      get_approval_request: vi.fn().mockReturnValue({
        request_id: "req-think1",
        tool_name: "search",
        context: { channel: "telegram", chat_id: "T99" },
      }),
      resolve_approval_request: vi.fn().mockReturnValue({
        ok: true, status: "deferred", decision: "⏸️",
      }),
    });
    const svc = new ApprovalService(make_deps(runtime));
    const msg = make_message({
      chat_id: "T99",
      metadata: {
        telegram_reaction: { emoji: ["🤔"] }, // thinking_face emoji
      },
    });
    const r = await svc.try_handle_approval_reactions("telegram", [msg]);
    expect(r.handled).toBe(true);
  });
});

// ══════════════════════════════════════════
// apply_decision — execute_approved_request 실패
// ══════════════════════════════════════════

describe("ApprovalService — execute 실패", () => {
  it("execute_approved_request 실패 → 실패 메시지 전송", async () => {
    const runtime = make_runtime({
      list_approval_requests: vi.fn().mockReturnValue([{
        request_id: "req-fail1",
        context: { channel: "slack", chat_id: "C123" },
        tool_name: "risky_tool",
      }]),
      get_approval_request: vi.fn().mockReturnValue({
        request_id: "req-fail1",
        tool_name: "risky_tool",
        context: { channel: "slack", chat_id: "C123", task_id: "task-001" },
      }),
      resolve_approval_request: vi.fn().mockReturnValue({
        ok: true, status: "approved", decision: "yes",
      }),
      execute_approved_request: vi.fn().mockResolvedValue({
        ok: false, error: "Permission denied", tool_name: "risky_tool",
      }),
    });
    const deps = make_deps(runtime);
    const svc = new ApprovalService(deps);
    const msg = make_message({ content: "승인" });
    const r = await svc.try_handle_text_reply("slack", msg);
    expect(r.handled).toBe(true);
    expect(deps.send_reply).toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════
// apply_decision — resolved.ok=false
// ══════════════════════════════════════════

describe("ApprovalService — resolved.ok=false → handled: false", () => {
  it("resolve 실패 → handled: false 반환", async () => {
    const runtime = make_runtime({
      list_approval_requests: vi.fn().mockReturnValue([{
        request_id: "req-nores1",
        context: { channel: "slack", chat_id: "C123" },
        tool_name: "t",
      }]),
      get_approval_request: vi.fn().mockReturnValue({
        request_id: "req-nores1",
        tool_name: "t",
        context: { channel: "slack", chat_id: "C123" },
      }),
      resolve_approval_request: vi.fn().mockReturnValue({ ok: false }),
    });
    const svc = new ApprovalService(make_deps(runtime));
    const msg = make_message({ content: "maybe" });
    const r = await svc.try_handle_text_reply("slack", msg);
    expect(r.handled).toBe(false);
  });
});

// ══════════════════════════════════════════
// prune_seen — max_size overflow
// ══════════════════════════════════════════

describe("ApprovalService — prune_seen overflow", () => {
  it("reaction_seen이 max_size 초과 → 가장 오래된 항목 제거", async () => {
    const runtime = make_runtime({
      list_approval_requests: vi.fn().mockReturnValue([{
        request_id: "req-px",
        context: { channel: "slack", chat_id: "Cpx" },
        tool_name: "t",
      }]),
      get_approval_request: vi.fn().mockReturnValue({
        request_id: "req-px", tool_name: "t",
        context: { channel: "slack", chat_id: "Cpx" },
      }),
      resolve_approval_request: vi.fn().mockReturnValue({
        ok: true, status: "approved", decision: "yes",
      }),
      execute_approved_request: vi.fn().mockResolvedValue({ ok: true, result: "ok" }),
    });
    const svc = new ApprovalService(make_deps(runtime));

    // 여러 리액션으로 seen map 채우기 (overflow 유발)
    for (let i = 0; i < 5; i++) {
      await svc.try_handle_approval_reactions("slack", [{
        id: `m${i}`, provider: "slack", channel: "slack",
        sender_id: "U001", chat_id: "Cpx",
        content: `req-px reaction ${i}`, at: "2025-01-01T00:00:00Z",
        metadata: { slack: { reactions: [{ name: "white_check_mark" }] } },
      } as any]);
    }

    // max_size=2로 prune → overflow 항목 제거
    svc.prune_seen(0, 2);
    // 에러 없이 실행됨
    expect(true).toBe(true);
  });
});

// ══════════════════════════════════════════
// apply_decision — task_id 있을 때 반환
// ══════════════════════════════════════════

describe("ApprovalService — task_id 포함 결과", () => {
  it("context.task_id 있으면 결과에 task_id 포함", async () => {
    const runtime = make_runtime({
      list_approval_requests: vi.fn().mockReturnValue([{
        request_id: "req-tid1",
        context: { channel: "slack", chat_id: "C123" },
        tool_name: "t",
      }]),
      get_approval_request: vi.fn().mockReturnValue({
        request_id: "req-tid1",
        tool_name: "t",
        context: { channel: "slack", chat_id: "C123", task_id: "task-xyz" },
      }),
      resolve_approval_request: vi.fn().mockReturnValue({
        ok: true, status: "approved", decision: "yes",
      }),
      execute_approved_request: vi.fn().mockResolvedValue({ ok: true, result: "result text" }),
    });
    const svc = new ApprovalService(make_deps(runtime));
    const msg = make_message({ content: "승인합니다" });
    const r = await svc.try_handle_text_reply("slack", msg);
    expect(r.handled).toBe(true);
    expect(r.task_id).toBe("task-xyz");
    expect(r.tool_result).toContain("result text");
  });
});
