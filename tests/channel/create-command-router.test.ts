/**
 * create_command_router — 팩토리 함수 커버리지.
 * - create_command_router 호출 → CommandRouter 반환
 * - 내부 람다(reload_config, reload_tools, reload_skills, pick_subagent 등) 실행
 */
import { describe, it, expect, vi } from "vitest";
import { create_command_router } from "@src/channels/create-command-router.js";
import type { CommandContext } from "@src/channels/commands/types.js";

function make_deps() {
  const skills_loader = {
    list_skills: vi.fn().mockReturnValue([
      { name: "coder", summary: "코딩", type: "task", source: "builtin", always: false, model: null },
    ]),
    get_skill_metadata: vi.fn().mockReturnValue({
      name: "coder", summary: "코딩", type: "task", source: "builtin",
      always: false, model: null, tools: [], requirements: [], role: null, shared_protocols: [],
    }),
    list_role_skills: vi.fn().mockReturnValue([]),
    suggest_skills_for_text: vi.fn().mockReturnValue([]),
    refresh: vi.fn(),
  };
  const tools = {
    tool_names: vi.fn().mockReturnValue(["bash", "read"]),
    get_definitions: vi.fn().mockReturnValue([{ name: "bash" }, { name: "read" }]),
  };
  const tool_reloader = { reload_now: vi.fn() };
  const subagents = {
    list: vi.fn().mockReturnValue([]),
    list_running: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
    cancel: vi.fn().mockReturnValue(false),
    send_input: vi.fn().mockResolvedValue(undefined),
    get_running_count: vi.fn().mockReturnValue(0),
  };

  const agent_runtime = {
    find_waiting_task: vi.fn().mockReturnValue(null),
    get_task: vi.fn().mockReturnValue(null),
    cancel_task: vi.fn().mockResolvedValue(false),
    list_active_tasks: vi.fn().mockReturnValue([]),
    list_active_loops: vi.fn().mockReturnValue([]),
    stop_loop: vi.fn().mockResolvedValue(false),
    spawn_and_wait: vi.fn().mockResolvedValue({ finish_reason: "stop", content: "verified" }),
  };

  const process_tracker = {
    list_active: vi.fn().mockReturnValue([]),
    list_recent: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
    cancel: vi.fn().mockResolvedValue(false),
    link_workflow: vi.fn(),
  };

  const orchestration = {
    get_cd_score: vi.fn().mockReturnValue({ score: 0 }),
    reset_cd_score: vi.fn(),
  };

  const providers = {
    get_secret_vault: vi.fn().mockReturnValue({
      list_secrets: vi.fn().mockResolvedValue([]),
      get_secret: vi.fn().mockResolvedValue(null),
      put_secret: vi.fn().mockResolvedValue({ ok: true }),
      remove_secret: vi.fn().mockResolvedValue(false),
    }),
    get_health_scorer: vi.fn().mockReturnValue({
      rank: vi.fn().mockReturnValue([]),
      get_metrics: vi.fn().mockReturnValue({ success_count: 0, failure_count: 0, total_latency_ms: 0 }),
    }),
  };

  const agent_backend_registry = {
    list_backends: vi.fn().mockReturnValue(["claude_cli"]),
  };

  const mcp = {
    list_servers: vi.fn().mockReturnValue([]),
    get_server_configs: vi.fn().mockReturnValue({}),
    connect_server: vi.fn().mockResolvedValue(undefined),
  };

  const cron = {
    list_jobs: vi.fn().mockResolvedValue([]),
    add_job: vi.fn().mockResolvedValue({ id: "j1" }),
    remove_job: vi.fn().mockResolvedValue(true),
    enable_job: vi.fn().mockResolvedValue(null),
    run_job: vi.fn().mockResolvedValue(true),
    status: vi.fn().mockResolvedValue({ enabled: true, paused: false, jobs: 0 }),
    pause: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    every: vi.fn(),
    disable_all_and_pause: vi.fn().mockResolvedValue(0),
  };

  const decisions = {
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockReturnValue(null),
    decide: vi.fn().mockResolvedValue({ ok: true }),
    reject: vi.fn().mockResolvedValue(true),
  };

  const memory_store = {
    search: vi.fn().mockResolvedValue([]),
    read_longterm: vi.fn().mockResolvedValue(""),
    write_longterm: vi.fn().mockResolvedValue(undefined),
    read_daily: vi.fn().mockResolvedValue(""),
    write_daily: vi.fn().mockResolvedValue(undefined),
    append_daily: vi.fn().mockResolvedValue(undefined),
    list_daily: vi.fn().mockResolvedValue([]),
    consolidate: vi.fn().mockResolvedValue({ ok: true }),
    save_memory: vi.fn().mockResolvedValue({ ok: true, target: "" }),
    get_paths: vi.fn().mockResolvedValue({ workspace: "/tmp", memoryDir: "/tmp/memory", sqlitePath: "/tmp/memory.db" }),
  };

  const promise_service = {
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockReturnValue(null),
    add: vi.fn().mockResolvedValue({ id: "p1" }),
    fulfill: vi.fn().mockResolvedValue(true),
    reject: vi.fn().mockResolvedValue(true),
  };

  return {
    cancel_active_runs: vi.fn().mockReturnValue(0),
    render_profile: {
      get: vi.fn().mockReturnValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      reset: vi.fn().mockResolvedValue(undefined),
    },
    agent: {
      context: { memory_store, skills_loader, promise_service },
      tools,
      tool_reloader,
      subagents,
    },
    agent_runtime,
    process_tracker,
    orchestration,
    providers,
    agent_backend_registry,
    mcp,
    session_recorder: {
      get_last_assistant_content: vi.fn().mockReturnValue("last output"),
    },
    cron,
    decisions,
    default_alias: "assistant",
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    confirmation_guard: null,
    tone_store: null,
  };
}

function make_ctx(command_name: string, args: string[] = []): CommandContext {
  return {
    provider: "slack" as never,
    message: {
      id: "m1",
      provider: "slack",
      channel: "slack",
      sender_id: "U1",
      chat_id: "C1",
      content: `/${command_name}`,
      at: new Date().toISOString(),
      metadata: {},
    },
    command: {
      raw: `/${command_name}`,
      name: command_name,
      args,
      args_lower: args.map((a) => a.toLowerCase()),
    },
    text: `/${command_name}`,
    send_reply: vi.fn().mockResolvedValue(undefined),
  };
}

// ══════════════════════════════════════════
// create_command_router 기본 호출
// ══════════════════════════════════════════

describe("create_command_router — 팩토리 함수", () => {
  it("create_command_router 호출 → CommandRouter 반환", () => {
    const deps = make_deps() as any;
    const router = create_command_router(deps);
    expect(router).toBeDefined();
    expect(typeof router.try_handle).toBe("function");
  });

  it("/help → HelpHandler 처리", async () => {
    const deps = make_deps() as any;
    const router = create_command_router(deps);
    const ctx = make_ctx("help");
    const handled = await router.try_handle(ctx);
    expect(handled).toBe(true);
  });

  it("/stop → StopHandler 처리 (cancel_active_runs 호출)", async () => {
    const deps = make_deps() as any;
    const router = create_command_router(deps);
    const ctx = make_ctx("stop");
    const handled = await router.try_handle(ctx);
    expect(handled).toBe(true);
    expect(deps.cancel_active_runs).toHaveBeenCalled();
  });

  it("/skill → SkillHandler 처리", async () => {
    const deps = make_deps() as any;
    const router = create_command_router(deps);
    const ctx = make_ctx("skill");
    const handled = await router.try_handle(ctx);
    expect(handled).toBe(true);
  });

  it("/skill info <name> → get_skill 람다 실행", async () => {
    const deps = make_deps() as any;
    const router = create_command_router(deps);
    const ctx = make_ctx("skill", ["info", "coder"]);
    const handled = await router.try_handle(ctx);
    expect(handled).toBe(true);
  });

  it("/skill info <미존재 name> → get_skill null 반환", async () => {
    const deps = make_deps() as any;
    deps.agent.context.skills_loader.get_skill_metadata.mockReturnValue(null);
    const router = create_command_router(deps);
    const ctx = make_ctx("skill", ["info", "nonexistent"]);
    const handled = await router.try_handle(ctx);
    expect(handled).toBe(true);
  });

  it("/reload all → ReloadHandler 처리 (reload_tools/skills 람다 실행)", async () => {
    const deps = make_deps() as any;
    const router = create_command_router(deps);
    const ctx = make_ctx("reload", ["all"]);
    const handled = await router.try_handle(ctx);
    expect(handled).toBe(true);
    expect(deps.agent.tool_reloader.reload_now).toHaveBeenCalled();
    expect(deps.agent.context.skills_loader.refresh).toHaveBeenCalled();
  });

  it("/status → StatusHandler 처리", async () => {
    const deps = make_deps() as any;
    const router = create_command_router(deps);
    const ctx = make_ctx("status");
    const handled = await router.try_handle(ctx);
    expect(handled).toBe(true);
  });

  it("/doctor → DoctorHandler 처리", async () => {
    const deps = make_deps() as any;
    const router = create_command_router(deps);
    const ctx = make_ctx("doctor");
    const handled = await router.try_handle(ctx);
    expect(handled).toBe(true);
  });

  it("/agent → AgentHandler 처리 (pick_subagent 람다)", async () => {
    const deps = make_deps() as any;
    // subagent 목록에 항목 추가
    deps.agent.subagents.list.mockReturnValue([{
      id: "sub1", role: "assistant", status: "running",
      label: "코더", created_at: new Date().toISOString(),
      last_error: null, model: "claude", session_id: null,
      updated_at: new Date().toISOString(), last_result: null,
    }]);
    const router = create_command_router(deps);
    const ctx = make_ctx("agent");
    const handled = await router.try_handle(ctx);
    expect(handled).toBe(true);
  });

  it("/stats → StatsHandler 처리 (get_provider_health 람다)", async () => {
    const deps = make_deps() as any;
    deps.providers.get_health_scorer.mockReturnValue({
      rank: vi.fn().mockReturnValue([
        { provider: "anthropic", score: 100 },
      ]),
      get_metrics: vi.fn().mockReturnValue({ success_count: 5, failure_count: 1, total_latency_ms: 300 }),
    });
    const router = create_command_router(deps);
    const ctx = make_ctx("stats");
    const handled = await router.try_handle(ctx);
    expect(handled).toBe(true);
  });

  it("/mcp → McpHandler 처리 (reconnect 람다 - config 없음)", async () => {
    const deps = make_deps() as any;
    const router = create_command_router(deps);
    const ctx = make_ctx("mcp", ["reconnect", "nonexistent-server"]);
    const handled = await router.try_handle(ctx);
    expect(handled).toBe(true);
  });

  it("/verify → VerifyHandler 처리 (get_last_output + run_verification)", async () => {
    const deps = make_deps() as any;
    const router = create_command_router(deps);
    const ctx = make_ctx("verify", ["check", "this"]);
    const handled = await router.try_handle(ctx);
    expect(handled).toBe(true);
  });

  it("알 수 없는 명령어 → false 반환", async () => {
    const deps = make_deps() as any;
    const router = create_command_router(deps);
    const ctx = make_ctx("unknowncmd123");
    const handled = await router.try_handle(ctx);
    expect(handled).toBe(false);
  });
});
