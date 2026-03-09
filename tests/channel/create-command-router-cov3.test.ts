/**
 * create_command_router — 미커버 람다 deps 커버리지 (cov3).
 * TaskHandler / StatusHandler / SkillHandler / DoctorHandler /
 * VerifyHandler / StopHandler / MemoryHandler / DecisionHandler /
 * PromiseHandler / AgentHandler(cancel/send/count) 람다 직접 호출.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const make_handler_class = vi.hoisted(() => (name: string) =>
  vi.fn().mockImplementation(function (this: any, ...args: unknown[]) {
    this.name = name;
    this.can_handle = vi.fn().mockReturnValue(false);
    this.handle = vi.fn().mockResolvedValue(true);
    this._ctor_args = args;
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
  StopHandler, MemoryHandler, DecisionHandler, PromiseHandler,
  TaskHandler, StatusHandler, SkillHandler, DoctorHandler,
  AgentHandler, VerifyHandler, StatsHandler,
} from "@src/channels/commands/index.js";

// ─── 헬퍼 ──────────────────────────────────────────────────────────────────

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
    tools: { tool_names: vi.fn().mockReturnValue(["bash", "read"]), get_definitions: vi.fn().mockReturnValue([{}, {}]) },
    context: {
      memory_store: { get: vi.fn() },
      promise_service: { create: vi.fn() },
      skills_loader: make_skills_loader(),
    },
    tool_reloader: { reload_now: vi.fn() },
    subagents: {
      list: vi.fn().mockReturnValue([]),
      list_running: vi.fn().mockReturnValue([]),
      get: vi.fn().mockReturnValue(null),
      cancel: vi.fn().mockReturnValue(true),
      send_input: vi.fn().mockReturnValue(true),
      get_running_count: vi.fn().mockReturnValue(3),
    },
  };
}

function make_deps(overrides: Record<string, unknown> = {}): Parameters<typeof create_command_router>[0] {
  const health_scorer = {
    rank: vi.fn().mockReturnValue([]),
    get_metrics: vi.fn().mockReturnValue({ success_count: 0, failure_count: 0, total_latency_ms: 0 }),
  };
  return {
    cancel_active_runs: vi.fn().mockReturnValue(2),
    render_profile: { get: vi.fn(), set: vi.fn(), reset: vi.fn() },
    agent: make_agent_ctx() as any,
    agent_runtime: {
      find_waiting_task: vi.fn().mockResolvedValue({ taskId: "t1" }),
      get_task: vi.fn().mockResolvedValue({ taskId: "t2" }),
      cancel_task: vi.fn().mockResolvedValue({ taskId: "t3", status: "cancelled" }),
      list_active_tasks: vi.fn().mockReturnValue([{}, {}]),
      list_active_loops: vi.fn().mockReturnValue([{}]),
      stop_loop: vi.fn().mockResolvedValue({ loopId: "l1", status: "stopped" }),
      spawn_and_wait: vi.fn().mockResolvedValue({ reply: "verified" }),
    } as any,
    process_tracker: {
      list_active: vi.fn().mockReturnValue([{ run_id: "r1" }]),
      list_recent: vi.fn().mockReturnValue([{ run_id: "r2" }]),
      get: vi.fn().mockReturnValue({ run_id: "r3" }),
      cancel: vi.fn().mockResolvedValue({ cancelled: true, details: "ok" }),
    } as any,
    orchestration: { get_cd_score: vi.fn().mockReturnValue(5), reset_cd_score: vi.fn() } as any,
    providers: {
      get_secret_vault: vi.fn().mockReturnValue({}),
      get_health_scorer: vi.fn().mockReturnValue(health_scorer),
    } as any,
    agent_backend_registry: { list_backends: vi.fn().mockReturnValue(["claude", "codex"]) } as any,
    mcp: {
      list_servers: vi.fn().mockReturnValue([{ name: "mcp1", connected: true, tools: [{}], error: null }]),
      get_server_configs: vi.fn().mockReturnValue({}),
      connect_server: vi.fn().mockResolvedValue(undefined),
    } as any,
    session_recorder: { get_last_assistant_content: vi.fn().mockReturnValue("last reply") },
    cron: { list_jobs: vi.fn().mockResolvedValue([{}, {}]) } as any,
    decisions: { get: vi.fn() } as any,
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
// StopHandler lambda
// ══════════════════════════════════════════════════════

describe("create_command_router — StopHandler 람다", () => {
  it("cancel_active_runs 람다 → cancel_active_runs(provider:chat_id) 호출", async () => {
    const cancel_active_runs = vi.fn().mockReturnValue(2);
    create_command_router(make_deps({ cancel_active_runs }));
    const stop_fn = vi.mocked(StopHandler).mock.calls[0][0] as (p: string, c: string) => number;
    const result = await stop_fn("slack", "C123");
    expect(cancel_active_runs).toHaveBeenCalledWith("slack:C123");
    expect(result).toBe(2);
  });
});

// ══════════════════════════════════════════════════════
// MemoryHandler / DecisionHandler / PromiseHandler 람다
// ══════════════════════════════════════════════════════

describe("create_command_router — 단순 getter 람다", () => {
  it("MemoryHandler — get_memory_store() → memory_store 반환", () => {
    const mem = { get: vi.fn() };
    const agent = { ...make_agent_ctx(), context: { ...make_agent_ctx().context, memory_store: mem } };
    create_command_router(make_deps({ agent: agent as any }));
    const mem_deps = vi.mocked(MemoryHandler).mock.calls[0][0] as any;
    expect(mem_deps.get_memory_store()).toBe(mem);
  });

  it("DecisionHandler — get_decision_service() → decisions 반환", () => {
    const decisions = { get: vi.fn() };
    create_command_router(make_deps({ decisions: decisions as any }));
    const dec_deps = vi.mocked(DecisionHandler).mock.calls[0][0] as any;
    expect(dec_deps.get_decision_service()).toBe(decisions);
  });

  it("PromiseHandler — get_promise_service() → promise_service 반환", () => {
    const ps = { create: vi.fn() };
    const agent = { ...make_agent_ctx(), context: { ...make_agent_ctx().context, promise_service: ps } };
    create_command_router(make_deps({ agent: agent as any }));
    const prom_deps = vi.mocked(PromiseHandler).mock.calls[0][0] as any;
    expect(prom_deps.get_promise_service()).toBe(ps);
  });
});

// ══════════════════════════════════════════════════════
// TaskHandler deps 람다
// ══════════════════════════════════════════════════════

describe("create_command_router — TaskHandler deps 람다", () => {
  function get_task_deps() {
    create_command_router(make_deps());
    return vi.mocked(TaskHandler).mock.calls[0][0] as any;
  }

  it("find_waiting_task → agent_runtime.find_waiting_task 위임", async () => {
    const deps = get_task_deps();
    const result = await deps.find_waiting_task("slack", "C1");
    expect(result).toMatchObject({ taskId: "t1" });
  });

  it("get_task → agent_runtime.get_task 위임", async () => {
    const deps = get_task_deps();
    const result = await deps.get_task("t2");
    expect(result).toMatchObject({ taskId: "t2" });
  });

  it("cancel_task → agent_runtime.cancel_task 위임", async () => {
    const deps = get_task_deps();
    const result = await deps.cancel_task("t3", "user");
    expect(result).toMatchObject({ taskId: "t3" });
  });

  it("list_active_tasks → agent_runtime.list_active_tasks 위임", () => {
    const deps = get_task_deps();
    const result = deps.list_active_tasks();
    expect(result).toHaveLength(2);
  });

  it("list_active_loops → agent_runtime.list_active_loops 위임", () => {
    const deps = get_task_deps();
    const result = deps.list_active_loops();
    expect(result).toHaveLength(1);
  });

  it("stop_loop → agent_runtime.stop_loop 위임", async () => {
    const deps = get_task_deps();
    const result = await deps.stop_loop("l1", "user");
    expect(result).toMatchObject({ loopId: "l1" });
  });

  it("list_active_processes → process_tracker.list_active 위임", () => {
    const deps = get_task_deps();
    const result = deps.list_active_processes();
    expect(result).toHaveLength(1);
    expect(result[0].run_id).toBe("r1");
  });

  it("list_recent_processes(10) → process_tracker.list_recent(10) 위임", () => {
    const list_recent = vi.fn().mockReturnValue([]);
    create_command_router(make_deps({ process_tracker: { list_active: vi.fn().mockReturnValue([]), list_recent, get: vi.fn(), cancel: vi.fn() } as any }));
    const deps = vi.mocked(TaskHandler).mock.calls[0][0] as any;
    deps.list_recent_processes(10);
    expect(list_recent).toHaveBeenCalledWith(10);
  });

  it("get_process(id) → process_tracker.get(id) 위임", () => {
    const deps = get_task_deps();
    const result = deps.get_process("r3");
    expect(result).toMatchObject({ run_id: "r3" });
  });

  it("cancel_process(id) → process_tracker.cancel(id) 위임", async () => {
    const deps = get_task_deps();
    const result = await deps.cancel_process("r1");
    expect(result.cancelled).toBe(true);
  });
});

// ══════════════════════════════════════════════════════
// StatusHandler deps 람다
// ══════════════════════════════════════════════════════

describe("create_command_router — StatusHandler deps 람다", () => {
  it("list_tools → tool_names() 변환 반환", () => {
    const tool_names = vi.fn().mockReturnValue(["bash", "read", "write"]);
    const agent = { ...make_agent_ctx(), tools: { ...make_agent_ctx().tools, tool_names } };
    create_command_router(make_deps({ agent: agent as any }));
    const deps = vi.mocked(StatusHandler).mock.calls[0][0] as any;
    const result = deps.list_tools();
    expect(result).toEqual([{ name: "bash" }, { name: "read" }, { name: "write" }]);
  });

  it("list_skills → list_skills(true) 위임", () => {
    const list_skills = vi.fn().mockReturnValue([{ name: "coder", summary: "코딩" }]);
    const skills_loader = { ...make_skills_loader(), list_skills };
    const agent = { ...make_agent_ctx(), context: { ...make_agent_ctx().context, skills_loader } };
    create_command_router(make_deps({ agent: agent as any }));
    const deps = vi.mocked(StatusHandler).mock.calls[0][0] as any;
    const result = deps.list_skills();
    expect(list_skills).toHaveBeenCalledWith(true);
    expect(result[0].name).toBe("coder");
  });
});

// ══════════════════════════════════════════════════════
// SkillHandler deps 람다
// ══════════════════════════════════════════════════════

describe("create_command_router — SkillHandler deps 람다", () => {
  it("list_skills → list_skills(true) 변환 (type/source/always/model)", () => {
    const list_skills = vi.fn().mockReturnValue([
      { name: "coder", summary: "코딩", type: "task", source: "builtin", always: "true", model: "claude" },
    ]);
    const skills_loader = { ...make_skills_loader(), list_skills };
    const agent = { ...make_agent_ctx(), context: { ...make_agent_ctx().context, skills_loader } };
    create_command_router(make_deps({ agent: agent as any }));
    const deps = vi.mocked(SkillHandler).mock.calls[0][0] as any;
    const result = deps.list_skills();
    expect(result[0]).toMatchObject({ name: "coder", always: true, model: "claude" });
  });

  it("get_skill: metadata 없음 → null", () => {
    create_command_router(make_deps());
    const deps = vi.mocked(SkillHandler).mock.calls[0][0] as any;
    expect(deps.get_skill("unknown")).toBeNull();
  });

  it("get_skill: metadata 있음 → 변환 객체 반환", () => {
    const metadata = {
      name: "coder", summary: "코딩", type: "task", source: "builtin",
      always: true, model: "claude", tools: ["bash"], requirements: [],
      role: "developer", shared_protocols: [],
    };
    const get_skill_metadata = vi.fn().mockReturnValue(metadata);
    const skills_loader = { ...make_skills_loader(), get_skill_metadata };
    const agent = { ...make_agent_ctx(), context: { ...make_agent_ctx().context, skills_loader } };
    create_command_router(make_deps({ agent: agent as any }));
    const deps = vi.mocked(SkillHandler).mock.calls[0][0] as any;
    const result = deps.get_skill("coder");
    expect(result).toMatchObject({ name: "coder", role: "developer" });
  });

  it("list_role_skills → list_role_skills() 변환 반환", () => {
    const list_role_skills = vi.fn().mockReturnValue([{ name: "coder", role: "dev", summary: "코딩" }]);
    const skills_loader = { ...make_skills_loader(), list_role_skills };
    const agent = { ...make_agent_ctx(), context: { ...make_agent_ctx().context, skills_loader } };
    create_command_router(make_deps({ agent: agent as any }));
    const deps = vi.mocked(SkillHandler).mock.calls[0][0] as any;
    const result = deps.list_role_skills();
    expect(result).toEqual([{ name: "coder", role: "dev", summary: "코딩" }]);
  });

  it("recommend(task, limit) → suggest_skills_for_text(task, limit) 위임", () => {
    const suggest = vi.fn().mockReturnValue(["coder"]);
    const skills_loader = { ...make_skills_loader(), suggest_skills_for_text: suggest };
    const agent = { ...make_agent_ctx(), context: { ...make_agent_ctx().context, skills_loader } };
    create_command_router(make_deps({ agent: agent as any }));
    const deps = vi.mocked(SkillHandler).mock.calls[0][0] as any;
    const result = deps.recommend("coding task", 3);
    expect(suggest).toHaveBeenCalledWith("coding task", 3);
    expect(result).toEqual(["coder"]);
  });

  it("recommend(task, undefined) → limit=5 기본값", () => {
    const suggest = vi.fn().mockReturnValue([]);
    const skills_loader = { ...make_skills_loader(), suggest_skills_for_text: suggest };
    const agent = { ...make_agent_ctx(), context: { ...make_agent_ctx().context, skills_loader } };
    create_command_router(make_deps({ agent: agent as any }));
    const deps = vi.mocked(SkillHandler).mock.calls[0][0] as any;
    deps.recommend("task");
    expect(suggest).toHaveBeenCalledWith("task", 5);
  });

  it("refresh() → refresh() + list_skills().length 반환", () => {
    const refresh = vi.fn();
    const list_skills = vi.fn().mockReturnValue([{}, {}, {}]);
    const skills_loader = { ...make_skills_loader(), refresh, list_skills };
    const agent = { ...make_agent_ctx(), context: { ...make_agent_ctx().context, skills_loader } };
    create_command_router(make_deps({ agent: agent as any }));
    const deps = vi.mocked(SkillHandler).mock.calls[0][0] as any;
    const count = deps.refresh();
    expect(refresh).toHaveBeenCalled();
    expect(count).toBe(3);
  });
});

// ══════════════════════════════════════════════════════
// DoctorHandler deps 람다
// ══════════════════════════════════════════════════════

describe("create_command_router — DoctorHandler deps 람다", () => {
  function get_doctor_deps() {
    create_command_router(make_deps());
    return vi.mocked(DoctorHandler).mock.calls[0][0] as any;
  }

  it("get_tool_count → tool_names().length", () => {
    const deps = get_doctor_deps();
    expect(deps.get_tool_count()).toBe(2); // make_agent_ctx: ["bash", "read"]
  });

  it("get_skill_count → list_skills().length", () => {
    const list_skills = vi.fn().mockReturnValue([{}, {}]);
    const skills_loader = { ...make_skills_loader(), list_skills };
    const agent = { ...make_agent_ctx(), context: { ...make_agent_ctx().context, skills_loader } };
    create_command_router(make_deps({ agent: agent as any }));
    const deps = vi.mocked(DoctorHandler).mock.calls[0][0] as any;
    expect(deps.get_skill_count()).toBe(2);
  });

  it("get_active_task_count → list_active_tasks().length", () => {
    const deps = get_doctor_deps();
    expect(deps.get_active_task_count()).toBe(2);
  });

  it("get_active_loop_count → list_active_loops().length", () => {
    const deps = get_doctor_deps();
    expect(deps.get_active_loop_count()).toBe(1);
  });

  it("list_backends → agent_backend_registry.list_backends() map String", () => {
    const deps = get_doctor_deps();
    expect(deps.list_backends()).toEqual(["claude", "codex"]);
  });

  it("list_mcp_servers → mcp.list_servers() 변환", () => {
    const deps = get_doctor_deps();
    const result = deps.list_mcp_servers();
    expect(result).toEqual([{ name: "mcp1", connected: true, tool_count: 1, error: null }]);
  });

  it("get_cron_job_count → cron.list_jobs().then(length)", async () => {
    const deps = get_doctor_deps();
    const count = await deps.get_cron_job_count();
    expect(count).toBe(2);
  });
});

// ══════════════════════════════════════════════════════
// AgentHandler cancel / send_input / get_running_count 람다
// ══════════════════════════════════════════════════════

describe("create_command_router — AgentHandler cancel/send/count 람다", () => {
  function get_agent_deps() {
    create_command_router(make_deps());
    return vi.mocked(AgentHandler).mock.calls[0][0] as any;
  }

  it("cancel(id) → subagents.cancel(id) 위임", () => {
    const deps = get_agent_deps();
    const result = deps.cancel("sub-1");
    expect(result).toBe(true);
  });

  it("send_input(id, text) → subagents.send_input(id, text) 위임", () => {
    const deps = get_agent_deps();
    const result = deps.send_input("sub-1", "hello");
    expect(result).toBe(true);
  });

  it("get_running_count() → subagents.get_running_count() 위임", () => {
    const deps = get_agent_deps();
    expect(deps.get_running_count()).toBe(3);
  });
});

// ══════════════════════════════════════════════════════
// VerifyHandler deps 람다
// ══════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════
// StatsHandler deps 람다 (L134)
// ══════════════════════════════════════════════════════

describe("create_command_router — StatsHandler deps 람다 (L134)", () => {
  it("reset_cd() → orchestration.reset_cd_score() 위임 (L134)", () => {
    const reset_cd_score = vi.fn();
    create_command_router(make_deps({ orchestration: { get_cd_score: vi.fn().mockReturnValue(0), reset_cd_score } as any }));
    const stats_deps = vi.mocked(StatsHandler).mock.calls[0][0] as any;
    stats_deps.reset_cd();
    expect(reset_cd_score).toHaveBeenCalled();
  });
});

describe("create_command_router — VerifyHandler deps 람다", () => {
  it("get_last_output → session_recorder.get_last_assistant_content 위임", () => {
    const get_last_assistant_content = vi.fn().mockReturnValue("last output");
    const session_recorder = { get_last_assistant_content };
    create_command_router(make_deps({ session_recorder, default_alias: "bot" }));
    const deps = vi.mocked(VerifyHandler).mock.calls[0][0] as any;
    const result = deps.get_last_output("slack" as any, "C1");
    expect(get_last_assistant_content).toHaveBeenCalledWith("slack", "C1", "bot");
    expect(result).toBe("last output");
  });

  it("run_verification(task) → agent_runtime.spawn_and_wait 위임", async () => {
    const spawn_and_wait = vi.fn().mockResolvedValue({ reply: "done" });
    create_command_router(make_deps({
      agent_runtime: {
        find_waiting_task: vi.fn(), get_task: vi.fn(), cancel_task: vi.fn(),
        list_active_tasks: vi.fn().mockReturnValue([]),
        list_active_loops: vi.fn().mockReturnValue([]),
        stop_loop: vi.fn(), spawn_and_wait,
      } as any,
    }));
    const deps = vi.mocked(VerifyHandler).mock.calls[0][0] as any;
    const result = await deps.run_verification("test this");
    expect(spawn_and_wait).toHaveBeenCalledWith(expect.objectContaining({ task: "test this", max_turns: 5 }));
    expect(result.reply).toBe("done");
  });
});
