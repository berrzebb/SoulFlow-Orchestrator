import { describe, it, expect, vi } from "vitest";
import { create_command_router, type CommandRouterDeps } from "@src/channels/create-command-router.ts";
import { CommandRouter } from "@src/channels/commands/router.ts";
import type { CommandContext } from "@src/channels/commands/types.ts";
import type { InboundMessage } from "@src/bus/types.ts";

function make_mock_deps(): CommandRouterDeps {
  return {
    cancel_active_runs: vi.fn(() => 0),
    render_profile: {
      get: vi.fn(async () => ({})),
      set: vi.fn(async () => {}),
      reset: vi.fn(async () => {}),
    },
    agent: {
      context: {
        memory_store: { read_longterm: vi.fn(), write_longterm: vi.fn(), list_daily: vi.fn(), read_daily: vi.fn(), write_daily: vi.fn() },
        promise_service: { list: vi.fn(async () => []), add: vi.fn(async () => ({ ok: true })), remove: vi.fn(async () => ({ ok: true })) },
        skills_loader: {
          list_skills: vi.fn(() => []),
          get_skill_metadata: vi.fn(() => null),
          refresh: vi.fn(),
          suggest_skills_for_text: vi.fn(() => []),
          list_role_skills: vi.fn(() => []),
        },
      },
      tools: {
        tool_names: vi.fn(() => ["bash", "read_file"]),
        get_definitions: vi.fn(() => []),
      },
      tool_reloader: { reload_now: vi.fn() },
      subagents: {
        list: vi.fn(() => []),
        list_running: vi.fn(() => []),
        get: vi.fn(() => null),
        cancel: vi.fn(() => false),
        send_input: vi.fn(async () => false),
        get_running_count: vi.fn(() => 0),
      },
    } as any,
    agent_runtime: {
      find_waiting_task: vi.fn(() => null),
      get_task: vi.fn(() => null),
      cancel_task: vi.fn(() => false),
      list_active_tasks: vi.fn(() => []),
      list_active_loops: vi.fn(() => []),
      stop_loop: vi.fn(() => false),
      spawn_and_wait: vi.fn(async () => ({ ok: true, output: "" })),
    } as any,
    process_tracker: {
      list_active: vi.fn(() => []),
      list_recent: vi.fn(() => []),
      get: vi.fn(() => null),
      cancel: vi.fn(() => false),
    } as any,
    orchestration: {
      get_cd_score: vi.fn(() => 0),
      reset_cd_score: vi.fn(),
    } as any,
    providers: {
      get_secret_vault: vi.fn(() => ({
        list: vi.fn(async () => []),
        get: vi.fn(async () => null),
        set: vi.fn(async () => {}),
        remove: vi.fn(async () => false),
      })),
      get_health_scorer: vi.fn(() => ({
        rank: vi.fn(() => []),
        get_metrics: vi.fn(() => ({ success_count: 0, failure_count: 0, total_latency_ms: 0 })),
      })),
    } as any,
    agent_backend_registry: {
      list_backends: vi.fn(() => []),
    } as any,
    mcp: {
      list_servers: vi.fn(() => []),
    } as any,
    session_recorder: {
      get_last_assistant_content: vi.fn(async () => null),
    },
    cron: {
      list_jobs: vi.fn(async () => []),
    } as any,
    decisions: {
      get_service: vi.fn(),
    } as any,
    default_alias: "test-bot",
  };
}

function make_message(content: string): InboundMessage {
  return {
    provider: "telegram",
    chat_id: "c1",
    sender_id: "u1",
    message_id: "m1",
    content,
    timestamp: new Date().toISOString(),
  } as InboundMessage;
}

function make_ctx(command_name: string, args: string[] = []): { ctx: CommandContext; replies: string[] } {
  const replies: string[] = [];
  const raw = `/${command_name}${args.length ? " " + args.join(" ") : ""}`;
  return {
    replies,
    ctx: {
      provider: "telegram",
      message: make_message(raw),
      command: { raw, name: command_name, args, args_lower: args.map((a) => a.toLowerCase()) },
      text: raw,
      send_reply: vi.fn(async (text: string) => { replies.push(text); }),
    } as CommandContext,
  };
}

describe("create_command_router", () => {
  it("CommandRouter 인스턴스를 반환한다", () => {
    const router = create_command_router(make_mock_deps());
    expect(router).toBeInstanceOf(CommandRouter);
  });

  it("/help 명령을 라우팅한다", async () => {
    const router = create_command_router(make_mock_deps());
    const { ctx, replies } = make_ctx("help");
    const handled = await router.try_handle(ctx);
    expect(handled).toBe(true);
    expect(replies.length).toBeGreaterThan(0);
  });

  it("/status 명령을 라우팅한다", async () => {
    const router = create_command_router(make_mock_deps());
    const { ctx } = make_ctx("status");
    const handled = await router.try_handle(ctx);
    expect(handled).toBe(true);
  });

  it("알 수 없는 명령도 예외 없이 반환한다", async () => {
    const router = create_command_router(make_mock_deps());
    const { ctx } = make_ctx("xyznotexist");
    const handled = await router.try_handle(ctx);
    expect(typeof handled).toBe("boolean");
  });

  it("/stop 명령이 cancel_active_runs를 호출한다", async () => {
    const deps = make_mock_deps();
    const router = create_command_router(deps);
    const { ctx } = make_ctx("stop");
    await router.try_handle(ctx);
    expect(deps.cancel_active_runs).toHaveBeenCalledWith("telegram:c1");
  });

  it("/doctor 명령이 진단 정보를 반환한다", async () => {
    const router = create_command_router(make_mock_deps());
    const { ctx, replies } = make_ctx("doctor");
    const handled = await router.try_handle(ctx);
    expect(handled).toBe(true);
    expect(replies.length).toBeGreaterThan(0);
  });
});
