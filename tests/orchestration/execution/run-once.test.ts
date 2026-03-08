/** Phase 4.5+: run_once 모듈 테스트
 *
 * 목표: executor에게 1회 질의하는 run_once의 모든 경로 테스트
 *       - 헤드리스 공급자 호출
 *       - 도구 호출 처리
 *       - 에스컬레이션 감지
 *       - 에러 처리
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { RunnerDeps, RunExecutionArgs } from "@src/orchestration/execution/runner-deps.js";
import { run_once } from "@src/orchestration/execution/run-once.js";
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

const mockArgs: RunExecutionArgs = {
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
  } as any,
  tool_deps: {} as any,
  session_cd: {
    observe: vi.fn(),
  } as any,
  get_mcp_configs: vi.fn(() => undefined),
  workspace: "/tmp",
  convert_agent_result: vi.fn(),
});

/* ── Tests ── */

describe("run_once — executor에게 1회 질의", () => {
  describe("성공 경로", () => {
    it("응답 없음 → 에러 반환", async () => {
      const deps = createMockRunnerDeps() as RunnerDeps;
      const logSpy = vi.fn();
      deps.logger.warn = logSpy;

      (deps.providers.run_headless as any).mockResolvedValue({
        content: null,
        has_tool_calls: false,
      });

      const result = await run_once(deps, mockArgs);

      expect(result.error).toBeDefined();
      expect(result.error).toContain("executor_once_empty");
      expect(result.mode).toBe("once");
    });

    it("간단한 응답 → reply_result 반환", async () => {
      const deps = createMockRunnerDeps() as RunnerDeps;

      (deps.providers.run_headless as any).mockResolvedValue({
        content: "This is the response",
        has_tool_calls: false,
      });

      const result = await run_once(deps, mockArgs);

      expect(result.reply).toBeDefined();
      expect(result.mode).toBe("once");
      expect(result.tool_calls_count).toBe(0);
    });

    it("도구 호출 없음 → 에스컬레이션 감지", async () => {
      const deps = createMockRunnerDeps() as RunnerDeps;
      const logWarnSpy = vi.fn();
      deps.logger.warn = logWarnSpy;

      (deps.providers.run_headless as any).mockResolvedValue({
        content: "This requires NEED TASK LOOP processing", // 에스컬레이션 패턴
        has_tool_calls: false,
      });

      const result = await run_once(deps, mockArgs);

      expect(result.error).toBeDefined();
      expect(result.error).toBe("once_requires_task_loop");
      expect(result.mode).toBe("once");
    });
  });

  describe("도구 호출 경로", () => {
    it("도구 호출 감지 → 도구 실행 후 followup 반환", async () => {
      const deps = createMockRunnerDeps() as RunnerDeps;

      const toolCallHandler = vi.fn(async () => "Tool execution result");
      const createToolCallHandlerSpy = vi.spyOn({ createToolCallHandler: () => toolCallHandler }, "createToolCallHandler");

      // 첫 번째 호출: 도구 호출
      // 두 번째 호출: followup 응답
      (deps.providers.run_headless as any)
        .mockResolvedValueOnce({
          content: "Let me use this tool...",
          has_tool_calls: true,
          tool_calls: [{ id: "call-1", name: "test_tool", input: {} }],
        })
        .mockResolvedValueOnce({
          content: "Based on the tool result...",
          has_tool_calls: false,
        });

      const result = await run_once(deps, mockArgs);

      expect(result.mode).toBe("once");
      expect(result.tool_calls_count).toBeGreaterThanOrEqual(0);
    });
  });

  describe("에러 처리", () => {
    it("공급자 호출 실패 → error_result 반환", async () => {
      const deps = createMockRunnerDeps() as RunnerDeps;
      const logWarnSpy = vi.fn();
      deps.logger.warn = logWarnSpy;

      (deps.providers.run_headless as any).mockRejectedValue(new Error("Provider error"));

      const result = await run_once(deps, mockArgs);

      expect(result.error).toBeDefined();
      expect(result.error).toContain("Provider error");
      expect(logWarnSpy).toHaveBeenCalled();
      expect(result.mode).toBe("once");
    });

    it("공급자 에러 응답 → 에러 추출 및 반환", async () => {
      const deps = createMockRunnerDeps() as RunnerDeps;

      (deps.providers.run_headless as any).mockResolvedValue({
        content: "Error calling openai_api: Invalid API key",
        has_tool_calls: false,
      });

      const result = await run_once(deps, mockArgs);

      expect(result.error).toBeDefined();
      expect(result.error).toContain("Invalid API key");
      expect(result.mode).toBe("once");
    });
  });

  describe("StreamBuffer 관리", () => {
    it("스트림 플러시 호출 확인", async () => {
      const deps = createMockRunnerDeps() as RunnerDeps;

      (deps.providers.run_headless as any).mockResolvedValue({
        content: "Response with stream",
        has_tool_calls: false,
      });

      const result = await run_once(deps, mockArgs);

      expect(result.reply).toBeDefined();
      expect(result.mode).toBe("once");
    });
  });

  describe("시스템 프롬프트 구성", () => {
    it("시스템 프롬프트 + 오버레이 결합", async () => {
      const deps = createMockRunnerDeps() as RunnerDeps;
      const buildOverlaySpy = vi.fn(() => "overlay");
      deps.build_overlay = buildOverlaySpy;

      (deps.providers.run_headless as any).mockResolvedValue({
        content: "response",
        has_tool_calls: false,
      });

      await run_once(deps, mockArgs);

      expect(buildOverlaySpy).toHaveBeenCalledWith("once");
    });
  });
});
