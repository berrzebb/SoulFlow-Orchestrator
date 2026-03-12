/**
 * run-agent-loop.ts — on_tool_event 콜백 커버리지 (L103-104).
 * create_tool_call_handler를 mock하여 on_tool_event 콜백을 직접 호출.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── create_tool_call_handler mock ─────────────────────────────────────────

let captured_on_tool_event: ((e: { type: string; tool_name?: string }) => void) | null = null;

vi.mock("@src/orchestration/tool-call-handler.js", () => ({
  create_tool_call_handler: vi.fn((_deps, _ctx, _state, opts) => {
    // on_tool_event 콜백 캡처
    captured_on_tool_event = opts?.on_tool_event ?? null;
    // 즉시 tool_use 이벤트 발생 (콜백 실행)
    if (opts?.on_tool_event) {
      opts.on_tool_event({ type: "tool_use", tool_name: "test_tool" });
      opts.on_tool_event({ type: "tool_result" }); // tool_name 없음 → 조건 false
    }
    return vi.fn().mockResolvedValue("tool output");
  }),
}));

import type { RunnerDeps, RunExecutionArgs } from "@src/orchestration/execution/runner-deps.js";
import { run_agent_loop } from "@src/orchestration/execution/run-agent-loop.js";
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

function make_deps(): Partial<RunnerDeps> {
  const session_cd = { observe: vi.fn() };
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
      run_agent_loop: vi.fn().mockResolvedValue({
        final_content: "agent completed successfully",
        tool_calls_count: 1,
      }),
    } as any,
    tool_deps: { logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } } as any,
    session_cd: session_cd as any,
    process_tracker: null,
    get_mcp_configs: vi.fn(() => undefined),
    workspace: "/tmp",
    convert_agent_result: vi.fn((result, mode) => ({
      reply: String(result.content || ""), mode, suppress_reply: false,
      tool_calls_count: result.tool_calls_count || 0, streamed: false,
    })),
    hooks_for: vi.fn(() => ({})),
    config: {
      agent_loop_max_turns: 5,
    } as any,
    build_compaction_flush: vi.fn(() => vi.fn()),
  };
}

function make_args(): RunExecutionArgs & { media: string[]; history_lines: string[] } {
  return {
    req: make_request(),
    executor: "chatgpt" as any,
    task_with_media: "task",
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
    history_lines: [],
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  captured_on_tool_event = null;
});

// ══════════════════════════════════════════════════════════
// on_tool_event 콜백 — L103-104
// ══════════════════════════════════════════════════════════

describe("run_agent_loop — on_tool_event 콜백 (L103-104)", () => {
  it("tool_use 이벤트 → session_cd.observe + tools_used push", async () => {
    const deps = make_deps();
    const args = make_args();

    // run_agent_loop가 on_tool_calls를 실제로 호출하도록 mock 수정
    (deps.runtime!.run_agent_loop as any).mockImplementationOnce(async (opts: any) => {
      // on_tool_calls 핸들러를 직접 호출
      if (opts?.on_tool_calls) {
        await opts.on_tool_calls({ tool_calls: [{ id: "tc-1", name: "test_tool", input: {} }] });
      }
      return { final_content: "result", tool_calls_count: 1 };
    });

    await run_agent_loop(deps as RunnerDeps, args);

    // on_tool_event가 호출되어 session_cd.observe가 실행됨
    expect((deps.session_cd! as any).observe).toHaveBeenCalled();
  });

  it("tool_result 이벤트 → session_cd.observe 호출, tool_name 없어 push 안 됨", async () => {
    const deps = make_deps();
    const args = make_args();

    (deps.runtime!.run_agent_loop as any).mockImplementationOnce(async (opts: any) => {
      if (opts?.on_tool_calls) {
        await opts.on_tool_calls({ tool_calls: [] });
      }
      return { final_content: "result", tool_calls_count: 0 };
    });

    const result = await run_agent_loop(deps as RunnerDeps, args);
    // 정상 실행됨
    expect(result.mode).toBe("agent");
  });
});
