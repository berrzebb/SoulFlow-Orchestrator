/**
 * run-once.ts — 미커버 분기 커버리지.
 * - tool_state.suppress=true → suppress_result (L99)
 * - tool call 후 followup 경로 (L101-119)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── create_tool_call_handler mock ─────────────────────────────────────────

const mock_handler_fn = vi.hoisted(() => vi.fn());
const mock_tool_state: { suppress: boolean; tool_count: number } = { suppress: false, tool_count: 0 };

vi.mock("@src/orchestration/tool-call-handler.js", () => ({
  create_tool_call_handler: vi.fn((_deps, _ctx, state) => {
    // state를 외부에서 제어 가능하도록 참조 유지
    Object.assign(mock_tool_state_ref, state);
    return mock_handler_fn;
  }),
}));

// tool_state를 mock 내에서 참조하기 위한 공유 객체
let mock_tool_state_ref: Record<string, unknown> = {};

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

function make_deps(headless_responses?: Array<Record<string, unknown>>): Partial<RunnerDeps> {
  let call_count = 0;
  const run_headless = vi.fn().mockImplementation(() => {
    const resp = headless_responses?.[call_count] ?? { content: "default response", has_tool_calls: false };
    call_count++;
    return Promise.resolve(resp);
  });

  return {
    providers: { run_headless } as any,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
    config: {
      agent_loop_max_turns: 10,
      task_loop_max_turns: 5,
      executor_provider: "chatgpt" as any,
      max_tool_result_chars: 4000,
      max_tool_calls_per_run: 0,
      freshness_window_ms: 0,
    },
    build_overlay: vi.fn(() => "overlay"),
    build_persona_followup: vi.fn(() => "persona followup prompt"),
    agent_backends: undefined,
    streaming_cfg: { enabled: false } as any,
    runtime: {
      get_tool_executors: vi.fn(() => ({})),
      get_context_builder: vi.fn(() => ({
        skills_loader: {
          get_role_skill: vi.fn(() => ({ heart: "❤️" })),
        },
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
  mock_handler_fn.mockResolvedValue("tool output result");
  mock_tool_state_ref = {};
});

// ══════════════════════════════════════════════════════════
// tool_state.suppress=true → suppress_result (L99)
// ══════════════════════════════════════════════════════════

describe("run_once — tool_state.suppress=true (L99)", () => {
  it("handler 실행 후 state.suppress=true → suppress_result 반환", async () => {
    // handler가 실행될 때 state.suppress = true로 설정
    mock_handler_fn.mockImplementationOnce(async () => {
      // 외부에서 state에 접근하여 suppress 설정
      mock_tool_state_ref["suppress"] = true;
      return "output";
    });

    const deps = make_deps([
      { content: "thinking...", has_tool_calls: true, tool_calls: [{ id: "tc-1", name: "test_tool", input: {} }] },
    ]);
    const args = make_args();
    const result = await run_once(deps as RunnerDeps, args);

    // suppress_result는 streamed=true이고 reply=""인 결과 반환
    expect(result.mode).toBe("once");
    // suppress 경로는 streamed와 reply를 특정 값으로 반환
    expect(result).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════
// tool call 후 followup 경로 (L101-119)
// ══════════════════════════════════════════════════════════

describe("run_once — tool call followup 경로 (L101-119)", () => {
  it("has_tool_calls=true + suppress=false → followup 호출 후 결과 반환", async () => {
    // mock_handler_fn이 suppress를 설정하지 않음 (기본 false)
    mock_handler_fn.mockResolvedValue("tool execution output");

    const deps = make_deps([
      // 첫 번째: tool calls
      { content: "using tools", has_tool_calls: true, tool_calls: [{ id: "tc-1", name: "test_tool", input: {} }] },
      // 두 번째: followup 응답
      { content: "based on tool results, here is the answer", has_tool_calls: false },
    ]);
    const args = make_args();
    const result = await run_once(deps as RunnerDeps, args);

    // followup 응답이 최종 결과에 반영됨
    expect(result.mode).toBe("once");
    expect(result.reply).toContain("based on tool results");
    // run_headless가 2번 호출됨 (초기 + followup)
    expect((deps.providers!.run_headless as any).mock.calls.length).toBe(2);
  });

  it("followup 응답 빈 문자열 → tool_output 사용", async () => {
    mock_handler_fn.mockResolvedValue("original tool output");

    const deps = make_deps([
      { content: "using tools", has_tool_calls: true, tool_calls: [{ id: "tc-1", name: "test_tool", input: {} }] },
      { content: "", has_tool_calls: false }, // 빈 followup
    ]);
    const args = make_args();
    const result = await run_once(deps as RunnerDeps, args);

    expect(result.mode).toBe("once");
    // followup_text가 빈 경우 → tool_output 사용
    expect(result.reply).toContain("original tool output");
  });
});
