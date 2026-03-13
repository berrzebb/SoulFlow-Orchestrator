/**
 * IDOR 소유권 검증 테스트 (Approach B: Filtered Ops).
 * 서비스 mutation 메서드가 { team_id } opts를 수신하여 내부에서 소유권 검증.
 * "없음"과 "권한 없음"이 동일한 외부 결과(404)로 노출되어야 함.
 */
import { describe, it, expect, vi } from "vitest";
import type { RouteContext } from "@src/dashboard/route-context.ts";
import { handle_agent } from "@src/dashboard/routes/agent.ts";
import { handle_loop } from "@src/dashboard/routes/loop.ts";
import { handle_approval } from "@src/dashboard/routes/approval.ts";
import { handle_cron } from "@src/dashboard/routes/cron.ts";
import { handle_process } from "@src/dashboard/routes/process.ts";
import { handle_task } from "@src/dashboard/routes/task.ts";

// ── helpers ──

function make_ctx(overrides: Record<string, unknown> = {}): RouteContext & { _responses: Array<{ status: number; body: unknown }> } {
  const responses: Array<{ status: number; body: unknown }> = [];
  return {
    req: { method: overrides.method ?? "GET", headers: {}, on: vi.fn() },
    res: { writeHead: vi.fn(), setHeader: vi.fn(), end: vi.fn() },
    url: new URL(String(overrides.pathname ?? "/"), "http://localhost"),
    options: {
      auth_svc: overrides.auth_svc ?? {},
      agent: overrides.agent ?? {},
      cron: overrides.cron ?? null,
      process_tracker: overrides.process_tracker ?? null,
      task_ops: overrides.task_ops ?? null,
      events: overrides.events ?? {},
      channels: overrides.channels ?? null,
    },
    auth_user: overrides.auth_user ?? null,
    team_context: overrides.team_context ?? null,
    workspace_runtime: null,
    workspace_layers: [],
    personal_dir: "",
    json: vi.fn((_res: unknown, status: number, body: unknown) => { responses.push({ status, body }); }),
    read_body: vi.fn(async () => overrides.body ?? null),
    add_sse_client: vi.fn(),
    build_state: vi.fn(),
    build_merged_tasks: vi.fn(),
    recent_messages: [],
    metrics: {} as never,
    chat_sessions: new Map(),
    session_store: null,
    session_store_key: () => "",
    register_media_token: () => null,
    oauth_callback_html: () => "",
    resolve_request_origin: () => "http://localhost",
    bus: null,
    add_rich_stream_listener: () => () => {},
    _responses: responses,
  } as unknown as RouteContext & { _responses: Array<{ status: number; body: unknown }> };
}

function last(ctx: { _responses: Array<{ status: number; body: unknown }> }) {
  return ctx._responses[ctx._responses.length - 1];
}

const TEAM_A_USER = {
  auth_svc: {},
  auth_user: { role: "user", sub: "u1", tid: "team-alpha" },
  team_context: { team_id: "team-alpha", team_role: "member" },
};

const SUPERADMIN = {
  auth_svc: {},
  auth_user: { role: "superadmin", sub: "admin" },
};

// ══════════════════════════════════════════
// agent.ts — cancel / input
// ══════════════════════════════════════════

describe("agent.ts — IDOR ownership check", () => {
  it("DELETE /api/agents/:id → 타팀 서브에이전트 404", async () => {
    const cancel_spy = vi.fn(() => false);
    const ctx = make_ctx({
      ...TEAM_A_USER,
      method: "DELETE",
      pathname: "/api/agents/sub-1",
      agent: { cancel_subagent: cancel_spy },
    });
    await handle_agent(ctx);
    expect(last(ctx).status).toBe(404);
    expect(cancel_spy).toHaveBeenCalledWith("sub-1", { team_id: "team-alpha" });
  });

  it("DELETE /api/agents/:id → 자기 팀 서브에이전트 성공", async () => {
    const cancel_spy = vi.fn(() => true);
    const ctx = make_ctx({
      ...TEAM_A_USER,
      method: "DELETE",
      pathname: "/api/agents/sub-1",
      agent: { cancel_subagent: cancel_spy },
    });
    await handle_agent(ctx);
    expect(last(ctx).status).toBe(200);
    expect(cancel_spy).toHaveBeenCalledWith("sub-1", { team_id: "team-alpha" });
  });

  it("POST /api/agents/:id/input → 타팀 서브에이전트 404", async () => {
    const input_spy = vi.fn(() => false);
    const ctx = make_ctx({
      ...TEAM_A_USER,
      method: "POST",
      pathname: "/api/agents/sub-1/input",
      body: { text: "hello" },
      agent: { send_input_to_subagent: input_spy },
    });
    await handle_agent(ctx);
    expect(last(ctx).status).toBe(404);
    expect(input_spy).toHaveBeenCalledWith("sub-1", "hello", { team_id: "team-alpha" });
  });

  it("DELETE /api/agents/:id → superadmin은 모든 팀 허용", async () => {
    const cancel_spy = vi.fn(() => true);
    const ctx = make_ctx({
      ...SUPERADMIN,
      method: "DELETE",
      pathname: "/api/agents/sub-1",
      agent: { cancel_subagent: cancel_spy },
    });
    await handle_agent(ctx);
    expect(last(ctx).status).toBe(200);
    expect(cancel_spy).toHaveBeenCalledWith("sub-1", { team_id: undefined });
  });

  it("DELETE /api/agents/:id → 존재하지 않는 리소스도 404", async () => {
    const cancel_spy = vi.fn(() => false);
    const ctx = make_ctx({
      ...TEAM_A_USER,
      method: "DELETE",
      pathname: "/api/agents/nonexistent",
      agent: { cancel_subagent: cancel_spy },
    });
    await handle_agent(ctx);
    expect(last(ctx).status).toBe(404);
  });
});

// ══════════════════════════════════════════
// loop.ts — stop
// ══════════════════════════════════════════

describe("loop.ts — IDOR ownership check", () => {
  it("DELETE /api/loops/:id → 타팀 루프 404", async () => {
    const stop_spy = vi.fn(() => null);
    const ctx = make_ctx({
      ...TEAM_A_USER,
      method: "DELETE",
      pathname: "/api/loops/loop-1",
      body: { reason: "test" },
      agent: { stop_loop: stop_spy },
    });
    await handle_loop(ctx);
    expect(last(ctx).status).toBe(404);
    expect(stop_spy).toHaveBeenCalledWith("loop-1", "test", { team_id: "team-alpha" });
  });

  it("DELETE /api/loops/:id → 자기 팀 루프 성공", async () => {
    const stop_spy = vi.fn(() => ({ loopId: "loop-1", status: "stopped" }));
    const ctx = make_ctx({
      ...TEAM_A_USER,
      method: "DELETE",
      pathname: "/api/loops/loop-1",
      body: { reason: "test" },
      agent: { stop_loop: stop_spy },
    });
    await handle_loop(ctx);
    expect(last(ctx).status).toBe(200);
    expect(stop_spy).toHaveBeenCalledWith("loop-1", "test", { team_id: "team-alpha" });
  });
});

// ══════════════════════════════════════════
// approval.ts — resolve
// ══════════════════════════════════════════

describe("approval.ts — IDOR ownership check", () => {
  it("POST /api/approvals/:id/resolve → 타팀 승인 요청 404", async () => {
    const resolve_spy = vi.fn(() => ({ ok: false, decision: "deny", status: "cancelled", confidence: 0 }));
    const ctx = make_ctx({
      ...TEAM_A_USER,
      method: "POST",
      pathname: "/api/approvals/req-1/resolve",
      body: { text: "approve" },
      agent: { resolve_approval_request: resolve_spy },
    });
    await handle_approval(ctx);
    expect(last(ctx).status).toBe(404);
    expect(resolve_spy).toHaveBeenCalledWith("req-1", "approve", { team_id: "team-alpha" });
  });

  it("POST /api/approvals/:id/resolve → 자기 팀 승인 요청 처리", async () => {
    const ctx = make_ctx({
      ...TEAM_A_USER,
      method: "POST",
      pathname: "/api/approvals/req-1/resolve",
      body: { text: "approve" },
      agent: {
        resolve_approval_request: vi.fn(() => ({ ok: true, decision: "approve", status: "approved", confidence: 1 })),
        execute_approved_request: vi.fn(async () => ({ ok: true, result: "done" })),
        get_approval_request: vi.fn(() => ({ context: { team_id: "team-alpha", task_id: "t1" } })),
      },
      channels: { resume_after_dashboard_approval: vi.fn(async () => {}) },
    });
    await handle_approval(ctx);
    expect(last(ctx).status).toBe(200);
  });
});

// ══════════════════════════════════════════
// cron.ts — enable/delete/run
// ══════════════════════════════════════════

describe("cron.ts — IDOR ownership check", () => {
  it("PUT /api/cron/jobs/:id → 타팀 크론잡 404", async () => {
    const enable_spy = vi.fn(async () => null);
    const cron = { enable_job: enable_spy };
    const ctx = make_ctx({ ...TEAM_A_USER, method: "PUT", pathname: "/api/cron/jobs/job-1", body: { enabled: true }, cron });
    await handle_cron(ctx);
    expect(last(ctx).status).toBe(404);
    expect(enable_spy).toHaveBeenCalledWith("job-1", true, { team_id: "team-alpha" });
  });

  it("DELETE /api/cron/jobs/:id → 타팀 크론잡 404", async () => {
    const remove_spy = vi.fn(async () => false);
    const cron = { remove_job: remove_spy };
    const ctx = make_ctx({ ...TEAM_A_USER, method: "DELETE", pathname: "/api/cron/jobs/job-1", cron });
    await handle_cron(ctx);
    expect(last(ctx).status).toBe(404);
    expect(remove_spy).toHaveBeenCalledWith("job-1", { team_id: "team-alpha" });
  });

  it("POST /api/cron/jobs/:id/runs → 타팀 크론잡 404", async () => {
    const run_spy = vi.fn(async () => false);
    const cron = { run_job: run_spy };
    const ctx = make_ctx({ ...TEAM_A_USER, method: "POST", pathname: "/api/cron/jobs/job-1/runs", body: { force: false }, cron });
    await handle_cron(ctx);
    expect(last(ctx).status).toBe(404);
    expect(run_spy).toHaveBeenCalledWith("job-1", false, { team_id: "team-alpha" });
  });

  it("PUT /api/cron/jobs/:id → 자기 팀 크론잡 성공", async () => {
    const enable_spy = vi.fn(async () => ({ id: "job-1", enabled: true }));
    const cron = { enable_job: enable_spy };
    const ctx = make_ctx({ ...TEAM_A_USER, method: "PUT", pathname: "/api/cron/jobs/job-1", body: { enabled: true }, cron });
    await handle_cron(ctx);
    expect(last(ctx).status).toBe(200);
    expect(enable_spy).toHaveBeenCalledWith("job-1", true, { team_id: "team-alpha" });
  });
});

// ══════════════════════════════════════════
// process.ts — cancel
// ══════════════════════════════════════════

describe("process.ts — IDOR ownership check", () => {
  it("DELETE /api/processes/:id → 타팀 프로세스 404", async () => {
    const cancel_spy = vi.fn(async () => ({ cancelled: false, details: "프로세스를 찾을 수 없습니다" }));
    const ctx = make_ctx({
      ...TEAM_A_USER,
      method: "DELETE",
      pathname: "/api/processes/run-1",
      process_tracker: { cancel: cancel_spy },
    });
    await handle_process(ctx);
    expect(last(ctx).status).toBe(404);
    expect(cancel_spy).toHaveBeenCalledWith("run-1", { team_id: "team-alpha" });
  });

  it("DELETE /api/processes/:id → 자기 팀 프로세스 성공", async () => {
    const cancel_spy = vi.fn(async () => ({ cancelled: true, details: "abort_signal" }));
    const ctx = make_ctx({
      ...TEAM_A_USER,
      method: "DELETE",
      pathname: "/api/processes/run-1",
      process_tracker: { cancel: cancel_spy },
    });
    await handle_process(ctx);
    expect(last(ctx).status).toBe(200);
    expect(cancel_spy).toHaveBeenCalledWith("run-1", { team_id: "team-alpha" });
  });
});

// ══════════════════════════════════════════
// task.ts — cancel / resume
// ══════════════════════════════════════════

describe("task.ts — IDOR ownership check", () => {
  it("DELETE /api/tasks/:id → 타팀 태스크 404", async () => {
    const cancel_spy = vi.fn(async () => null);
    const ctx = make_ctx({
      ...TEAM_A_USER,
      method: "DELETE",
      pathname: "/api/tasks/t1",
      task_ops: { cancel_task: cancel_spy, get_task: vi.fn(), resume_task: vi.fn() },
    });
    await handle_task(ctx);
    expect(last(ctx).status).toBe(404);
    expect(cancel_spy).toHaveBeenCalledWith("t1", "cancelled_from_dashboard", { team_id: "team-alpha" });
  });

  it("PUT /api/tasks/:id → 타팀 태스크 resume 404", async () => {
    const resume_spy = vi.fn(async () => null);
    const ctx = make_ctx({
      ...TEAM_A_USER,
      method: "PUT",
      pathname: "/api/tasks/t1",
      body: { text: "continue" },
      task_ops: { cancel_task: vi.fn(), get_task: vi.fn(), resume_task: resume_spy },
    });
    await handle_task(ctx);
    expect(last(ctx).status).toBe(404);
    expect(resume_spy).toHaveBeenCalledWith("t1", "continue", { team_id: "team-alpha" });
  });

  it("DELETE /api/tasks/:id → 자기 팀 태스크 성공", async () => {
    const cancel_spy = vi.fn(async () => ({ taskId: "t1", status: "cancelled" }));
    const ctx = make_ctx({
      ...TEAM_A_USER,
      method: "DELETE",
      pathname: "/api/tasks/t1",
      task_ops: { cancel_task: cancel_spy, get_task: vi.fn(), resume_task: vi.fn() },
    });
    await handle_task(ctx);
    expect(last(ctx).status).toBe(200);
  });

  it("DELETE /api/tasks/:id → superadmin은 모든 팀 허용", async () => {
    const cancel_spy = vi.fn(async () => ({ taskId: "t1", status: "cancelled" }));
    const ctx = make_ctx({
      ...SUPERADMIN,
      method: "DELETE",
      pathname: "/api/tasks/t1",
      task_ops: { cancel_task: cancel_spy, get_task: vi.fn(), resume_task: vi.fn() },
    });
    await handle_task(ctx);
    expect(last(ctx).status).toBe(200);
    expect(cancel_spy).toHaveBeenCalledWith("t1", "cancelled_from_dashboard", { team_id: undefined });
  });
});
