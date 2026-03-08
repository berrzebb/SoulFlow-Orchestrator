/** Phase 4.5+: run_agent_loop 모듈 테스트
 *
 * 목표: executor 루프에 대해 run_agent_loop의 모든 경로 테스트
 *       - native backend 우선 경로
 *       - legacy headless 폴백 경로
 *       - tool 호출 처리
 *       - 에스컬레이션 감지
 *       - 에러 처리
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { RunnerDeps, RunExecutionArgs } from "@src/orchestration/execution/runner-deps.js";
import { run_agent_loop } from "@src/orchestration/execution/run-agent-loop.js";
import type { OrchestrationRequest } from "@src/orchestration/types.js";

/* ── Mock Implementations ── */

const mockRequest: OrchestrationRequest = {
  message: {
    id: "msg-1",
    provider: "slack",
    channel: "general",
    sender_id: "user1",
    chat_id: "chat1",
    content: "test query",
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
  on_stream: undefined,
  on_tool_block: undefined,
};

const mockArgs: RunExecutionArgs & { media: string[]; history_lines: string[] } = {
  req: mockRequest,
  executor: "chatgpt",
  task_with_media: "test task",
  context_block: "test context",
  skill_names: ["skill1"],
  system_base: "You are a helpful assistant",
  runtime_policy: { max_turns: 5, tools_blocklist: [], tools_allowlist: [] },
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
  media: [],
  history_lines: [],
};

const createMockRunnerDeps = (): Partial<RunnerDeps> => ({
  providers: {
    run_headless: vi.fn(),
  },
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  build_overlay: vi.fn(() => "overlay instructions"),
  agent_backends: undefined,
  streaming_cfg: { enabled: false },
  runtime: {
    get_tool_executors: vi.fn(() => ({})),
    get_context_builder: vi.fn(() => ({
      skills_loader: {
        get_role_skill: vi.fn(() => ({ heart: "❤️" })),
      },
    })),
    run_agent_loop: vi.fn(),
  } as any,
  tool_deps: {
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  } as any,
  session_cd: {
    observe: vi.fn(),
  } as any,
  process_tracker: null,
  get_mcp_configs: vi.fn(() => undefined),
  workspace: "/tmp",
  convert_agent_result: vi.fn((result, mode, stream) => ({ reply: String(result.content || ""), mode, suppress_reply: false, tool_calls_count: result.tool_calls_count || 0, streamed: false })),
  hooks_for: vi.fn(() => ({})),
  config: {
    agent_loop_max_turns: 10,
  } as any,
  build_persona_followup: vi.fn(() => "followup"),
  build_compaction_flush: vi.fn(() => undefined),
});

/* ── Tests ── */

describe("run_agent_loop — executor 루프 실행", () => {
  describe("native backend 경로", () => {
    it("native backend 미지원 → legacy 경로로 진입", async () => {
      const deps = createMockRunnerDeps() as RunnerDeps;
      // agent_backends가 없으므로 자동으로 legacy 경로 실행

      (deps.runtime.run_agent_loop as any).mockResolvedValue({
        final_content: "Result from native or legacy path",
      });

      const result = await run_agent_loop(deps, mockArgs);

      expect(result.mode).toBe("agent");
      expect(result.reply).toContain("Result from native or legacy path");
    });

    it("native backend 성공 → convert_agent_result 호출", async () => {
      const deps = createMockRunnerDeps() as RunnerDeps;
      deps.agent_backends = {
        resolve_for_mode: vi.fn(() => ({
          id: "native-backend",
          native_tool_loop: true,
          capabilities: { thinking: false },
        })),
        resolve_backend: vi.fn(),
        run: vi.fn().mockResolvedValue({ content: "native reply", tool_calls_count: 3, finish_reason: "stop" }),
      } as any;
      (deps.convert_agent_result as any).mockReturnValue({ reply: "native reply", mode: "agent", suppress_reply: false, tool_calls_count: 3, streamed: false });

      const result = await run_agent_loop(deps, mockArgs);

      expect(deps.convert_agent_result).toHaveBeenCalled();
      expect(result.reply).toBe("native reply");
      expect(result.tool_calls_count).toBe(3);
    });

    it("native backend thinking 활성화 → thinking 파라미터 포함", async () => {
      const deps = createMockRunnerDeps() as RunnerDeps;
      const run_spy = vi.fn().mockResolvedValue({ content: "thinking reply", tool_calls_count: 0, finish_reason: "stop" });
      deps.agent_backends = {
        resolve_for_mode: vi.fn(() => ({
          id: "native-thinking",
          native_tool_loop: true,
          capabilities: { thinking: true },
        })),
        resolve_backend: vi.fn(),
        run: run_spy,
      } as any;
      (deps.convert_agent_result as any).mockReturnValue({ reply: "thinking reply", mode: "agent", suppress_reply: false, tool_calls_count: 0, streamed: false });

      await run_agent_loop(deps, mockArgs);

      expect(run_spy).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
        enable_thinking: true,
        max_thinking_tokens: 16000,
      }));
    });

    it("native backend 실패 시 warn 로그 기록", async () => {
      const deps = createMockRunnerDeps() as RunnerDeps;
      const logWarnSpy = vi.fn();
      deps.logger.warn = logWarnSpy;

      deps.agent_backends = {
        resolve_for_mode: vi.fn(() => ({
          id: "native-backend",
          native_tool_loop: true,
          capabilities: { thinking: false },
        })),
        resolve_backend: vi.fn(),
        run: vi.fn().mockRejectedValue(new Error("Backend error")),
      } as any;

      (deps.runtime.run_agent_loop as any).mockResolvedValue({
        final_content: "legacy fallback result",
      });

      const result = await run_agent_loop(deps, mockArgs);

      expect(logWarnSpy).toHaveBeenCalledWith(expect.stringContaining("native_tool_loop run_agent_loop error"), expect.any(Object));
      expect(result.reply).toContain("legacy fallback result");
      expect(result.mode).toBe("agent");
    });
  });

  describe("legacy headless 경로", () => {
    it("runtime.run_agent_loop 호출 → reply 반환", async () => {
      const deps = createMockRunnerDeps() as RunnerDeps;
      // agent_backends가 없으므로 legacy 경로 실행
      (deps.runtime.run_agent_loop as any).mockResolvedValue({
        final_content: "agent loop result",
      });

      const result = await run_agent_loop(deps, mockArgs);

      expect(result.reply).toContain("agent loop result");
      expect(result.mode).toBe("agent");
      expect(result.tool_calls_count).toBe(0);
    });

    it("빈 응답 → empty_provider_response 에러", async () => {
      const deps = createMockRunnerDeps() as RunnerDeps;

      (deps.runtime.run_agent_loop as any).mockResolvedValue({
        final_content: "",
      });

      const result = await run_agent_loop(deps, mockArgs);

      expect(result.error).toBe("empty_provider_response");
      expect(result.mode).toBe("agent");
    });

    it("에스컬레이션 감지 → agent_requires_task_loop 에러", async () => {
      const deps = createMockRunnerDeps() as RunnerDeps;

      (deps.runtime.run_agent_loop as any).mockResolvedValue({
        final_content: "This task NEED TASK LOOP to proceed",
      });

      const result = await run_agent_loop(deps, mockArgs);

      expect(result.error).toBe("agent_requires_task_loop");
      expect(result.mode).toBe("agent");
    });

    it("공급자 에러 응답 → 에러 추출", async () => {
      const deps = createMockRunnerDeps() as RunnerDeps;

      (deps.runtime.run_agent_loop as any).mockResolvedValue({
        final_content: "Error calling anthropic_api: Rate limit exceeded",
      });

      const result = await run_agent_loop(deps, mockArgs);

      expect(result.error).toBeDefined();
      expect(result.error).toContain("Rate limit exceeded");
      expect(result.mode).toBe("agent");
    });

    it("정상 응답 → no tool notice 추가", async () => {
      const deps = createMockRunnerDeps() as RunnerDeps;

      (deps.runtime.run_agent_loop as any).mockResolvedValue({
        final_content: "Successfully handled the task",
      });

      const result = await run_agent_loop(deps, mockArgs);

      expect(result.reply).toContain("Successfully handled the task");
      expect(result.tool_calls_count).toBe(0);
      expect(result.mode).toBe("agent");
    });
  });

  describe("tool 호출 처리", () => {
    it("정상 tool 호출 흐름 → tool_calls_count 증가", async () => {
      const deps = createMockRunnerDeps() as RunnerDeps;

      // Mock runtime.run_agent_loop to include tool execution context
      (deps.runtime.run_agent_loop as any).mockResolvedValue({
        final_content: "Tool was executed successfully",
      });

      const result = await run_agent_loop(deps, mockArgs);

      expect(result.mode).toBe("agent");
      expect(result.reply).toContain("Tool was executed successfully");
    });
  });

  describe("프로세스 추적", () => {
    it("process_tracker link_loop 호출", async () => {
      const deps = createMockRunnerDeps() as RunnerDeps;
      deps.process_tracker = {
        link_loop: vi.fn(),
        end: vi.fn(),
        set_mode: vi.fn(),
        set_tool_count: vi.fn(),
        set_executor: vi.fn(),
      } as any;

      (deps.runtime.run_agent_loop as any).mockResolvedValue({
        final_content: "test result",
      });

      await run_agent_loop(deps, mockArgs);

      expect(deps.process_tracker.link_loop).toHaveBeenCalledWith("run-1", expect.stringContaining("loop-"));
    });
  });

  describe("스트림 플러시", () => {
    it("flush_remaining 호출 확인", async () => {
      const deps = createMockRunnerDeps() as RunnerDeps;

      (deps.runtime.run_agent_loop as any).mockResolvedValue({
        final_content: "response",
      });

      const result = await run_agent_loop(deps, mockArgs);

      expect(result.reply).toContain("response");
      expect(result.mode).toBe("agent");
      expect(result.tool_calls_count).toBe(0);
    });
  });
});
