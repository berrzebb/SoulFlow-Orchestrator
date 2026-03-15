/**
 * FE-6a: Backend Scoping Closure — CRITICAL 4 + HIGH 4 직접 호출 테스트.
 *
 * 각 수정 라우트를 직접 호출하여 team_id/scope/role 분기를 검증.
 */
import { describe, it, expect, vi } from "vitest";
import type { RouteContext } from "@src/dashboard/route-context.ts";

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
      events: overrides.events ?? { list: vi.fn(async () => []) },
      channels: overrides.channels ?? null,
      dlq: overrides.dlq ?? null,
      dispatch: overrides.dispatch ?? null,
      workflow_ops: overrides.workflow_ops ?? null,
      agent_provider_ops: overrides.agent_provider_ops ?? null,
      agent_definition_ops: overrides.agent_definition_ops ?? null,
      kanban_store: overrides.kanban_store ?? null,
      usage_ops: overrides.usage_ops ?? null,
      stats_ops: overrides.stats_ops ?? null,
      tool_ops: overrides.tool_ops ?? null,
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
    add_rich_stream_listener: vi.fn(),
    get_scoped_memory_ops: vi.fn(),
    correlation: {} as never,
    _responses: responses,
  } as unknown as RouteContext & { _responses: Array<{ status: number; body: unknown }> };
}

function last(ctx: { _responses: Array<{ status: number; body: unknown }> }) {
  return ctx._responses[ctx._responses.length - 1];
}

const USER_ALPHA = {
  auth_svc: {},
  auth_user: { role: "user", sub: "u1", tid: "alpha" },
  team_context: { team_id: "alpha", team_role: "member" },
};

const MANAGER_ALPHA = {
  auth_svc: {},
  auth_user: { role: "user", sub: "u1", tid: "alpha" },
  team_context: { team_id: "alpha", team_role: "manager" },
};

const SUPERADMIN = {
  auth_svc: {},
  auth_user: { role: "superadmin", sub: "admin" },
};

// ══════════════════════════════════════════
// CRITICAL 1: /api/workflow/runs — team_id 스코핑
// ══════════════════════════════════════════

import { handle_workflow } from "@src/dashboard/routes/workflows.ts";

describe("workflow/runs — team_id 스코핑 (FE-6a)", () => {
  const make_ops = () => ({
    list: vi.fn(async () => [
      { workflow_id: "wf1", team_id: "alpha", status: "completed" },
      { workflow_id: "wf2", team_id: "beta", status: "running" },
    ]),
    get: vi.fn(async (id: string) => {
      if (id === "wf1") return { workflow_id: "wf1", team_id: "alpha" };
      if (id === "wf2") return { workflow_id: "wf2", team_id: "beta" };
      return null;
    }),
    cancel: vi.fn(async () => true),
    get_messages: vi.fn(async () => []),
    send_message: vi.fn(async () => ({ ok: true })),
    resume: vi.fn(async () => ({ ok: true })),
    update_settings: vi.fn(async () => ({ ok: true })),
    list_templates: vi.fn(() => []),
    get_template: vi.fn(() => null),
    save_template: vi.fn(() => ""),
    delete_template: vi.fn(() => false),
    import_template: vi.fn(() => ({ ok: false })),
    export_template: vi.fn(() => null),
    list_roles: vi.fn(() => []),
  });

  it("목록: 일반 유저 → 자기 팀 run만 반환", async () => {
    const ctx = make_ctx({ ...USER_ALPHA, pathname: "/api/workflow/runs", workflow_ops: make_ops() });
    await handle_workflow(ctx);
    const list = last(ctx).body as Array<{ workflow_id: string }>;
    expect(list).toHaveLength(1);
    expect(list[0].workflow_id).toBe("wf1");
  });

  it("목록: superadmin → 전체 반환", async () => {
    const ctx = make_ctx({ ...SUPERADMIN, pathname: "/api/workflow/runs", workflow_ops: make_ops() });
    await handle_workflow(ctx);
    const list = last(ctx).body as Array<{ workflow_id: string }>;
    expect(list).toHaveLength(2);
  });

  it("상세: 타팀 run → 404", async () => {
    const ctx = make_ctx({ ...USER_ALPHA, pathname: "/api/workflow/runs/wf2", workflow_ops: make_ops() });
    await handle_workflow(ctx);
    expect(last(ctx).status).toBe(404);
  });

  it("상세: 자기 팀 run → 200", async () => {
    const ctx = make_ctx({ ...USER_ALPHA, pathname: "/api/workflow/runs/wf1", workflow_ops: make_ops() });
    await handle_workflow(ctx);
    expect(last(ctx).status).toBe(200);
  });

  it("DELETE: 타팀 run → 404", async () => {
    const ctx = make_ctx({ ...USER_ALPHA, method: "DELETE", pathname: "/api/workflow/runs/wf2", workflow_ops: make_ops() });
    await handle_workflow(ctx);
    expect(last(ctx).status).toBe(404);
  });
});

// ══════════════════════════════════════════
// CRITICAL 2: /api/workflow/events — team_id 필터
// ══════════════════════════════════════════

import { handle_health } from "@src/dashboard/routes/health.ts";

describe("workflow/events — team_id 필터 (FE-6a)", () => {
  it("일반 유저 → events.list에 team_id 전달", async () => {
    const list_spy = vi.fn(async () => []);
    const ctx = make_ctx({
      ...USER_ALPHA,
      pathname: "/api/workflow/events",
      events: { list: list_spy },
    });
    await handle_health(ctx);
    expect(list_spy).toHaveBeenCalledWith(expect.objectContaining({ team_id: "alpha" }));
  });

  it("superadmin → events.list에 team_id 미전달", async () => {
    const list_spy = vi.fn(async () => []);
    const ctx = make_ctx({
      ...SUPERADMIN,
      pathname: "/api/workflow/events",
      events: { list: list_spy },
    });
    await handle_health(ctx);
    const filter = list_spy.mock.calls[0][0];
    expect(filter.team_id).toBeUndefined();
  });
});

// ══════════════════════════════════════════
// CRITICAL 3: /api/usage — require_team_manager
// ══════════════════════════════════════════

import { handle_usage } from "@src/dashboard/routes/usage.ts";

describe("usage/* — require_team_manager (FE-6a)", () => {
  it("일반 member → 403", async () => {
    const ctx = make_ctx({ ...USER_ALPHA, pathname: "/api/usage/spans", usage_ops: { list_spans: vi.fn() } });
    await handle_usage(ctx);
    expect(last(ctx).status).toBe(403);
  });

  it("team manager → 통과", async () => {
    const ctx = make_ctx({
      ...MANAGER_ALPHA,
      pathname: "/api/usage/spans",
      usage_ops: { list_spans: vi.fn(async () => []) },
    });
    await handle_usage(ctx);
    expect(last(ctx).status).toBe(200);
  });

  it("superadmin → 통과", async () => {
    const ctx = make_ctx({
      ...SUPERADMIN,
      pathname: "/api/usage/spans",
      usage_ops: { list_spans: vi.fn(async () => []) },
    });
    await handle_usage(ctx);
    expect(last(ctx).status).toBe(200);
  });
});

// ══════════════════════════════════════════
// CRITICAL 4: /api/dlq — require_team_manager
// ══════════════════════════════════════════

describe("dlq/* — require_team_manager (FE-6a)", () => {
  it("일반 member → 403", async () => {
    const ctx = make_ctx({ ...USER_ALPHA, pathname: "/api/dlq", dlq: { list: vi.fn() } });
    await handle_health(ctx);
    expect(last(ctx).status).toBe(403);
  });

  it("team manager → 통과", async () => {
    const ctx = make_ctx({
      ...MANAGER_ALPHA,
      pathname: "/api/dlq",
      dlq: { list: vi.fn(async () => []) },
    });
    await handle_health(ctx);
    expect(last(ctx).status).toBe(200);
  });
});

// ══════════════════════════════════════════
// HIGH 5: /api/agents/providers/:id — scope 검사
// ══════════════════════════════════════════

import { handle_agent_provider } from "@src/dashboard/routes/agent-provider.ts";

describe("agents/providers/:id — scope 검사 (FE-6a)", () => {
  const make_ops = (info: Record<string, unknown> | null = null) => ({
    list: vi.fn(async () => []),
    get: vi.fn(async () => info),
    create: vi.fn(async () => ({ ok: true })),
    update: vi.fn(async () => ({ ok: true })),
    remove: vi.fn(async () => ({ ok: true })),
    test_connection: vi.fn(async () => ({ ok: true })),
    list_models: vi.fn(async () => []),
    list_connections: vi.fn(async () => []),
  });

  it("자기 팀 scope provider → 200", async () => {
    const ops = make_ops({ instance_id: "p1", scope_type: "team", scope_id: "alpha" });
    const ctx = make_ctx({ ...USER_ALPHA, pathname: "/api/agents/providers/p1", agent_provider_ops: ops });
    await handle_agent_provider(ctx);
    expect(last(ctx).status).toBe(200);
  });

  it("타팀 scope provider → 404", async () => {
    const ops = make_ops({ instance_id: "p1", scope_type: "team", scope_id: "beta" });
    const ctx = make_ctx({ ...USER_ALPHA, pathname: "/api/agents/providers/p1", agent_provider_ops: ops });
    await handle_agent_provider(ctx);
    expect(last(ctx).status).toBe(404);
  });

  it("global scope provider → 200 (모든 유저 가시)", async () => {
    const ops = make_ops({ instance_id: "p1", scope_type: "global", scope_id: "" });
    const ctx = make_ctx({ ...USER_ALPHA, pathname: "/api/agents/providers/p1", agent_provider_ops: ops });
    await handle_agent_provider(ctx);
    expect(last(ctx).status).toBe(200);
  });
});

// ══════════════════════════════════════════
// HIGH 6: /api/agent-definitions/:id — scope 검사
// ══════════════════════════════════════════

import { handle_agent_definition } from "@src/dashboard/routes/agent-definition.ts";

describe("agent-definitions/:id — scope 검사 (FE-6a)", () => {
  const make_ops = (data: Record<string, unknown> | null = null) => ({
    list: vi.fn(() => []),
    get: vi.fn(() => data),
    save: vi.fn(() => ({ ok: true })),
    remove: vi.fn(() => ({ ok: true })),
  });

  it("자기 팀 scope definition → 200", async () => {
    const ops = make_ops({ id: "d1", scope_type: "team", scope_id: "alpha" });
    const ctx = make_ctx({ ...USER_ALPHA, pathname: "/api/agent-definitions/d1", agent_definition_ops: ops });
    await handle_agent_definition(ctx);
    expect(last(ctx).status).toBe(200);
  });

  it("타팀 scope definition → 404", async () => {
    const ops = make_ops({ id: "d1", scope_type: "team", scope_id: "beta" });
    const ctx = make_ctx({ ...USER_ALPHA, pathname: "/api/agent-definitions/d1", agent_definition_ops: ops });
    await handle_agent_definition(ctx);
    expect(last(ctx).status).toBe(404);
  });
});

// ══════════════════════════════════════════
// HIGH 7: /api/agents/connections — require_team_manager
// ══════════════════════════════════════════

describe("agents/connections — require_team_manager (FE-6a)", () => {
  it("일반 member → 403", async () => {
    const ops = { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), test_connection: vi.fn(), list_models: vi.fn(), list_connections: vi.fn(async () => []) };
    const ctx = make_ctx({ ...USER_ALPHA, pathname: "/api/agents/connections", agent_provider_ops: ops });
    await handle_agent_provider(ctx);
    expect(last(ctx).status).toBe(403);
  });

  it("team manager → 200", async () => {
    const ops = { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), test_connection: vi.fn(), list_models: vi.fn(), list_connections: vi.fn(async () => []) };
    const ctx = make_ctx({ ...MANAGER_ALPHA, pathname: "/api/agents/connections", agent_provider_ops: ops });
    await handle_agent_provider(ctx);
    expect(last(ctx).status).toBe(200);
  });
});

// ══════════════════════════════════════════
// 보강: workflow resume/settings/messages — team ownership
// ══════════════════════════════════════════

describe("workflow resume/settings/messages — team ownership (FE-6a)", () => {
  const make_ops = () => ({
    list: vi.fn(async () => []),
    get: vi.fn(async (id: string) => {
      if (id === "wf1") return { workflow_id: "wf1", team_id: "alpha" };
      if (id === "wf2") return { workflow_id: "wf2", team_id: "beta" };
      return null;
    }),
    cancel: vi.fn(async () => true),
    get_messages: vi.fn(async () => []),
    send_message: vi.fn(async () => ({ ok: true })),
    resume: vi.fn(async () => ({ ok: true })),
    update_settings: vi.fn(async () => ({ ok: true })),
    list_templates: vi.fn(() => []),
    get_template: vi.fn(() => null),
    save_template: vi.fn(() => ""),
    delete_template: vi.fn(() => false),
    import_template: vi.fn(() => ({ ok: false })),
    export_template: vi.fn(() => null),
    list_roles: vi.fn(() => []),
  });

  it("POST resume: 타팀 → 404", async () => {
    const ctx = make_ctx({ ...USER_ALPHA, method: "POST", pathname: "/api/workflow/runs/wf2/resume", workflow_ops: make_ops() });
    await handle_workflow(ctx);
    expect(last(ctx).status).toBe(404);
  });

  it("POST resume: 자기 팀 → 200", async () => {
    const ctx = make_ctx({ ...USER_ALPHA, method: "POST", pathname: "/api/workflow/runs/wf1/resume", workflow_ops: make_ops() });
    await handle_workflow(ctx);
    expect(last(ctx).status).toBe(200);
  });

  it("PATCH settings: 타팀 → 404", async () => {
    const ctx = make_ctx({ ...USER_ALPHA, method: "PATCH", pathname: "/api/workflow/runs/wf2/settings", body: { auto_approve: true }, workflow_ops: make_ops() });
    await handle_workflow(ctx);
    expect(last(ctx).status).toBe(404);
  });

  it("PATCH settings: 자기 팀 → 200", async () => {
    const ctx = make_ctx({ ...USER_ALPHA, method: "PATCH", pathname: "/api/workflow/runs/wf1/settings", body: { auto_approve: true }, workflow_ops: make_ops() });
    await handle_workflow(ctx);
    expect(last(ctx).status).toBe(200);
  });

  it("POST messages: 타팀 → 404", async () => {
    const ctx = make_ctx({ ...USER_ALPHA, method: "POST", pathname: "/api/workflow/runs/wf2/messages", body: { phase_id: "p", agent_id: "a", content: "hi" }, workflow_ops: make_ops() });
    await handle_workflow(ctx);
    expect(last(ctx).status).toBe(404);
  });

  it("POST messages: 자기 팀 → 200", async () => {
    const ctx = make_ctx({ ...USER_ALPHA, method: "POST", pathname: "/api/workflow/runs/wf1/messages", body: { phase_id: "p", agent_id: "a", content: "hi" }, workflow_ops: make_ops() });
    await handle_workflow(ctx);
    expect(last(ctx).status).toBe(200);
  });
});

// ══════════════════════════════════════════
// 보강: DLQ replay — require_team_manager
// ══════════════════════════════════════════

describe("dlq replay — require_team_manager (FE-6a)", () => {
  it("POST replay: 일반 member → 403", async () => {
    const ctx = make_ctx({ ...USER_ALPHA, method: "POST", pathname: "/api/dlq/replay", dlq: { list: vi.fn() }, dispatch: {} });
    await handle_health(ctx);
    expect(last(ctx).status).toBe(403);
  });

  it("POST replay: team manager → 통과 (dlq 사용)", async () => {
    const ctx = make_ctx({
      ...MANAGER_ALPHA, method: "POST", pathname: "/api/dlq/replay",
      body: { ids: [] },
      dlq: { list: vi.fn(async () => []), delete_by_ids: vi.fn(async () => 0) },
      dispatch: { send: vi.fn(async () => ({ ok: true })) },
    });
    await handle_health(ctx);
    expect(last(ctx).status).toBe(200);
  });
});

// ══════════════════════════════════════════
// 보강: kanban card PUT/DELETE — board ownership
// ══════════════════════════════════════════

import { handle_kanban } from "@src/dashboard/routes/kanban.ts";

describe("kanban card PUT/DELETE — board ownership (FE-6a)", () => {
  function make_kanban_store(opts: { card_board_id?: string; board_scope?: { scope_type: string; scope_id: string } } = {}) {
    const board_id = opts.card_board_id ?? "b1";
    const scope = opts.board_scope ?? { scope_type: "team", scope_id: "alpha" };
    return {
      get_card: vi.fn(async () => ({ card_id: "c1", board_id })),
      get_board: vi.fn(async () => ({ board_id, ...scope })),
      update_card: vi.fn(async () => ({ card_id: "c1" })),
      delete_card: vi.fn(async () => true),
      move_card: vi.fn(async () => ({ card_id: "c1" })),
      list_boards: vi.fn(async () => []),
    };
  }

  it("PUT card: 자기 팀 board → 200", async () => {
    const store = make_kanban_store();
    const ctx = make_ctx({ ...USER_ALPHA, method: "PUT", pathname: "/api/kanban/cards/c1", body: { title: "new" }, kanban_store: store });
    await handle_kanban(ctx);
    expect(last(ctx).status).toBe(200);
  });

  it("PUT card: 타팀 board → 403", async () => {
    const store = make_kanban_store({ board_scope: { scope_type: "team", scope_id: "beta" } });
    const ctx = make_ctx({ ...USER_ALPHA, method: "PUT", pathname: "/api/kanban/cards/c1", body: { title: "new" }, kanban_store: store });
    await handle_kanban(ctx);
    expect(last(ctx).status).toBe(403);
  });

  it("DELETE card: 자기 팀 board → 200", async () => {
    const store = make_kanban_store();
    const ctx = make_ctx({ ...USER_ALPHA, method: "DELETE", pathname: "/api/kanban/cards/c1", kanban_store: store });
    await handle_kanban(ctx);
    expect(last(ctx).status).toBe(200);
  });

  it("DELETE card: 타팀 board → 403", async () => {
    const store = make_kanban_store({ board_scope: { scope_type: "team", scope_id: "beta" } });
    const ctx = make_ctx({ ...USER_ALPHA, method: "DELETE", pathname: "/api/kanban/cards/c1", kanban_store: store });
    await handle_kanban(ctx);
    expect(last(ctx).status).toBe(403);
  });

  it("GET card: 타팀 board → 403", async () => {
    const store = make_kanban_store({ board_scope: { scope_type: "team", scope_id: "beta" } });
    const ctx = make_ctx({ ...USER_ALPHA, method: "GET", pathname: "/api/kanban/cards/c1", kanban_store: store });
    await handle_kanban(ctx);
    expect(last(ctx).status).toBe(403);
  });
});

// ══════════════════════════════════════════
// 보강: /api/system/metrics — require_team_manager
// ══════════════════════════════════════════

import { handle_state } from "@src/dashboard/routes/state.ts";

describe("system/metrics — require_team_manager (FE-6a)", () => {
  it("일반 member → 403", async () => {
    const ctx = make_ctx({ ...USER_ALPHA, pathname: "/api/system/metrics" });
    await handle_state(ctx);
    expect(last(ctx).status).toBe(403);
  });

  it("team manager → 200", async () => {
    const ctx = make_ctx({ ...MANAGER_ALPHA, pathname: "/api/system/metrics" });
    (ctx as any).metrics = { get_latest: vi.fn(() => ({ cpu_percent: 50 })) };
    await handle_state(ctx);
    expect(last(ctx).status).toBe(200);
  });

  it("superadmin → 200", async () => {
    const ctx = make_ctx({ ...SUPERADMIN, pathname: "/api/system/metrics" });
    (ctx as any).metrics = { get_latest: vi.fn(() => ({ cpu_percent: 50 })) };
    await handle_state(ctx);
    expect(last(ctx).status).toBe(200);
  });
});

// ══════════════════════════════════════════
// 보강: /api/config/provider-instances — scope 필터
// ══════════════════════════════════════════

import { handle_config } from "@src/dashboard/routes/config.ts";

describe("config/provider-instances — scope 필터 (FE-6a)", () => {
  it("일반 유저 → provider_ops.list에 scope 전달", async () => {
    const list_spy = vi.fn(async () => []);
    const ctx = make_ctx({
      ...USER_ALPHA,
      pathname: "/api/config/provider-instances",
      agent_provider_ops: { list: list_spy },
    });
    // config 핸들러에 필요한 추가 옵션 설정
    (ctx.options as any).config_ops = null;
    await handle_config(ctx);
    expect(list_spy).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ scope_type: "global" }),
        expect.objectContaining({ scope_type: "team", scope_id: "alpha" }),
      ]),
    );
  });

  it("superadmin → provider_ops.list에 undefined 전달 (전체 조회)", async () => {
    const list_spy = vi.fn(async () => []);
    const ctx = make_ctx({
      ...SUPERADMIN,
      pathname: "/api/config/provider-instances",
      agent_provider_ops: { list: list_spy },
    });
    (ctx.options as any).config_ops = null;
    await handle_config(ctx);
    expect(list_spy).toHaveBeenCalledWith(undefined);
  });
});
