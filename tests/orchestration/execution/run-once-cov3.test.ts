/**
 * run-once.ts — L102: tool_state.suppress=true → suppress_result
 *
 * run-once-cov2.test.ts의 suppress 테스트가 실패하는 이유:
 * Object.assign(mock_tool_state_ref, state)는 복사본을 만들어
 * 원본 state 객체를 수정하지 못함. 이 테스트는 captured_state
 * 참조를 유지하여 원본 state.suppress를 직접 수정함.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── captured_state 참조 유지하는 mock ────────────────────────────────────────

const mock_handler_fn = vi.hoisted(() => vi.fn());
let captured_state: { suppress: boolean; tool_count: number } | null = null;

vi.mock("@src/orchestration/tool-call-handler.js", () => ({
  create_tool_call_handler: vi.fn((_deps, _ctx, state) => {
    captured_state = state;  // 원본 state 참조 보존
    return mock_handler_fn;
  }),
}));

import type { RunnerDeps, RunExecutionArgs } from "@src/orchestration/execution/runner-deps.js";
import { run_once } from "@src/orchestration/execution/run-once.js";
import type { OrchestrationRequest } from "@src/orchestration/types.js";

function make_request(): OrchestrationRequest {
  return {
    message: {
      id: "msg-1", provider: "slack", channel: "general",
      sender_id: "user1", chat_id: "chat1", content: "test",
      at: new Date().toISOString(), thread_id: undefined,
    },
    provider: "slack",
    alias: "assistant",
    run_id: "run-1",
    media_inputs: [],
    session_history: [],
    signal: undefined as any,
    on_stream: undefined,
    on_tool_block: undefined,
  } as OrchestrationRequest;
}

function make_deps(): Partial<RunnerDeps> {
  return {
    providers: {
      run_headless: vi.fn().mockResolvedValue({
        content: "thinking",
        has_tool_calls: true,
        tool_calls: [{ id: "tc-1", name: "test_tool", input: {} }],
      }),
    } as any,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
    build_overlay: vi.fn(() => "overlay"),
    build_persona_followup: vi.fn(() => "persona followup"),
    agent_backends: undefined,
    streaming_cfg: { enabled: false } as any,
    runtime: {
      get_tool_executors: vi.fn(() => ({})),
      get_context_builder: vi.fn(() => ({
        skills_loader: { get_role_skill: vi.fn(() => ({ heart: "❤️" })) },
      })),
    } as any,
    tool_deps: {} as any,
    session_cd: { observe: vi.fn() } as any,
    get_mcp_configs: vi.fn(() => undefined),
    workspace: "/tmp",
    convert_agent_result: vi.fn(),
  };
}

function make_args(): RunExecutionArgs {
  return {
    req: make_request(),
    executor: "chatgpt" as any,
    task_with_media: "test task",
    context_block: "test context",
    skill_names: [],
    system_base: "You are a helpful assistant",
    runtime_policy: { max_turns: 5, tools_blocklist: [], tools_allowlist: [] } as any,
    tool_definitions: [],
    tool_ctx: {
      task_id: "task-1",
      signal: undefined as any,
      channel: "slack",
      chat_id: "chat1",
      sender_id: "user1",
    },
    skill_provider_prefs: [],
    request_scope: "scope-1",
  } as RunExecutionArgs;
}

beforeEach(() => {
  vi.clearAllMocks();
  captured_state = null;
  mock_handler_fn.mockResolvedValue("tool output");
});

// ── L102: tool_state.suppress=true → suppress_result ─────────────────────────

describe("run_once — L102: tool_state.suppress=true → suppress_result", () => {
  it("handler 실행 중 captured_state.suppress=true 설정 → L102 suppress_result 반환", async () => {
    mock_handler_fn.mockImplementationOnce(async () => {
      // 원본 state 객체를 직접 수정 → L102 조건 충족
      if (captured_state) captured_state.suppress = true;
      return "tool output";
    });

    const deps = make_deps();
    const args = make_args();
    const result = await run_once(deps as RunnerDeps, args);

    // suppress_result → mode=once, 두 번째 run_headless 호출 없음
    expect(result.mode).toBe("once");
    // suppress 경로에서 두 번째 LLM 호출 없음
    expect((deps.providers!.run_headless as any).mock.calls.length).toBe(1);
  });
});
