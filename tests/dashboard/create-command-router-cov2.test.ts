/**
 * create-command-router.ts — 미커버 람다 커버리지.
 * 각 핸들러에 등록된 callback 람다를 실제로 실행시켜 커버.
 */
import { describe, it, expect, vi } from "vitest";
import { create_command_router, type CommandRouterDeps } from "@src/channels/create-command-router.js";
import type { CommandContext } from "@src/channels/commands/types.js";
import type { InboundMessage } from "@src/bus/types.js";

function make_message(content: string): InboundMessage {
  return {
    provider: "slack",
    chat_id: "C1",
    sender_id: "U1",
    message_id: "M1",
    content,
    timestamp: new Date().toISOString(),
  } as InboundMessage;
}

function make_ctx(name: string, args: string[] = []): { ctx: CommandContext; replies: string[] } {
  const replies: string[] = [];
  const raw = `/${name}${args.length ? " " + args.join(" ") : ""}`;
  return {
    replies,
    ctx: {
      provider: "slack",
      message: make_message(raw),
      command: { raw, name, args, args_lower: args.map((a) => a.toLowerCase()) },
      text: raw,
      send_reply: vi.fn(async (text: string) => { replies.push(text); }),
    } as CommandContext,
  };
}

// ── 공유 mock scorer (get_health_scorer가 항상 같은 인스턴스 반환) ──
function make_scorer() {
  return {
    rank: vi.fn(() => [{ provider: "claude", score: 0.9 }]),
    get_metrics: vi.fn(() => ({ success_count: 10, failure_count: 1, total_latency_ms: 500 })),
  };
}

function make_deps(overrides: Partial<CommandRouterDeps> = {}): CommandRouterDeps {
  const scorer = make_scorer();
  return {
    cancel_active_runs: vi.fn(() => 0),
    render_profile: {
      get: vi.fn(async () => ({})),
      set: vi.fn(async () => {}),
      reset: vi.fn(async () => {}),
    },
    agent: {
      context: {
        memory_store: {},
        promise_service: { list: vi.fn(async () => []), add: vi.fn(async () => ({ ok: true })), remove: vi.fn(async () => ({ ok: true })) },
        skills_loader: {
          list_skills: vi.fn(() => [
            { name: "s1", summary: "sum1", type: "tool", source: "local", always: "false", model: null, tools: [], requirements: [], role: null, shared_protocols: [] },
          ]),
          get_skill_metadata: vi.fn((name: string) => name === "s1" ? {
            name: "s1", summary: "sum1", type: "tool", source: "local",
            always: "false", model: null, tools: [], requirements: [], role: null, shared_protocols: [],
          } : null),
          refresh: vi.fn(() => 1),
          suggest_skills_for_text: vi.fn(() => [{ name: "s1", score: 0.9 }]),
          list_role_skills: vi.fn(() => [{ name: "s1", role: "coder", summary: "sum1" }]),
        },
      },
      tools: {
        tool_names: vi.fn(() => ["bash", "read"]),
        get_definitions: vi.fn(() => [{ name: "bash" }, { name: "read" }]),
      },
      tool_reloader: { reload_now: vi.fn() },
      subagents: {
        list: vi.fn(() => [
          { id: "ag1", role: "coder", status: "running", label: "coder-1", created_at: "2026-01-01", last_error: null, model: "claude", session_id: "s1", updated_at: "2026-01-01", last_result: "ok" },
        ]),
        list_running: vi.fn(() => [
          { id: "ag1", role: "coder", status: "running", label: "coder-1", created_at: "2026-01-01", last_error: null, model: "claude", session_id: "s1", updated_at: "2026-01-01", last_result: "ok" },
        ]),
        get: vi.fn((id: string) => id === "ag1" ? {
          id: "ag1", role: "coder", status: "running", label: "coder-1",
          created_at: "2026-01-01", last_error: null, model: "claude",
          session_id: "s1", updated_at: "2026-01-01", last_result: "ok",
        } : null),
        cancel: vi.fn(() => false),
        send_input: vi.fn(async () => false),
        get_running_count: vi.fn(() => 1),
      },
    } as any,
    agent_runtime: {
      find_waiting_task: vi.fn(() => null),
      get_task: vi.fn(async () => null),
      cancel_task: vi.fn(async () => null),
      list_active_tasks: vi.fn(() => []),
      list_active_loops: vi.fn(() => []),
      stop_loop: vi.fn(() => false),
      spawn_and_wait: vi.fn(async () => ({ ok: true, output: "verified" })),
    } as any,
    process_tracker: {
      list_active: vi.fn(() => []),
      list_recent: vi.fn(() => []),
      get: vi.fn(() => null),
      cancel: vi.fn(async () => ({ cancelled: false, details: "" })),
    } as any,
    orchestration: {
      get_cd_score: vi.fn(() => ({ total: 0, events: [] })),
      reset_cd_score: vi.fn(),
    } as any,
    providers: {
      get_secret_vault: vi.fn(() => ({
        list: vi.fn(async () => []),
        get: vi.fn(async () => null),
        set: vi.fn(async () => {}),
        remove: vi.fn(async () => false),
      })),
      get_health_scorer: vi.fn(() => scorer),
    } as any,
    agent_backend_registry: {
      list_backends: vi.fn(() => ["claude_cli"]),
    } as any,
    mcp: {
      list_servers: vi.fn(() => [{ name: "test-mcp", connected: true, tools: [{ name: "tool1" }], error: null }]),
      get_server_configs: vi.fn(() => ({ "test-mcp": { type: "stdio", command: "npx", args: [] } })),
      connect_server: vi.fn(async () => {}),
    } as any,
    session_recorder: {
      get_last_assistant_content: vi.fn(async () => "last reply"),
    },
    cron: {
      list_jobs: vi.fn(async () => []),
    } as any,
    decisions: {
      get_service: vi.fn(),
    } as any,
    default_alias: "test-bot",
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════
// ReloadHandler — reload_tools, reload_skills, reload_config 람다
// (비어있지 않은 args → guide 체크 스킵 → 실제 reload 실행)
// ══════════════════════════════════════════════════════════

describe("create_command_router — /reload 콜백 커버", () => {
  it("/reload all → reload_config/tools/skills 람다 모두 실행", async () => {
    const deps = make_deps();
    const router = create_command_router(deps);
    const { ctx, replies } = make_ctx("reload", ["all"]);
    const handled = await router.try_handle(ctx);
    expect(handled).toBe(true);
    // reload_tools λ: agent.tool_reloader.reload_now() 호출
    expect((deps.agent as any).tool_reloader.reload_now).toHaveBeenCalled();
    // reload_skills λ: skills_loader.refresh() 호출
    expect((deps.agent as any).context.skills_loader.refresh).toHaveBeenCalled();
    expect(replies.some((r) => r.includes("reload"))).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════
// TaskHandler — list, recent 콜백
// ══════════════════════════════════════════════════════════

describe("create_command_router — /task 콜백 커버", () => {
  it("/task list → process_tracker.list_active + agent_runtime.list_active_* 호출", async () => {
    const deps = make_deps();
    const router = create_command_router(deps);
    const { ctx } = make_ctx("task", ["list"]);
    await router.try_handle(ctx);
    expect((deps.process_tracker as any).list_active).toHaveBeenCalled();
    expect((deps.agent_runtime as any).list_active_tasks).toHaveBeenCalled();
    expect((deps.agent_runtime as any).list_active_loops).toHaveBeenCalled();
  });

  it("/task recent → process_tracker.list_recent 호출", async () => {
    const deps = make_deps();
    const router = create_command_router(deps);
    const { ctx } = make_ctx("task", ["recent"]);
    await router.try_handle(ctx);
    expect((deps.process_tracker as any).list_recent).toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════
// SkillHandler — list, info, recommend, roles, refresh 람다
// ══════════════════════════════════════════════════════════

describe("create_command_router — /skill 콜백 커버", () => {
  it("/skill list → list_skills 람다 실행", async () => {
    const deps = make_deps();
    const router = create_command_router(deps);
    const { ctx, replies } = make_ctx("skill", ["list"]);
    await router.try_handle(ctx);
    expect((deps.agent as any).context.skills_loader.list_skills).toHaveBeenCalled();
    expect(replies.length).toBeGreaterThan(0);
  });

  it("/skill info s1 → get_skill_metadata 람다 실행", async () => {
    const deps = make_deps();
    const router = create_command_router(deps);
    const { ctx } = make_ctx("skill", ["info", "s1"]);
    await router.try_handle(ctx);
    expect((deps.agent as any).context.skills_loader.get_skill_metadata).toHaveBeenCalledWith("s1");
  });

  it("/skill recommend task-text → suggest_skills_for_text 람다 실행", async () => {
    const deps = make_deps();
    const router = create_command_router(deps);
    const { ctx } = make_ctx("skill", ["recommend", "some", "task"]);
    await router.try_handle(ctx);
    expect((deps.agent as any).context.skills_loader.suggest_skills_for_text).toHaveBeenCalled();
  });

  it("/skill roles → list_role_skills 람다 실행", async () => {
    const deps = make_deps();
    const router = create_command_router(deps);
    const { ctx } = make_ctx("skill", ["roles"]);
    await router.try_handle(ctx);
    expect((deps.agent as any).context.skills_loader.list_role_skills).toHaveBeenCalled();
  });

  it("/skill refresh → skills_loader.refresh + list_skills 호출", async () => {
    const deps = make_deps();
    const router = create_command_router(deps);
    const { ctx } = make_ctx("skill", ["refresh"]);
    await router.try_handle(ctx);
    expect((deps.agent as any).context.skills_loader.refresh).toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════
// AgentHandler — list, running, status, cancel + pick_subagent 람다
// ══════════════════════════════════════════════════════════

describe("create_command_router — /agent 콜백 커버", () => {
  it("/agent running → list_running + get_running_count 람다 실행, pick_subagent 호출", async () => {
    const deps = make_deps();
    const router = create_command_router(deps);
    const { ctx, replies } = make_ctx("agent", ["running"]);
    await router.try_handle(ctx);
    expect((deps.agent as any).subagents.list_running).toHaveBeenCalled();
    // pick_subagent 람다 실행 → ag1 포함
    expect(replies.some((r) => r.includes("ag1"))).toBe(true);
  });

  it("/agent status ag1 → get 람다 실행", async () => {
    const deps = make_deps();
    const router = create_command_router(deps);
    const { ctx } = make_ctx("agent", ["status", "ag1"]);
    await router.try_handle(ctx);
    expect((deps.agent as any).subagents.get).toHaveBeenCalledWith("ag1");
  });

  it("/agent cancel ag1 → cancel 람다 실행", async () => {
    const deps = make_deps();
    const router = create_command_router(deps);
    const { ctx } = make_ctx("agent", ["cancel", "ag1"]);
    await router.try_handle(ctx);
    expect((deps.agent as any).subagents.cancel).toHaveBeenCalledWith("ag1");
  });
});

// ══════════════════════════════════════════════════════════
// StatsHandler — get_provider_health 람다 (scorer.rank + get_metrics)
// ══════════════════════════════════════════════════════════

describe("create_command_router — /stats 콜백 커버", () => {
  it("/stats anything → format_overview 실행 → get_provider_health 람다 호출", async () => {
    const scorer = make_scorer();
    const deps = make_deps({
      providers: {
        get_secret_vault: vi.fn(() => ({})),
        get_health_scorer: vi.fn(() => scorer),
      } as any,
      orchestration: {
        get_cd_score: vi.fn(() => ({ total: 5, events: [] })),
        reset_cd_score: vi.fn(),
      } as any,
    });
    const router = create_command_router(deps);
    // "abc"는 unknown action → guide 체크 없이 format_overview() 호출
    const { ctx, replies } = make_ctx("stats", ["abc"]);
    await router.try_handle(ctx);
    expect(scorer.rank).toHaveBeenCalled();
    expect(scorer.get_metrics).toHaveBeenCalledWith("claude");
    expect(replies.length).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════════════════════
// VerifyHandler — get_last_output + run_verification 람다
// ══════════════════════════════════════════════════════════

describe("create_command_router — /verify 콜백 커버", () => {
  it("/verify → session_recorder.get_last_assistant_content 람다 실행", async () => {
    const deps = make_deps();
    const router = create_command_router(deps);
    const { ctx, replies } = make_ctx("verify");
    await router.try_handle(ctx);
    expect((deps.session_recorder as any).get_last_assistant_content).toHaveBeenCalled();
    expect(replies.length).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════════════════════
// McpHandler — list_servers + reconnect 람다
// ══════════════════════════════════════════════════════════

describe("create_command_router — /mcp 콜백 커버", () => {
  it("/mcp list → list_servers 람다 실행 (비어있지 않은 action으로 guide 스킵)", async () => {
    const deps = make_deps();
    const router = create_command_router(deps);
    // "list"는 "reconnect"가 아닌 action → list_servers 호출
    const { ctx, replies } = make_ctx("mcp", ["list"]);
    await router.try_handle(ctx);
    expect((deps.mcp as any).list_servers).toHaveBeenCalled();
    expect(replies.length).toBeGreaterThan(0);
  });

  it("/mcp reconnect test-mcp → reconnect 람다 실행 (get_server_configs 호출)", async () => {
    const deps = make_deps();
    const router = create_command_router(deps);
    const { ctx } = make_ctx("mcp", ["reconnect", "test-mcp"]);
    await router.try_handle(ctx);
    expect((deps.mcp as any).get_server_configs).toHaveBeenCalled();
    expect((deps.mcp as any).connect_server).toHaveBeenCalled();
  });

  it("/mcp reconnect missing → name 없음 → connect_server 미호출", async () => {
    const deps = make_deps();
    const router = create_command_router(deps);
    const { ctx, replies } = make_ctx("mcp", ["reconnect"]);
    await router.try_handle(ctx);
    expect((deps.mcp as any).connect_server).not.toHaveBeenCalled();
    expect(replies.length).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════════════════════
// GuardHandler + ToneHandler — optional 핸들러 등록
// ══════════════════════════════════════════════════════════

describe("create_command_router — optional 핸들러", () => {
  it("confirmation_guard 있으면 GuardHandler 등록됨", async () => {
    const guard = {
      get_status: vi.fn(() => ({ enabled: true, pending_count: 0 })),
      enable: vi.fn(),
      disable: vi.fn(),
      clear_all: vi.fn(),
    } as any;
    const deps = make_deps({ confirmation_guard: guard });
    const router = create_command_router(deps);
    const { ctx } = make_ctx("guard");
    const handled = await router.try_handle(ctx);
    expect(handled).toBe(true);
    expect(guard.get_status).toHaveBeenCalled();
  });

  it("confirmation_guard 없으면 GuardHandler 없음 (guard 미처리)", async () => {
    const deps = make_deps({ confirmation_guard: undefined });
    const router = create_command_router(deps);
    const { ctx } = make_ctx("guard");
    const handled = await router.try_handle(ctx);
    expect(handled).toBe(false);
  });

  it("tone_store 있으면 ToneHandler 등록됨", async () => {
    const tone_store = {
      get: vi.fn(() => "formal"),
      set: vi.fn(),
      list: vi.fn(() => []),
    } as any;
    const deps = make_deps({ tone_store });
    const router = create_command_router(deps);
    const { ctx, replies } = make_ctx("tone");
    const handled = await router.try_handle(ctx);
    expect(handled).toBe(true);
    expect(replies.length).toBeGreaterThan(0);
  });
});
