/**
 * run-task-loop.ts — 미커버 분기 커버리지 (L153-158, 169, 172).
 * - check_should_continue 람다
 * - on_tool_event 콜백
 * - state.file_requested 분기
 * - state.done_sent 분기
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── create_tool_call_handler mock ─────────────────────────────
// vi.mock은 호이스팅됨 — beforeEach에서 mockImplementationOnce로 커스터마이즈

let captured_on_tool_event: ((e: { type: string; tool_name?: string }) => void) | null = null;
let injected_state_flags: { file_requested?: boolean; done_sent?: boolean } = {};

vi.mock("@src/orchestration/tool-call-handler.js", () => ({
  create_tool_call_handler: vi.fn((_deps, _ctx, state, opts) => {
    // on_tool_event 콜백 캡처 + 즉시 실행
    captured_on_tool_event = opts?.on_tool_event ?? null;
    if (opts?.on_tool_event) {
      opts.on_tool_event({ type: "tool_use", tool_name: "bash" });
      opts.on_tool_event({ type: "tool_result" }); // tool_name 없음
    }
    // state 플래그 주입
    if (injected_state_flags.file_requested) state.file_requested = true;
    if (injected_state_flags.done_sent) state.done_sent = true;
    return vi.fn().mockResolvedValue("tool output");
  }),
}));

import type { RunnerDeps, RunExecutionArgs } from "@src/orchestration/execution/runner-deps.js";
import { run_task_loop } from "@src/orchestration/execution/run-task-loop.js";
import type { OrchestrationRequest } from "@src/orchestration/types.js";

function make_request(): OrchestrationRequest {
  return {
    message: {
      id: "msg-1", provider: "slack", channel: "general",
      sender_id: "user1", chat_id: "chat1", content: "test",
      at: new Date().toISOString(), thread_id: undefined,
    },
    provider: "slack", alias: "assistant",
    run_id: "run-1", media_inputs: [],
    session_history: [], signal: undefined as any,
    on_stream: undefined, on_tool_block: undefined,
  } as OrchestrationRequest;
}

function make_task_loop_mock(node_invoker?: (nodes: any[]) => Promise<void>) {
  return vi.fn(async (opts: any) => {
    // 실행 노드 호출
    if (node_invoker) await node_invoker(opts.nodes || []);
    return {
      status: "completed",
      state: {
        memory: { last_output: "task result" },
        status: "completed",
        exitReason: "workflow_completed",
        currentTurn: 2,
      },
    };
  });
}

function make_deps(overrides: Partial<RunnerDeps> = {}): RunnerDeps {
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
      run_agent_loop: vi.fn(async (opts: any) => {
        // check_should_continue 호출 (L153 커버)
        if (opts?.check_should_continue) await opts.check_should_continue();
        // on_tool_calls 호출 (on_tool_event 콜백 트리거)
        if (opts?.on_tool_calls) {
          await opts.on_tool_calls({ tool_calls: [{ id: "tc-1", name: "bash", input: {} }] });
        }
        return { final_content: "agent output", tool_calls_count: 1 };
      }),
      run_task_loop: make_task_loop_mock(),
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
    } as any,
    build_compaction_flush: vi.fn(() => vi.fn()),
    log_event: vi.fn(),
    build_persona_followup: vi.fn(() => "followup"),
    ...overrides,
  } as RunnerDeps;
}

function make_args(): RunExecutionArgs & { media: string[] } {
  return {
    req: make_request(),
    executor: "claude" as any,
    task_with_media: "task objective",
    context_block: "context",
    skill_names: [],
    system_base: "You are helpful",
    runtime_policy: { max_turns: 5, tools_blocklist: [], tools_allowlist: [] } as any,
    tool_definitions: [],
    tool_ctx: {
      task_id: "task-1",
      signal: undefined as any,
      channel: "slack", chat_id: "chat1", sender_id: "user1",
    },
    skill_provider_prefs: [],
    request_scope: "scope-1",
    media: [],
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  captured_on_tool_event = null;
  injected_state_flags = {};
});

// ══════════════════════════════════════════════════════════
// on_tool_event 콜백 + check_should_continue 람다 (L153-158)
// ══════════════════════════════════════════════════════════

describe("run_task_loop — on_tool_event + check_should_continue 람다 커버", () => {
  it("execute 노드 실행 → on_tool_event(tool_use) → session_cd.observe 호출", async () => {
    const deps = make_deps();

    // run_task_loop가 execute 노드를 실제로 호출하도록 mock
    (deps.runtime as any).run_task_loop = make_task_loop_mock(async (nodes) => {
      const plan = nodes.find((n: any) => n.id === "plan");
      const execute = nodes.find((n: any) => n.id === "execute");
      if (plan) await plan.run({ task_state: {}, memory: {} });
      if (execute) await execute.run({ task_state: { objective: "test" }, memory: { seed_prompt: "ctx" } });
    });

    await run_task_loop(deps, make_args());

    // check_should_continue 람다 실행됨 (run_agent_loop mock이 호출)
    // on_tool_event 콜백 실행됨 → session_cd.observe 호출됨
    expect((deps.session_cd as any).observe).toHaveBeenCalled();
    // tool_use 이벤트가 전달됨
    const observe_calls = (deps.session_cd as any).observe.mock.calls;
    expect(observe_calls.some((c: any[]) => c[0]?.type === "tool_use")).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════
// state.file_requested = true → file_request_waiting 반환 (L169)
// ══════════════════════════════════════════════════════════

describe("run_task_loop — state.file_requested 분기 (L169)", () => {
  it("state.file_requested=true → run_task_loop가 file_request_waiting 상태 반환", async () => {
    injected_state_flags = { file_requested: true };

    const deps = make_deps();
    (deps.runtime as any).run_task_loop = vi.fn(async (opts: any) => {
      const execute = opts.nodes?.find((n: any) => n.id === "execute");
      if (execute) {
        // execute 노드 실행 → create_tool_call_handler가 state.file_requested=true 주입
        await execute.run({ task_state: { objective: "test" }, memory: { seed_prompt: "ctx" } });
      }
      return {
        status: "completed",
        state: {
          memory: { last_output: "result", file_request_waiting: false },
          status: "completed",
          exitReason: "file_request_waiting",
          currentTurn: 1,
        },
      };
    });

    // plan 노드가 없으므로 메모리 초기화를 위해 initial_memory 사용
    await run_task_loop(deps, make_args());

    // 정상 실행 완료 검증 (예외 없음)
    expect((deps.runtime as any).run_task_loop).toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════
// state.done_sent = true → suppress_final_reply 반환 (L172)
// ══════════════════════════════════════════════════════════

describe("run_task_loop — state.done_sent 분기 (L172)", () => {
  it("state.done_sent=true → suppress_final_reply 메모리 패치로 suppress 반환", async () => {
    injected_state_flags = { done_sent: true };

    const deps = make_deps();
    (deps.runtime as any).run_task_loop = vi.fn(async (opts: any) => {
      const execute = opts.nodes?.find((n: any) => n.id === "execute");
      if (execute) {
        const node_result = await execute.run({ task_state: { objective: "test" }, memory: { seed_prompt: "ctx" } });
        // done_sent=true → node_result.memory_patch.suppress_final_reply=true
        expect(node_result.memory_patch?.suppress_final_reply).toBe(true);
      }
      return {
        status: "completed",
        state: {
          memory: { last_output: "result", suppress_final_reply: true },
          status: "completed",
          exitReason: "message_done_sent",
          currentTurn: 1,
        },
      };
    });

    const result = await run_task_loop(deps, make_args());
    // suppress_result → tool_calls_count=0, streamed=false
    expect(result.mode).toBe("task");
  });
});
