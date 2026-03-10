/**
 * run-task-loop.ts — L40: try_native_task_execute
 * backend 존재하지만 native_tool_loop 없음 → null 반환
 */
import { describe, it, expect, vi } from "vitest";
import type { RunnerDeps, RunExecutionArgs } from "@src/orchestration/execution/runner-deps.js";
import { try_native_task_execute } from "@src/orchestration/execution/run-task-loop.js";
import type { OrchestrationRequest } from "@src/orchestration/types.js";
import { StreamBuffer } from "@src/channels/stream-buffer.js";

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
  } as OrchestrationRequest;
}

function make_args(): RunExecutionArgs & { media: string[] } {
  return {
    req: make_request(),
    executor: "chatgpt" as any,
    task_with_media: "test task",
    context_block: "ctx",
    skill_names: [],
    system_base: "system",
    runtime_policy: { max_turns: 5, tools_blocklist: [], tools_allowlist: [] } as any,
    tool_definitions: [],
    tool_ctx: {
      task_id: "task-1", signal: undefined as any,
      channel: "slack", chat_id: "chat1", sender_id: "user1",
    },
    skill_provider_prefs: [],
    request_scope: "scope-1",
    media: [],
  } as any;
}

function make_deps_base(): Partial<RunnerDeps> {
  return {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
    build_overlay: vi.fn(() => ""),
    build_persona_followup: vi.fn(() => ""),
    runtime: { get_tool_executors: vi.fn(() => ({})) } as any,
    tool_deps: {} as any,
    session_cd: { observe: vi.fn() } as any,
    workspace: "/tmp",
  };
}

// ── L40: backend 있지만 native_tool_loop=false → null ─────────────────────────

describe("try_native_task_execute — L40: backend 있지만 native_tool_loop 없음 → null", () => {
  it("resolve_for_mode가 native_tool_loop=false 백엔드 반환 → L40 return null", async () => {
    const deps: Partial<RunnerDeps> = {
      ...make_deps_base(),
      agent_backends: {
        resolve_for_mode: vi.fn(() => ({
          id: "nb",
          native_tool_loop: false,  // L40 조건: !backend?.native_tool_loop → true
          capabilities: {},
        })),
        resolve_backend: vi.fn(() => null),
        run: vi.fn(),
      } as any,
    };

    const result = await try_native_task_execute(
      deps as RunnerDeps,
      make_args(),
      new StreamBuffer(),
      make_args().tool_ctx,
      "task-1",
      "objective",
      "prompt",
    );

    expect(result).toBeNull();
    expect(deps.agent_backends!.run).not.toHaveBeenCalled();
  });

  it("resolve_for_mode=null, resolve_backend도 native_tool_loop 없음 → L40 return null", async () => {
    const deps: Partial<RunnerDeps> = {
      ...make_deps_base(),
      agent_backends: {
        resolve_for_mode: vi.fn(() => null),
        resolve_backend: vi.fn(() => ({ id: "fallback", native_tool_loop: undefined, capabilities: {} })),
        run: vi.fn(),
      } as any,
    };

    const result = await try_native_task_execute(
      deps as RunnerDeps,
      make_args(),
      new StreamBuffer(),
      make_args().tool_ctx,
      "task-1",
      "objective",
      "prompt",
    );

    expect(result).toBeNull();
  });
});
