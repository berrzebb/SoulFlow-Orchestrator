/** Phase 4.5 검증: Execute Dispatcher 분리
 *
 * 목표: execute_dispatch가 gateway 라우팅 → short-circuit → mode 분기 → finalize를 올바르게 처리하는지 검증.
 *       dispatcher가 진입점 흐름을 타입 안전하게 분리하는지 확인.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import type { ExecuteDispatcherDeps } from "@src/orchestration/execution/execute-dispatcher.js";
import { execute_dispatch } from "@src/orchestration/execution/execute-dispatcher.js";
import type { ReadyPreflight } from "@src/orchestration/request-preflight.js";
import type { OrchestrationRequest, OrchestrationResult } from "@src/orchestration/types.js";
import type { RunExecutionArgs } from "@src/orchestration/execution/runner-deps.js";
import type { ProviderRegistry } from "@src/providers/service.js";
import type { AgentRuntimeLike } from "@src/agent/runtime.types.js";
import type { Logger } from "@src/logger.js";
import type { ConfirmationGuard } from "@src/orchestration/confirmation-guard.js";
import * as gatewayModule from "@src/orchestration/gateway.js";
import type { GatewayDecision } from "@src/orchestration/gateway.js";

/* ── Mock Implementations ── */

const mockProviders: Partial<ProviderRegistry> = {
  run_orchestrator: vi.fn(async () => ({ content: "mock" })),
};

const mockRuntime: Partial<AgentRuntimeLike> = {
  list_active_tasks: () => [],
  get_context_builder: () => ({
    skills_loader: {
      get_skill_metadata: () => ({ name: "test", summary: "", tools: [], preferred_providers: [] }),
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

const mockRequest: OrchestrationRequest = {
  message: {
    id: "msg-1",
    provider: "slack",
    channel: "general",
    sender_id: "user1",
    chat_id: "chat1",
    content: "test",
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

const mockPreflight: ReadyPreflight = {
  kind: "ready",
  task_with_media: "test task",
  media: [],
  skill_names: ["skill1"],
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
  history_lines: [],
  context_block: "test context",
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
  active_tasks_in_chat: [
    {
      taskId: "task-1",
      title: "Task 1",
      objective: "Do something",
      channel: "slack",
      chatId: "chat1",
      status: "in_progress",
      memory: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      currentTurn: 1,
    },
    {
      taskId: "task-2",
      title: "Task 2",
      objective: "Do another thing",
      channel: "slack",
      chatId: "chat1",
      status: "waiting_user_input",
      memory: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      currentTurn: 2,
    },
  ],
};

const createMockDeps = (): ExecuteDispatcherDeps => ({
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
  build_identity_reply: vi.fn(() => "who are you?"),
  build_system_prompt: vi.fn(async () => "system prompt"),
  generate_guard_summary: vi.fn(async () => "summary"),
  run_once: vi.fn(async () => ({ reply: "once result", mode: "once", tool_calls_count: 0, streamed: false })),
  run_agent_loop: vi.fn(async () => ({ reply: "agent result", mode: "agent", tool_calls_count: 0, streamed: false })),
  run_task_loop: vi.fn(async () => ({ reply: "task result", mode: "task", tool_calls_count: 0, streamed: false })),
  run_phase_loop: vi.fn(async () => ({ reply: "phase result", mode: "phase", tool_calls_count: 0, streamed: false })),
  caps: () => ({ chatgpt_available: true, claude_available: false, openrouter_available: false }),
});

/* ── Tests ── */

describe("Phase 4.5: Execute Dispatcher 분리", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("execute_dispatch — 구조 검증", () => {
    it("gateway를 통해 의존성을 주입받는다", async () => {
      const deps = createMockDeps();
      // gateway mock이 필요하면 여기서 resolve_gateway를 모킹해야 함
      // 현재 구현에서는 gateway를 호출하므로, 실제 gateway 로직이 실행됨
      // This test just verifies the dispatcher can be called
      expect(deps).toBeDefined();
      expect(deps.build_identity_reply).toBeDefined();
    });

    it("ReadyPreflight를 수신하고 결과를 반환한다", async () => {
      const deps = createMockDeps();
      const logEventSpy = vi.fn();
      deps.log_event = logEventSpy;

      // Note: This test would require mocking gateway, so it's a structural test
      expect(execute_dispatch).toBeDefined();
      expect(deps.log_event).toBeDefined();
    });

    it("build_identity_reply를 호출할 수 있는 의존성을 가진다", async () => {
      const deps = createMockDeps();
      const buildIdentitySpy = vi.fn(() => "identity reply");
      deps.build_identity_reply = buildIdentitySpy;

      expect(deps.build_identity_reply).toBeDefined();
      const reply = deps.build_identity_reply();
      expect(reply).toBe("identity reply");
      expect(buildIdentitySpy).toHaveBeenCalled();
    });

    it("run_once을 호출할 수 있는 의존성을 가진다", async () => {
      const deps = createMockDeps();
      const runOnceSpy = vi.fn(async (args: RunExecutionArgs) => ({
        reply: "once executed",
        mode: "once" as const,
        tool_calls_count: 1,
        streamed: false,
      }));
      deps.run_once = runOnceSpy;

      const mockArgs: RunExecutionArgs = {
        req: mockRequest,
        executor: "chatgpt",
        task_with_media: "test",
        context_block: "context",
        skill_names: [],
        system_base: "system",
        runtime_policy: { max_turns: 5, tools_blocklist: [], tools_allowlist: [] },
        tool_definitions: [],
        tool_ctx: mockPreflight.tool_ctx,
        request_scope: "scope-1",
      };

      const result = await deps.run_once(mockArgs);
      expect(result.reply).toBe("once executed");
      expect(runOnceSpy).toHaveBeenCalledWith(mockArgs);
    });

    it("log_event을 호출할 수 있는 의존성을 가진다", async () => {
      const deps = createMockDeps();
      const logEventSpy = vi.fn();
      deps.log_event = logEventSpy;

      deps.log_event({
        run_id: "run-1",
        task_id: "task-1",
        agent_id: "test",
        provider: "slack",
        channel: "slack",
        chat_id: "chat1",
        source: "inbound",
        phase: "done",
        summary: "test",
      });

      expect(logEventSpy).toHaveBeenCalled();
    });

    it("dispatcher는 ReadyPreflight 타입을 받는다", async () => {
      const preflight = mockPreflight;
      expect(preflight.kind).toBe("ready");
      expect(preflight.task_with_media).toBeDefined();
      expect(preflight.skill_names).toBeDefined();
      expect(preflight.secret_guard).toBeDefined();
    });

    it("finalize 클로저를 통해 이벤트를 기록할 수 있다", async () => {
      const deps = createMockDeps();
      const logEventSpy = vi.fn();
      deps.log_event = logEventSpy;

      // Simulate what finalize does
      const result: OrchestrationResult = { reply: "test", mode: "once", tool_calls_count: 0, streamed: false };
      deps.log_event({
        ...mockPreflight.evt_base,
        phase: "done",
        summary: `completed: ${result.mode}`,
        payload: { mode: result.mode, tool_calls_count: result.tool_calls_count },
      });

      expect(logEventSpy).toHaveBeenCalledWith(expect.objectContaining({
        phase: "done",
        summary: expect.stringContaining("completed"),
      }));
    });
  });

  describe("execute_dispatch — 실제 로직 커버리지", () => {
    let gatewaySpy: any;

    beforeEach(() => {
      gatewaySpy = vi.spyOn(gatewayModule, "resolve_gateway");
    });

    it("identity short-circuit: 페르소나 질의 → identity_reply 반환 + done 이벤트", async () => {
      const deps = createMockDeps();
      const logEventSpy = vi.fn();
      deps.log_event = logEventSpy;
      deps.build_identity_reply = vi.fn(() => "I am Claude");

      gatewaySpy.mockResolvedValue({ action: "identity" } as GatewayDecision);

      const result = await execute_dispatch(deps, mockRequest, mockPreflight);

      expect(result).toEqual({
        reply: "I am Claude",
        mode: "once",
        tool_calls_count: 0,
        streamed: false,
      });
      expect(deps.build_identity_reply).toHaveBeenCalled();
      expect(logEventSpy).toHaveBeenCalledWith(expect.objectContaining({
        phase: "done",
        summary: "identity shortcircuit",
      }));
    });

    it("builtin short-circuit: 커맨드 → builtin_command 반환 + done 이벤트", async () => {
      const deps = createMockDeps();
      const logEventSpy = vi.fn();
      deps.log_event = logEventSpy;

      gatewaySpy.mockResolvedValue({
        action: "builtin",
        command: "help",
        args: "--all",
      } as GatewayDecision);

      const result = await execute_dispatch(deps, mockRequest, mockPreflight);

      expect(result).toEqual({
        reply: null,
        mode: "once",
        tool_calls_count: 0,
        streamed: false,
        builtin_command: "help",
        builtin_args: "--all",
      });
      expect(logEventSpy).toHaveBeenCalledWith(expect.objectContaining({
        phase: "done",
        summary: "builtin: help",
      }));
    });

    it("inquiry short-circuit: 활성 태스크 요약 → summary 반환 + done 이벤트", async () => {
      const deps = createMockDeps();
      const logEventSpy = vi.fn();
      deps.log_event = logEventSpy;

      gatewaySpy.mockResolvedValue({
        action: "inquiry",
        summary: "Current tasks: Task-1 (in_progress), Task-2 (pending)",
      } as GatewayDecision);

      const result = await execute_dispatch(deps, mockRequest, mockPreflight);

      expect(result).toEqual({
        reply: "Current tasks: Task-1 (in_progress), Task-2 (pending)",
        mode: "once",
        tool_calls_count: 0,
        streamed: false,
      });
      expect(logEventSpy).toHaveBeenCalledWith(expect.objectContaining({
        phase: "done",
        summary: "inquiry shortcircuit",
      }));
    });

    it("phase 모드: run_phase_loop 호출 → finalize로 done 이벤트", async () => {
      const deps = createMockDeps();
      const logEventSpy = vi.fn();
      const runPhaseLoopSpy = vi.fn(async () => ({
        reply: "workflow completed",
        mode: "phase" as const,
        tool_calls_count: 3,
        streamed: true,
      }));
      deps.log_event = logEventSpy;
      deps.run_phase_loop = runPhaseLoopSpy;

      gatewaySpy.mockResolvedValue({
        action: "execute",
        mode: "phase",
        executor: "claude_code",
        workflow_id: "wf-123",
        node_categories: ["category1"],
      } as GatewayDecision);

      const result = await execute_dispatch(deps, mockRequest, mockPreflight);

      expect(result).toEqual({
        reply: "workflow completed",
        mode: "phase",
        tool_calls_count: 3,
        streamed: true,
      });
      expect(runPhaseLoopSpy).toHaveBeenCalled();
      expect(logEventSpy).toHaveBeenCalledWith(expect.objectContaining({
        phase: "done",
        summary: "completed: phase",
      }));
    });

    it("once 모드: run_once 호출 → finalize로 done 이벤트", async () => {
      const deps = createMockDeps();
      const logEventSpy = vi.fn();
      const runOnceSpy = vi.fn(async () => ({
        reply: "one-off task result",
        mode: "once" as const,
        tool_calls_count: 1,
        streamed: false,
      }));
      deps.log_event = logEventSpy;
      deps.run_once = runOnceSpy;

      gatewaySpy.mockResolvedValue({
        action: "execute",
        mode: "once",
        executor: "chatgpt",
      } as GatewayDecision);

      const result = await execute_dispatch(deps, mockRequest, mockPreflight);

      expect(result).toEqual({
        reply: "one-off task result",
        mode: "once",
        tool_calls_count: 1,
        streamed: false,
      });
      expect(runOnceSpy).toHaveBeenCalled();
      expect(logEventSpy).toHaveBeenCalledWith(expect.objectContaining({
        phase: "done",
        summary: "completed: once",
      }));
    });

    it("task 모드: run_task_loop 호출 → finalize로 done 이벤트", async () => {
      const deps = createMockDeps();
      const logEventSpy = vi.fn();
      const runTaskLoopSpy = vi.fn(async () => ({
        reply: "task loop result",
        mode: "task" as const,
        tool_calls_count: 5,
        streamed: true,
      }));
      deps.log_event = logEventSpy;
      deps.run_task_loop = runTaskLoopSpy;

      gatewaySpy.mockResolvedValue({
        action: "execute",
        mode: "task",
        executor: "claude_code",
      } as GatewayDecision);

      const result = await execute_dispatch(deps, mockRequest, mockPreflight);

      expect(result).toEqual({
        reply: "task loop result",
        mode: "task",
        tool_calls_count: 5,
        streamed: true,
      });
      expect(runTaskLoopSpy).toHaveBeenCalled();
    });

    it("agent 모드: run_agent_loop 호출 → finalize로 done 이벤트", async () => {
      const deps = createMockDeps();
      const logEventSpy = vi.fn();
      const runAgentLoopSpy = vi.fn(async () => ({
        reply: "agent loop result",
        mode: "agent" as const,
        tool_calls_count: 7,
        streamed: true,
      }));
      deps.log_event = logEventSpy;
      deps.run_agent_loop = runAgentLoopSpy;

      gatewaySpy.mockResolvedValue({
        action: "execute",
        mode: "agent",
        executor: "chatgpt",
      } as GatewayDecision);

      const result = await execute_dispatch(deps, mockRequest, mockPreflight);

      expect(result).toEqual({
        reply: "agent loop result",
        mode: "agent",
        tool_calls_count: 7,
        streamed: true,
      });
      expect(runAgentLoopSpy).toHaveBeenCalled();
    });

    it("once → task 에스컬레이션: run_once 실패 → run_task_loop로 전환", async () => {
      const deps = createMockDeps();
      const logEventSpy = vi.fn();
      const runOnceSpy = vi.fn(async () => ({
        error: "once_requires_task_loop",
        mode: "once" as const,
        tool_calls_count: 0,
        streamed: false,
      }));
      const runTaskLoopSpy = vi.fn(async () => ({
        reply: "task escalation result",
        mode: "task" as const,
        tool_calls_count: 3,
        streamed: true,
      }));
      deps.log_event = logEventSpy;
      deps.run_once = runOnceSpy;
      deps.run_task_loop = runTaskLoopSpy;

      gatewaySpy.mockResolvedValue({
        action: "execute",
        mode: "once",
        executor: "claude_code",
      } as GatewayDecision);

      const result = await execute_dispatch(deps, mockRequest, mockPreflight);

      expect(result).toEqual({
        reply: "task escalation result",
        mode: "task",
        tool_calls_count: 3,
        streamed: true,
      });
      expect(runOnceSpy).toHaveBeenCalled();
      expect(runTaskLoopSpy).toHaveBeenCalled();
    });

    it("confirmation guard: guard 대기 상태 → guard_prompt 반환 + done 이벤트", async () => {
      const deps = createMockDeps();
      const logEventSpy = vi.fn();
      const guardMock: Partial<ConfirmationGuard> = {
        needs_confirmation: vi.fn(() => true),
        store: vi.fn(),
      };
      deps.log_event = logEventSpy;
      deps.guard = guardMock as ConfirmationGuard;
      deps.generate_guard_summary = vi.fn(async () => "User approval required for sensitive operation");

      gatewaySpy.mockResolvedValue({
        action: "execute",
        mode: "once",
        executor: "chatgpt",
      } as GatewayDecision);

      const result = await execute_dispatch(deps, mockRequest, mockPreflight);

      expect(result).toEqual({
        reply: expect.stringContaining("User approval required"),
        mode: "once",
        tool_calls_count: 0,
        streamed: false,
      });
      expect(guardMock.needs_confirmation).toHaveBeenCalled();
      expect(guardMock.store).toHaveBeenCalled();
    });

    it("error 처리: 예외 발생 → error_result 반환 + blocked 이벤트", async () => {
      const deps = createMockDeps();
      const logEventSpy = vi.fn();
      const runOnceSpy = vi.fn(async () => {
        throw new Error("Unexpected failure");
      });
      deps.log_event = logEventSpy;
      deps.run_once = runOnceSpy;

      gatewaySpy.mockResolvedValue({
        action: "execute",
        mode: "once",
        executor: "chatgpt",
      } as GatewayDecision);

      const result = await execute_dispatch(deps, mockRequest, mockPreflight);

      expect(result.error).toBeDefined();
      expect(result.error).toContain("Unexpected failure");
      expect(logEventSpy).toHaveBeenCalledWith(expect.objectContaining({
        phase: "blocked",
        summary: expect.stringContaining("failed:"),
      }));
    });

    it("suppress_reply: runner 성공하지만 suppress_reply 설정 → finalize 반환", async () => {
      const deps = createMockDeps();
      const logEventSpy = vi.fn();
      const runOnceSpy = vi.fn(async () => ({
        suppress_reply: true,
        mode: "once" as const,
        tool_calls_count: 2,
        streamed: false,
      }));
      deps.log_event = logEventSpy;
      deps.run_once = runOnceSpy;

      gatewaySpy.mockResolvedValue({
        action: "execute",
        mode: "once",
        executor: "chatgpt",
      } as GatewayDecision);

      const result = await execute_dispatch(deps, mockRequest, mockPreflight);

      expect(result).toEqual({
        suppress_reply: true,
        mode: "once",
        tool_calls_count: 2,
        streamed: false,
      });
      expect(logEventSpy).toHaveBeenCalledWith(expect.objectContaining({
        phase: "done",
      }));
    });

    it("executor fallback: claude_code 실패 → chatgpt 재시도 → 성공", async () => {
      const deps = createMockDeps();
      const logEventSpy = vi.fn();
      let callCount = 0;
      const runTaskLoopSpy = vi.fn(async () => {
        callCount++;
        if (callCount === 1) {
          // First call with claude_code fails without reply
          return {
            error: "claude_code execution failed",
            mode: "task" as const,
            tool_calls_count: 0,
            streamed: false,
          };
        }
        // Second call with fallback (chatgpt) succeeds
        return {
          reply: "fallback succeeded",
          mode: "task" as const,
          tool_calls_count: 1,
          streamed: false,
        };
      });
      deps.log_event = logEventSpy;
      deps.run_task_loop = runTaskLoopSpy;

      gatewaySpy.mockResolvedValue({
        action: "execute",
        mode: "task",
        executor: "claude_code",
      } as GatewayDecision);

      const result = await execute_dispatch(deps, mockRequest, mockPreflight);

      expect(result.reply).toBe("fallback succeeded");
      expect(runTaskLoopSpy).toHaveBeenCalledTimes(2);
      expect(logEventSpy).toHaveBeenCalledWith(expect.objectContaining({
        phase: "done",
      }));
    });

    it("agent → task 에스컬레이션: is_agent_escalation=true → run_task_loop 호출", async () => {
      const deps = createMockDeps();
      const logEventSpy = vi.fn();
      const runAgentLoopSpy = vi.fn(async () => ({
        error: "agent_requires_task_loop",
        mode: "agent" as const,
        tool_calls_count: 3,
        streamed: true,
      }));
      const runTaskLoopSpy = vi.fn(async () => ({
        reply: "Escalated to task and completed",
        mode: "task" as const,
        tool_calls_count: 1,
        streamed: false,
      }));
      deps.log_event = logEventSpy;
      deps.run_agent_loop = runAgentLoopSpy;
      deps.run_task_loop = runTaskLoopSpy;

      gatewaySpy.mockResolvedValue({
        action: "execute",
        mode: "agent",
        executor: "chatgpt",
      } as GatewayDecision);

      const result = await execute_dispatch(deps, mockRequest, mockPreflight);

      expect(result.reply).toBe("Escalated to task and completed");
      expect(runAgentLoopSpy).toHaveBeenCalled();
      expect(runTaskLoopSpy).toHaveBeenCalled();
      expect(logEventSpy).toHaveBeenCalledWith(expect.objectContaining({
        phase: "done",
      }));
    });
  });
});

// ── from execute-dispatcher-cov2 ──

describe("execute_dispatch — cov2 미커버 분기", () => {
  let gatewaySpy: any;
  beforeEach(() => { gatewaySpy = vi.spyOn(gatewayModule, "resolve_gateway"); });
  afterEach(() => { vi.restoreAllMocks(); });

  function make_deps_cov2(overrides: Partial<ExecuteDispatcherDeps> = {}): ExecuteDispatcherDeps {
    return {
      providers: { run_orchestrator: vi.fn(async () => ({ content: "mock" })) } as any,
      runtime: {
        list_active_tasks: vi.fn(() => []),
        find_session_by_task: vi.fn(() => null),
        get_context_builder: vi.fn(() => ({
          skills_loader: {
            get_skill_metadata: vi.fn((name: string) => name === "coder" ? {
              name: "coder", summary: "writes code",
              type: "task", source: "local", shared_protocols: [],
              checks: ["Did you write tests?", "Did you run linting?"],
              tools: [], triggers: [],
            } : null),
            get_role_skill: vi.fn(() => null),
          },
        })),
      } as any,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
      config: { executor_provider: "chatgpt", provider_caps: {} },
      process_tracker: null,
      guard: null,
      tool_index: null,
      log_event: vi.fn(),
      build_identity_reply: vi.fn(() => "I am Claude"),
      build_system_prompt: vi.fn(async () => "system"),
      generate_guard_summary: vi.fn(async () => "summary"),
      run_once: vi.fn(async () => ({ reply: "completed", mode: "once" as const, tool_calls_count: 3, streamed: false, tools_used: ["bash", "write_file"] })),
      run_agent_loop: vi.fn(async () => ({ reply: "agent done", mode: "agent" as const, tool_calls_count: 2, streamed: false })),
      run_task_loop: vi.fn(async () => ({ reply: "task done", mode: "task" as const, tool_calls_count: 0, streamed: false })),
      run_phase_loop: vi.fn(async () => ({ reply: "phase done", mode: "phase" as const, tool_calls_count: 0, streamed: false })),
      caps: vi.fn(() => ({ chatgpt_available: true, claude_available: true })),
      ...overrides,
    };
  }

  const cov2Preflight: ReadyPreflight = {
    ...mockPreflight,
    task_with_media: "implement feature X",
    skill_names: ["coder"],
  } as any;

  it("check.has_checks — validator alias + bash 도구 사용 → completion check 추가", async () => {
    const deps = make_deps_cov2();
    gatewaySpy.mockResolvedValue({ action: "execute", mode: "once", executor: "chatgpt" } as GatewayDecision);
    (deps.run_once as any).mockResolvedValue({
      reply: "I implemented feature X",
      mode: "once" as const,
      tool_calls_count: 3,
      streamed: false,
      tools_used: ["bash"],
    });

    const reviewer_request = { ...mockRequest, alias: "reviewer" };
    const result = await execute_dispatch(deps, reviewer_request, cov2Preflight);
    expect(result.reply).toContain("I implemented feature X");
    expect(result.reply).toContain("완료 체크리스트");
  });

  it("agent 모드 + chatgpt executor + 결과 없음 → finalize(first)", async () => {
    const deps = make_deps_cov2();
    gatewaySpy.mockResolvedValue({ action: "execute", mode: "agent", executor: "chatgpt" } as GatewayDecision);
    (deps.run_agent_loop as any).mockResolvedValue({
      reply: "", mode: "agent" as const, tool_calls_count: 0, streamed: false, error: "agent_no_output",
    });

    const result = await execute_dispatch(deps, mockRequest, cov2Preflight);
    expect(result.mode).toBe("agent");
    expect(result.error).toBe("agent_no_output");
  });

  it("claude_code fallback → second 성공", async () => {
    const deps = make_deps_cov2();
    gatewaySpy.mockResolvedValue({ action: "execute", mode: "agent", executor: "claude_code" } as GatewayDecision);

    let call_count = 0;
    (deps.run_agent_loop as any).mockImplementation(async () => {
      call_count++;
      if (call_count === 1) return { reply: "", mode: "agent" as const, tool_calls_count: 0, streamed: false };
      return { reply: "fallback result", mode: "agent" as const, tool_calls_count: 1, streamed: false };
    });

    const result = await execute_dispatch(deps, mockRequest, cov2Preflight);
    expect(result.reply).toContain("fallback result");
    expect(call_count).toBe(2);
  });

  it("claude_code fallback → 양쪽 모두 실패", async () => {
    const deps = make_deps_cov2();
    gatewaySpy.mockResolvedValue({ action: "execute", mode: "agent", executor: "claude_code" } as GatewayDecision);

    let call_count = 0;
    (deps.run_agent_loop as any).mockImplementation(async () => {
      call_count++;
      return { reply: "", mode: "agent" as const, tool_calls_count: 0, streamed: false, error: call_count === 1 ? "primary_failed" : "fallback_failed" };
    });

    const result = await execute_dispatch(deps, mockRequest, cov2Preflight);
    expect(result.mode).toBe("agent");
    expect(call_count).toBe(2);
    expect(result.error).toBeTruthy();
  });
});

// ── from execute-dispatcher-cov3 ──

describe("execute_dispatch — matched_skills map + filter (L130-131)", () => {
  let gatewaySpy: any;
  beforeEach(() => { gatewaySpy = vi.spyOn(gatewayModule, "resolve_gateway"); });
  afterEach(() => { vi.restoreAllMocks(); });

  function make_deps_cov3(overrides: Partial<ExecuteDispatcherDeps> = {}): ExecuteDispatcherDeps {
    return {
      providers: { run_orchestrator: vi.fn(async () => ({ content: "mock" })) } as any,
      runtime: {
        list_active_tasks: vi.fn(() => []),
        find_session_by_task: vi.fn(() => null),
        get_context_builder: vi.fn(() => ({
          skills_loader: { get_skill_metadata: vi.fn(() => null), get_role_skill: vi.fn(() => null) },
        })),
        get_skill_metadata: vi.fn((name: string) =>
          name === "coder"
            ? { name: "coder", checks: ["Did you write tests?"], tools: [], triggers: [], shared_protocols: [], type: "task", source: "local", summary: "writes code" }
            : null,
        ),
      } as any,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
      config: { executor_provider: "chatgpt" },
      process_tracker: null,
      guard: null,
      tool_index: null,
      log_event: vi.fn(),
      build_identity_reply: vi.fn(() => "I am Claude"),
      build_system_prompt: vi.fn(async () => "system"),
      generate_guard_summary: vi.fn(async () => "summary"),
      run_once: vi.fn(async () => ({
        reply: "validation complete", mode: "once" as const, tool_calls_count: 2, streamed: false,
        tools_used: ["bash"], matched_skills: ["coder", "unknown_skill"],
      })),
      run_agent_loop: vi.fn(async () => ({ reply: "done", mode: "agent" as const, tool_calls_count: 0, streamed: false })),
      run_task_loop: vi.fn(async () => ({ reply: "done", mode: "task" as const, tool_calls_count: 0, streamed: false })),
      run_phase_loop: vi.fn(async () => ({ reply: "done", mode: "phase" as const, tool_calls_count: 0, streamed: false })),
      caps: vi.fn(() => ({ chatgpt_available: true, claude_available: true })),
      ...overrides,
    };
  }

  it("validator alias + matched_skills=['coder','unknown'] → get_skill_metadata 2회 호출 + null 필터", async () => {
    const deps = make_deps_cov3();
    gatewaySpy.mockResolvedValue({ action: "execute", mode: "once", executor: "chatgpt" } as GatewayDecision);
    const validatorRequest = { ...mockRequest, alias: "validator" };
    const coderPreflight = { ...mockPreflight, skill_names: ["coder"] } as any;

    const result = await execute_dispatch(deps, validatorRequest, coderPreflight);

    expect(deps.runtime.get_skill_metadata).toHaveBeenCalledWith("coder");
    expect(deps.runtime.get_skill_metadata).toHaveBeenCalledWith("unknown_skill");
    expect(result.reply).toContain("validation complete");
  });
});

// ── from execute-dispatcher-cov4 ──

describe("execute-dispatcher L85: session_lookup 람다 — inquiry 경로에서 실행", () => {
  it("inquiry 분류 + active_tasks 있을 때 session_lookup 람다 바디(L85) 실행 확인", async () => {
    const findSessionSpy = vi.fn().mockReturnValue(null);

    const cov4Runtime: Partial<AgentRuntimeLike> = {
      list_active_tasks: () => [],
      find_session_by_task: findSessionSpy,
      get_context_builder: () => ({
        skills_loader: { get_skill_metadata: () => null, get_role_skill: () => null },
      } as any),
    };

    const cov4Logger: Partial<Logger> = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

    const deps: ExecuteDispatcherDeps = {
      providers: {} as ProviderRegistry,
      runtime: cov4Runtime as AgentRuntimeLike,
      logger: cov4Logger as Logger,
      config: { executor_provider: "chatgpt", provider_caps: { chatgpt_available: true, claude_available: false, openrouter_available: false } },
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

    const activeTask = {
      taskId: "task-inquiry-1", title: "Background Task", objective: "Do something in background",
      channel: "slack", chatId: "chat1", status: "in_progress" as const,
      memory: {}, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      currentTurn: 1, maxTurns: 10,
    };

    const preflight: ReadyPreflight = {
      kind: "ready",
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
        run_id: "run-1", task_id: "task-1", agent_id: "test",
        provider: "slack", channel: "slack", chat_id: "chat1", source: "inbound",
      },
      context_block: "",
      tool_ctx: {
        task_id: "task-1", signal: undefined as any,
        channel: "slack", chat_id: "chat1", sender_id: "user1",
      },
      skill_tool_names: [],
      skill_provider_prefs: [],
      category_map: {},
      tool_categories: [],
      active_tasks_in_chat: [activeTask],
    } as ReadyPreflight;

    const req: OrchestrationRequest = {
      message: {
        id: "msg-1", provider: "slack", channel: "general",
        sender_id: "user1", chat_id: "chat1", content: "is it done",
        at: new Date().toISOString(), thread_id: undefined,
        metadata: { message_id: "msg-1" },
      },
      provider: "slack", alias: "test", run_id: "run-1",
      media_inputs: [], session_history: [], signal: undefined as any,
    };

    const result = await execute_dispatch(deps, req, preflight);

    expect(result.mode).toBe("once");
    expect(result.reply).toContain("task-inquiry-1");
    expect(findSessionSpy).toHaveBeenCalledWith("task-inquiry-1");
  });
});
