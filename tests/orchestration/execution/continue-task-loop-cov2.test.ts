/**
 * continue-task-loop.ts — 미커버 분기 커버리지 (L120-123, 136).
 * - check_should_continue 람다
 * - on_tool_event 콜백
 * - state.done_sent 분기
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── create_tool_call_handler mock ─────────────────────────────

let injected_state_flags: { done_sent?: boolean } = {};

vi.mock("@src/orchestration/tool-call-handler.js", () => ({
  create_tool_call_handler: vi.fn((_deps, _ctx, state, opts) => {
    // on_tool_event 콜백 즉시 실행 (L123 커버)
    if (opts?.on_tool_event) {
      opts.on_tool_event({ type: "tool_use", tool_name: "read_file" });
    }
    // state 플래그 주입
    if (injected_state_flags.done_sent) state.done_sent = true;
    return vi.fn().mockResolvedValue("tool output");
  }),
}));

import type { ContinueTaskDeps } from "@src/orchestration/execution/continue-task-loop.js";
import { continue_task_loop } from "@src/orchestration/execution/continue-task-loop.js";
import type { OrchestrationRequest } from "@src/orchestration/types.js";

function make_request(): OrchestrationRequest {
  return {
    message: {
      id: "msg-1", provider: "slack", channel: "general",
      sender_id: "user1", chat_id: "chat1", content: "continue",
      at: new Date().toISOString(), thread_id: undefined,
    },
    provider: "slack", alias: "assistant",
    run_id: "run-1", media_inputs: [],
    session_history: [], signal: undefined as any,
    on_stream: undefined, on_tool_block: undefined,
  } as OrchestrationRequest;
}

function make_task(): import("@src/contracts.js").TaskState {
  return {
    taskId: "task-1",
    title: "Test Task",
    objective: "do something",
    status: "running",
    channel: "slack",
    chatId: "chat1",
    currentStep: "execute",
    currentTurn: 1,
    maxTurns: 10,
    memory: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as any;
}

function make_deps(overrides: Partial<ContinueTaskDeps> = {}): ContinueTaskDeps {
  return {
    providers: { run_headless: vi.fn() } as any,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
    build_overlay: vi.fn(() => "overlay"),
    agent_backends: undefined,
    streaming_cfg: { enabled: false } as any,
    runtime: {
      get_tool_executors: vi.fn(() => ({})),
      get_context_builder: vi.fn(() => ({
        skills_loader: { get_role_skill: vi.fn(() => ({ heart: "" })) },
      })),
      recommend_skills: vi.fn(() => []),
      run_agent_loop: vi.fn(async (opts: any) => {
        // check_should_continue 호출 (L120 커버)
        if (opts?.check_should_continue) await opts.check_should_continue();
        // on_tool_calls → on_tool_event 트리거
        if (opts?.on_tool_calls) {
          await opts.on_tool_calls({ tool_calls: [{ id: "tc-1", name: "read_file", input: {} }] });
        }
        return { final_content: "resumed output", tool_calls_count: 1 };
      }),
      run_task_loop: vi.fn(async (opts: any) => {
        // execute 노드 호출
        const execute = opts.nodes?.find((n: any) => n.id === "execute");
        if (execute) {
          await execute.run({ task_state: { objective: "test" }, memory: { seed_prompt: "ctx" } });
        }
        return {
          status: "completed",
          state: {
            memory: { last_output: "resumed result" },
            status: "completed",
            exitReason: "workflow_completed",
            currentTurn: 2,
          },
        };
      }),
      get_always_skills: vi.fn(() => []),
      get_tool_definitions: vi.fn(() => []),
    } as any,
    tool_deps: { logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } } as any,
    session_cd: { observe: vi.fn() } as any,
    process_tracker: null,
    get_mcp_configs: vi.fn(() => undefined),
    workspace: "/tmp",
    convert_agent_result: vi.fn(),
    hooks_for: vi.fn(() => ({})),
    config: {
      agent_loop_max_turns: 5,
      task_loop_max_turns: 10,
      executor_provider: "claude",
    } as any,
    build_compaction_flush: vi.fn(() => vi.fn()),
    log_event: vi.fn(),
    policy_resolver: { resolve: vi.fn(() => ({ max_turns: 5, tools_blocklist: [], tools_allowlist: [] })) } as any,
    caps: vi.fn(() => ({})) as any,
    build_system_prompt: vi.fn(async () => "system prompt"),
    collect_skill_provider_preferences: vi.fn(() => []),
    ...overrides,
  } as ContinueTaskDeps;
}

beforeEach(() => {
  vi.clearAllMocks();
  injected_state_flags = {};
});

// ══════════════════════════════════════════════════════════
// on_tool_event 콜백 + check_should_continue 람다 (L120-123)
// ══════════════════════════════════════════════════════════

describe("continue_task_loop — on_tool_event + check_should_continue (L120-123)", () => {
  it("execute 노드 → on_tool_event 콜백 실행 → session_cd.observe 호출", async () => {
    const deps = make_deps();
    await continue_task_loop(deps, make_request(), make_task(), "task text", []);
    expect((deps.session_cd as any).observe).toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════
// state.done_sent = true → suppress_final_reply 반환 (L136)
// ══════════════════════════════════════════════════════════

describe("continue_task_loop — state.done_sent 분기 (L136)", () => {
  it("state.done_sent=true → execute 노드가 suppress_final_reply=true 패치 반환", async () => {
    injected_state_flags = { done_sent: true };

    const deps = make_deps();
    (deps.runtime as any).run_task_loop = vi.fn(async (opts: any) => {
      const execute = opts.nodes?.find((n: any) => n.id === "execute");
      if (execute) {
        const result = await execute.run({ task_state: { objective: "test" }, memory: {} });
        // done_sent=true → suppress_final_reply=true
        expect(result.memory_patch?.suppress_final_reply).toBe(true);
        expect(result.exit_reason).toBe("message_done_sent");
      }
      return {
        status: "completed",
        state: {
          memory: { last_output: "output", suppress_final_reply: true },
          status: "completed",
          exitReason: "message_done_sent",
          currentTurn: 1,
        },
      };
    });

    const result = await continue_task_loop(deps, make_request(), make_task(), "task text", []);
    expect(result.mode).toBe("task");
  });
});
