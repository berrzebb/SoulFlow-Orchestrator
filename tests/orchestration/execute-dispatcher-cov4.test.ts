/**
 * execute-dispatcher.ts — 미커버 분기 (cov4):
 * - L85: session_lookup 람다 바디 — inquiry short-circuit 실행 시 호출됨
 *
 * 기존 테스트들은 resolve_gateway를 항상 mock하므로 L85 람다가 실행되지 않음.
 * 이 테스트는 실제 resolve_gateway를 사용하여 inquiry 경로를 타도록 설정.
 */
import { describe, it, expect, vi } from "vitest";
import type { ExecuteDispatcherDeps } from "@src/orchestration/execution/execute-dispatcher.js";
import { execute_dispatch } from "@src/orchestration/execution/execute-dispatcher.js";
import type { ReadyPreflight } from "@src/orchestration/request-preflight.js";
import type { OrchestrationRequest } from "@src/orchestration/types.js";
import type { ProviderRegistry } from "@src/providers/service.js";
import type { AgentRuntimeLike } from "@src/agent/runtime.types.js";
import type { Logger } from "@src/logger.js";

// ── L85: session_lookup 람다 바디 커버 ────────────────────────────────────────

describe("execute-dispatcher L85: session_lookup 람다 — inquiry 경로에서 실행", () => {
  it("inquiry 분류 + active_tasks 있을 때 session_lookup 람다 바디(L85) 실행 확인", async () => {
    // find_session_by_task 스파이 (L85 람다가 호출하는 메서드)
    const findSessionSpy = vi.fn().mockReturnValue(null);

    const mockRuntime: Partial<AgentRuntimeLike> = {
      list_active_tasks: () => [],
      find_session_by_task: findSessionSpy,
      get_context_builder: () => ({
        skills_loader: {
          get_skill_metadata: () => null,
          get_role_skill: () => null,
        },
      } as any),
    };

    const mockLogger: Partial<Logger> = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    const mockProviders: Partial<ProviderRegistry> = {};

    const deps: ExecuteDispatcherDeps = {
      providers: mockProviders as ProviderRegistry,
      runtime: mockRuntime as AgentRuntimeLike,
      logger: mockLogger as Logger,
      config: {
        executor_provider: "chatgpt",
        provider_caps: { chatgpt_available: true, claude_available: false, openrouter_available: false },
      },
      process_tracker: null,
      guard: null,
      tool_index: null,
      log_event: vi.fn(),
      build_identity_reply: () => "I am SoulFlow",
      build_system_prompt: vi.fn().mockResolvedValue("system prompt"),
      generate_guard_summary: vi.fn().mockResolvedValue("summary"),
      run_once: vi.fn().mockResolvedValue({ reply: "done", mode: "once", tool_calls_count: 0, streamed: false }),
      run_agent_loop: vi.fn().mockResolvedValue({ reply: "done", mode: "agent", tool_calls_count: 0, streamed: false }),
      run_task_loop: vi.fn().mockResolvedValue({ reply: "done", mode: "task", tool_calls_count: 0, streamed: false }),
      run_phase_loop: vi.fn().mockResolvedValue({ reply: "done", mode: "phase", tool_calls_count: 0, streamed: false }),
      caps: () => ({ chatgpt_available: true, claude_available: false, openrouter_available: false }),
    };

    // active_tasks_in_chat 비어있지 않음 → inquiry 분류 조건 충족
    const activeTask = {
      taskId: "task-inquiry-1",
      title: "Background Task",
      objective: "Do something in background",
      channel: "slack",
      chatId: "chat1",
      status: "in_progress" as const,
      memory: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      currentTurn: 1,
      maxTurns: 10,
    };

    const preflight: ReadyPreflight = {
      kind: "ready",
      // "is it done" → INQUIRY_TOKEN_SETS에 포함 → is_inquiry_question = true
      // active_tasks 있음 → has_active = true → inquiry 모드 반환
      task_with_media: "is it done",
      media: [],
      skill_names: [],
      secret_guard: { ok: true, missing_keys: [], invalid_ciphertexts: [] },
      runtime_policy: { max_turns: 5, tools_blocklist: [], tools_allowlist: [] },
      all_tool_definitions: [],
      request_scope: "scope-1",
      request_task_id: "task-1",
      run_id: "run-1",
      evt_base: {
        run_id: "run-1",
        task_id: "task-1",
        agent_id: "test",
        provider: "slack",
        channel: "slack",
        chat_id: "chat1",
        source: "inbound",
      },
      context_block: "",
      tool_ctx: {
        task_id: "task-1",
        signal: undefined as any,
        channel: "slack",
        chat_id: "chat1",
        sender_id: "user1",
      },
      skill_tool_names: [],
      skill_provider_prefs: [],
      category_map: {},
      tool_categories: [],
      active_tasks_in_chat: [activeTask],  // ← 비어있지 않아야 inquiry path 진입
    };

    const req: OrchestrationRequest = {
      message: {
        id: "msg-1",
        provider: "slack",
        channel: "general",
        sender_id: "user1",
        chat_id: "chat1",
        content: "is it done",
        at: new Date().toISOString(),
        thread_id: undefined,
        metadata: { message_id: "msg-1" },
      },
      provider: "slack",
      alias: "test",
      run_id: "run-1",
      media_inputs: [],
      session_history: [],
      signal: undefined as any,
    };

    // resolve_gateway는 mock하지 않음 → 실제 실행 → inquiry 분류 → L85 lambda 호출
    const result = await execute_dispatch(deps, req, preflight);

    // inquiry short-circuit: result.mode = "once", reply = summary 문자열
    expect(result.mode).toBe("once");
    expect(result.reply).toContain("task-inquiry-1");

    // L85 람다 바디가 실행됨을 확인
    expect(findSessionSpy).toHaveBeenCalledWith("task-inquiry-1");
  });
});
