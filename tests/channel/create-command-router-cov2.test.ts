/**
 * create_command_router — CommandRouter 팩토리 커버리지.
 * 의존성 전체를 mock하여 CommandRouter 인스턴스 생성 + 핵심 로직 검증.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── 모든 커맨드 핸들러 클래스 mock ──────────────────────────────────────────
// vi.mock은 hoisted되어 const보다 먼저 실행됨 → make_handler_class도 hoisted 필요

const make_handler_class = vi.hoisted(() => (name: string) =>
  vi.fn().mockImplementation(function (this: any) {
    this.name = name;
    this.can_handle = vi.fn().mockReturnValue(false);
    this.handle = vi.fn().mockResolvedValue(true);
  })
);

vi.mock("@src/channels/commands/index.js", () => ({
  CommandRouter: vi.fn().mockImplementation(function (this: any, handlers: unknown[]) {
    this._handlers = handlers;
    this.try_handle = vi.fn().mockResolvedValue(false);
    this.add_handler = vi.fn();
  }),
  HelpHandler: make_handler_class("help"),
  StopHandler: make_handler_class("stop"),
  RenderHandler: make_handler_class("render"),
  SecretHandler: make_handler_class("secret"),
  MemoryHandler: make_handler_class("memory"),
  DecisionHandler: make_handler_class("decision"),
  PromiseHandler: make_handler_class("promise"),
  CronHandler: make_handler_class("cron"),
  ReloadHandler: make_handler_class("reload"),
  TaskHandler: make_handler_class("task"),
  StatusHandler: make_handler_class("status"),
  SkillHandler: make_handler_class("skill"),
  DoctorHandler: make_handler_class("doctor"),
  AgentHandler: make_handler_class("agent"),
  StatsHandler: make_handler_class("stats"),
  VerifyHandler: make_handler_class("verify"),
  GuardHandler: make_handler_class("guard"),
  McpHandler: make_handler_class("mcp"),
}));

vi.mock("@src/channels/commands/tone.handler.js", () => ({
  ToneHandler: make_handler_class("tone"),
}));

import { create_command_router } from "@src/channels/create-command-router.js";
import {
  CommandRouter, GuardHandler, McpHandler, AgentHandler,
  ReloadHandler, StatsHandler,
} from "@src/channels/commands/index.js";
import { ToneHandler } from "@src/channels/commands/tone.handler.js";

// ─── mock deps 헬퍼 ──────────────────────────────────────────────────────────

function make_skills_loader() {
  return {
    list_skills: vi.fn().mockReturnValue([]),
    get_skill_metadata: vi.fn().mockReturnValue(null),
    refresh: vi.fn(),
    suggest_skills_for_text: vi.fn().mockReturnValue([]),
    list_role_skills: vi.fn().mockReturnValue([]),
  };
}

function make_agent_ctx() {
  return {
    tools: { tool_names: vi.fn().mockReturnValue([]), get_definitions: vi.fn().mockReturnValue([]) },
    context: { memory_store: {}, promise_service: {}, skills_loader: make_skills_loader() },
    tool_reloader: { reload_now: vi.fn() },
    subagents: {
      list: vi.fn().mockReturnValue([]),
      list_running: vi.fn().mockReturnValue([]),
      get: vi.fn().mockReturnValue(null),
      cancel: vi.fn().mockReturnValue(false),
      send_input: vi.fn().mockReturnValue(false),
      get_running_count: vi.fn().mockReturnValue(0),
    },
  };
}

function make_deps(overrides: Record<string, unknown> = {}): Parameters<typeof create_command_router>[0] {
  const health_scorer = {
    rank: vi.fn().mockReturnValue([]),
    get_metrics: vi.fn().mockReturnValue({ success_count: 0, failure_count: 0, total_latency_ms: 0 }),
  };
  return {
    cancel_active_runs: vi.fn().mockReturnValue(0),
    render_profile: { get: vi.fn(), set: vi.fn(), reset: vi.fn() },
    agent: make_agent_ctx() as any,
    agent_runtime: {
      find_waiting_task: vi.fn().mockResolvedValue(null),
      get_task: vi.fn().mockResolvedValue(null),
      cancel_task: vi.fn().mockResolvedValue(false),
      list_active_tasks: vi.fn().mockReturnValue([]),
      list_active_loops: vi.fn().mockReturnValue([]),
      stop_loop: vi.fn().mockResolvedValue(false),
      spawn_and_wait: vi.fn().mockResolvedValue({ reply: "ok" }),
    } as any,
    process_tracker: {
      list_active: vi.fn().mockReturnValue([]),
      list_recent: vi.fn().mockReturnValue([]),
      get: vi.fn().mockReturnValue(null),
      cancel: vi.fn().mockReturnValue(false),
    } as any,
    orchestration: { get_cd_score: vi.fn().mockReturnValue(0), reset_cd_score: vi.fn() } as any,
    providers: {
      get_secret_vault: vi.fn().mockReturnValue({}),
      get_health_scorer: vi.fn().mockReturnValue(health_scorer),
    } as any,
    agent_backend_registry: { list_backends: vi.fn().mockReturnValue([]) } as any,
    mcp: {
      list_servers: vi.fn().mockReturnValue([]),
      get_server_configs: vi.fn().mockReturnValue({}),
      connect_server: vi.fn().mockResolvedValue(undefined),
    } as any,
    session_recorder: { get_last_assistant_content: vi.fn().mockReturnValue(null) },
    cron: { list_jobs: vi.fn().mockResolvedValue([]) } as any,
    decisions: {} as any,
    default_alias: "assistant",
    logger: null,
    confirmation_guard: null,
    tone_store: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ══════════════════════════════════════════════════════
// 기본 생성
// ══════════════════════════════════════════════════════

describe("create_command_router — 기본", () => {
  it("CommandRouter 인스턴스 반환", () => {
    const router = create_command_router(make_deps());
    expect(CommandRouter).toHaveBeenCalledOnce();
    expect(router).toBeDefined();
  });

  it("핸들러 배열에 기본 핸들러 포함 (16개 이상)", () => {
    create_command_router(make_deps());
    const MockRouter = vi.mocked(CommandRouter);
    const call_args = MockRouter.mock.calls[0][0];
    expect(Array.isArray(call_args)).toBe(true);
    expect((call_args as unknown[]).length).toBeGreaterThanOrEqual(16);
  });

  it("confirmation_guard 없음 → GuardHandler 미포함", () => {
    create_command_router(make_deps({ confirmation_guard: null }));
    expect(vi.mocked(GuardHandler)).not.toHaveBeenCalled();
  });

  it("confirmation_guard 있음 → GuardHandler 포함", () => {
    const guard = { check: vi.fn(), prompt: vi.fn() };
    create_command_router(make_deps({ confirmation_guard: guard as any }));
    expect(vi.mocked(GuardHandler)).toHaveBeenCalledWith(guard);
  });

  it("tone_store 없음 → ToneHandler 미포함", () => {
    create_command_router(make_deps({ tone_store: null }));
    expect(vi.mocked(ToneHandler)).not.toHaveBeenCalled();
  });

  it("tone_store 있음 → ToneHandler 포함", () => {
    const store = { get: vi.fn(), set: vi.fn() };
    create_command_router(make_deps({ tone_store: store as any }));
    expect(vi.mocked(ToneHandler)).toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════
// McpHandler reconnect 로직
// ══════════════════════════════════════════════════════

describe("create_command_router — McpHandler deps", () => {
  it("reconnect: config 없음 → false", async () => {
    create_command_router(make_deps());
    const mcp_deps = vi.mocked(McpHandler).mock.calls[0][0] as any;
    const result = await mcp_deps.reconnect("unknown-server");
    expect(result).toBe(false);
  });

  it("reconnect: config 있음 → true", async () => {
    const connect_server = vi.fn().mockResolvedValue(undefined);
    const get_server_configs = vi.fn().mockReturnValue({ "my-server": { host: "localhost" } });
    create_command_router(make_deps({
      mcp: { list_servers: vi.fn().mockReturnValue([]), get_server_configs, connect_server } as any,
    }));
    const mcp_deps = vi.mocked(McpHandler).mock.calls[0][0] as any;
    const result = await mcp_deps.reconnect("my-server");
    expect(result).toBe(true);
    expect(connect_server).toHaveBeenCalledWith("my-server", { host: "localhost" });
  });

  it("reconnect: connect_server throw → false", async () => {
    const connect_server = vi.fn().mockRejectedValue(new Error("fail"));
    const get_server_configs = vi.fn().mockReturnValue({ "bad": {} });
    create_command_router(make_deps({
      mcp: { list_servers: vi.fn().mockReturnValue([]), get_server_configs, connect_server } as any,
    }));
    const mcp_deps = vi.mocked(McpHandler).mock.calls[0][0] as any;
    const result = await mcp_deps.reconnect("bad");
    expect(result).toBe(false);
  });
});

// ══════════════════════════════════════════════════════
// AgentHandler deps (pick_subagent)
// ══════════════════════════════════════════════════════

describe("create_command_router — AgentHandler deps", () => {
  it("list() → pick_subagent 적용 (id/role/status/label 등)", () => {
    const subagents_data = [
      { id: "a1", role: "coder", status: "running", label: "bot1", model: "claude-3",
        session_id: "s1", created_at: "2024", updated_at: "2025", last_error: "err", last_result: "done" },
    ];
    const agent = { ...make_agent_ctx(), subagents: { ...make_agent_ctx().subagents, list: vi.fn().mockReturnValue(subagents_data) } };
    create_command_router(make_deps({ agent: agent as any }));
    const access = vi.mocked(AgentHandler).mock.calls[0][0] as any;
    const result = access.list();
    expect(result[0]).toMatchObject({ id: "a1", role: "coder", status: "running" });
    expect(result[0].label).toBe("bot1");
  });

  it("get(id) → null 일 때 null 반환", () => {
    create_command_router(make_deps());
    const access = vi.mocked(AgentHandler).mock.calls[0][0] as any;
    const result = access.get("nonexistent");
    expect(result).toBeNull();
  });
});

// ══════════════════════════════════════════════════════
// ReloadHandler deps
// ══════════════════════════════════════════════════════

describe("create_command_router — ReloadHandler deps", () => {
  it("reload_tools → tool_reloader.reload_now + tool count 반환", async () => {
    const reload_now = vi.fn();
    const get_definitions = vi.fn().mockReturnValue([{}, {}]);
    const agent = { ...make_agent_ctx(), tool_reloader: { reload_now }, tools: { ...make_agent_ctx().tools, get_definitions } };
    create_command_router(make_deps({ agent: agent as any }));
    const reload_deps = vi.mocked(ReloadHandler).mock.calls[0][0] as any;
    const count = await reload_deps.reload_tools();
    expect(reload_now).toHaveBeenCalledOnce();
    expect(count).toBe(2);
  });

  it("reload_skills → refresh + list_skills 호출", async () => {
    const refresh = vi.fn();
    const list_skills = vi.fn().mockReturnValue([{}, {}, {}]);
    const skills_loader = { ...make_skills_loader(), refresh, list_skills };
    const agent = { ...make_agent_ctx(), context: { ...make_agent_ctx().context, skills_loader } };
    create_command_router(make_deps({ agent: agent as any }));
    const reload_deps = vi.mocked(ReloadHandler).mock.calls[0][0] as any;
    const count = await reload_deps.reload_skills();
    expect(refresh).toHaveBeenCalledOnce();
    expect(count).toBe(3);
  });

  it("reload_config → 아무것도 반환하지 않음 (no-op)", async () => {
    create_command_router(make_deps());
    const reload_deps = vi.mocked(ReloadHandler).mock.calls[0][0] as any;
    const result = await reload_deps.reload_config();
    expect(result).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════
// StatsHandler get_provider_health
// ══════════════════════════════════════════════════════

describe("create_command_router — StatsHandler deps", () => {
  it("avg_latency_ms 계산: 1200ms / 12 calls = 100ms", () => {
    const rank = vi.fn().mockReturnValue([{ provider: "slack", score: 0.9 }]);
    const get_metrics = vi.fn().mockReturnValue({ success_count: 10, failure_count: 2, total_latency_ms: 1200 });
    const get_health_scorer = vi.fn().mockReturnValue({ rank, get_metrics });
    create_command_router(make_deps({ providers: { get_secret_vault: vi.fn().mockReturnValue({}), get_health_scorer } as any }));
    const stats_deps = vi.mocked(StatsHandler).mock.calls[0][0] as any;
    const health = stats_deps.get_provider_health();
    expect(health[0].avg_latency_ms).toBeCloseTo(100);
  });

  it("success+failure=0 → avg_latency_ms=0 (division guard)", () => {
    const rank = vi.fn().mockReturnValue([{ provider: "telegram", score: 0 }]);
    const get_metrics = vi.fn().mockReturnValue({ success_count: 0, failure_count: 0, total_latency_ms: 0 });
    const get_health_scorer = vi.fn().mockReturnValue({ rank, get_metrics });
    create_command_router(make_deps({ providers: { get_secret_vault: vi.fn().mockReturnValue({}), get_health_scorer } as any }));
    const stats_deps = vi.mocked(StatsHandler).mock.calls[0][0] as any;
    const health = stats_deps.get_provider_health();
    expect(health[0].avg_latency_ms).toBe(0);
  });
});
