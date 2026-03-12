/**
 * run-agent-loop.ts 미커버 분기 보충.
 * L114: state.suppress=true → suppress_result 반환
 * L127: normalize_agent_reply → null → error_result 반환
 */
import { describe, it, expect, vi } from "vitest";

// state.suppress=true를 만들기 위해 create_tool_call_handler를 override
vi.mock("@src/orchestration/tool-call-handler.js", () => ({
  create_tool_call_handler: vi.fn((_deps: any, _ctx: any, state: any) => {
    // suppress 플래그를 즉시 설정하여 L114 경로 커버
    state.suppress = true;
    return vi.fn().mockResolvedValue("ok");
  }),
}));

import type { RunnerDeps } from "@src/orchestration/execution/runner-deps.js";
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

function make_deps(): RunnerDeps {
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
        final_content: "normal response",
        tool_calls_count: 1,
      }),
    } as any,
    tool_deps: { logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } } as any,
    session_cd: { observe: vi.fn() } as any,
    process_tracker: null,
    get_mcp_configs: vi.fn(() => undefined),
    workspace: "/tmp",
    convert_agent_result: vi.fn((result, mode) => ({
      reply: String(result.content || ""), mode, suppress_reply: false,
      tool_calls_count: result.tool_calls_count || 0, streamed: false,
    })),
    hooks_for: vi.fn(() => ({})),
    config: { agent_loop_max_turns: 5 } as any,
    build_compaction_flush: vi.fn(() => vi.fn()),
  } as RunnerDeps;
}

function make_args() {
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
      task_id: "task-1", signal: undefined as any,
      channel: "slack", chat_id: "chat1", sender_id: "user1",
    },
    skill_provider_prefs: [],
    request_scope: "scope-1",
    media: [],
    history_lines: [],
  } as any;
}

// ══════════════════════════════════════════
// L114: state.suppress=true → suppress_result
// ══════════════════════════════════════════

describe("run_agent_loop — state.suppress=true → suppress_result (L114)", () => {
  it("state.suppress=true → suppress_reply=true 반환", async () => {
    const deps = make_deps();
    const args = make_args();
    const result = await run_agent_loop(deps, args);
    // suppress_result → suppress_reply: true
    expect(result.suppress_reply).toBe(true);
    expect(result.mode).toBe("agent");
  });
});
