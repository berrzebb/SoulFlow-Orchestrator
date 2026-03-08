/** Phase 4.5+: classifier 모듈 테스트
 *
 * 목표: classify_execution_mode 함수와 관련 유틸리티 검증
 *       - 실행 모드 분류 (LLM 위임)
 *       - 에스컬레이션 감지 (need task loop, need agent loop)
 *       - 유틸리티 함수 (is_once_escalation, is_agent_escalation)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  classify_execution_mode,
  is_once_escalation,
  is_agent_escalation,
} from "@src/orchestration/classifier.js";
import type { ClassifierContext } from "@src/orchestration/classifier.js";
import type { Logger } from "@src/logger.js";

/* ── Mock Data ── */

const mockLogger: Partial<Logger> = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const mockProviders = {
  run_orchestrator: vi.fn(async () => ({ content: '{"mode":"once"}' })),
};

const createMockContext = (overrides?: Partial<ClassifierContext>): ClassifierContext => ({
  active_tasks: undefined,
  recent_history: undefined,
  available_tool_categories: undefined,
  available_skills: undefined,
  ...overrides,
});

/* ── Tests ── */

describe("classify_execution_mode — 실행 모드 분류", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("기본 경로", () => {
    it("빈 task → once 모드 기본값", async () => {
      const result = await classify_execution_mode(
        "",
        createMockContext(),
        mockProviders as any,
        mockLogger as Logger,
      );

      expect(result.mode).toBe("once");
      expect(mockProviders.run_orchestrator).not.toHaveBeenCalled();
    });

    it("공백 task → once 모드 기본값", async () => {
      const result = await classify_execution_mode(
        "   ",
        createMockContext(),
        mockProviders as any,
        mockLogger as Logger,
      );

      expect(result.mode).toBe("once");
    });

    it("orchestrator 없음 → once 모드 기본값", async () => {
      const result = await classify_execution_mode(
        "some task",
        createMockContext(),
        {} as any,
        mockLogger as Logger,
      );

      expect(result.mode).toBe("once");
    });
  });

  describe("LLM 분류", () => {
    it("once 모드 응답", async () => {
      mockProviders.run_orchestrator.mockResolvedValue({
        content: '{"mode":"once"}',
      });

      const result = await classify_execution_mode(
        "simple task",
        createMockContext(),
        mockProviders as any,
        mockLogger as Logger,
      );

      expect(result.mode).toBe("once");
      expect(mockLogger.info).toHaveBeenCalledWith("classify_result", expect.any(Object));
    });

    it("agent 모드 응답", async () => {
      mockProviders.run_orchestrator.mockResolvedValue({
        content: '{"mode":"agent"}',
      });

      const result = await classify_execution_mode(
        "multi-step task",
        createMockContext(),
        mockProviders as any,
        mockLogger as Logger,
      );

      expect(result.mode).toBe("agent");
    });

    it("task 모드 응답", async () => {
      mockProviders.run_orchestrator.mockResolvedValue({
        content: '{"mode":"task"}',
      });

      const result = await classify_execution_mode(
        "long task",
        createMockContext(),
        mockProviders as any,
        mockLogger as Logger,
      );

      expect(result.mode).toBe("task");
    });

    it("phase 모드 응답", async () => {
      mockProviders.run_orchestrator.mockResolvedValue({
        content: '{"mode":"phase","workflow_id":"wf-123"}',
      });

      const result = await classify_execution_mode(
        "workflow task",
        createMockContext(),
        mockProviders as any,
        mockLogger as Logger,
      );

      expect(result.mode).toBe("phase");
      expect(result.workflow_id).toBe("wf-123");
    });

    it("inquiry 모드 응답", async () => {
      mockProviders.run_orchestrator.mockResolvedValue({
        content: '{"mode":"inquiry"}',
      });

      const result = await classify_execution_mode(
        "question for user",
        createMockContext(),
        mockProviders as any,
        mockLogger as Logger,
      );

      expect(result.mode).toBe("inquiry");
    });

    it("identity 모드 응답", async () => {
      mockProviders.run_orchestrator.mockResolvedValue({
        content: '{"mode":"identity"}',
      });

      const result = await classify_execution_mode(
        "who are you",
        createMockContext(),
        mockProviders as any,
        mockLogger as Logger,
      );

      expect(result.mode).toBe("identity");
    });

    it("builtin 모드 응답", async () => {
      mockProviders.run_orchestrator.mockResolvedValue({
        content: '{"mode":"builtin","command":"help"}',
      });

      const result = await classify_execution_mode(
        "help",
        createMockContext(),
        mockProviders as any,
        mockLogger as Logger,
      );

      expect(result.mode).toBe("builtin");
      expect(result.command).toBe("help");
    });
  });

  describe("LLM 호출 파라미터", () => {
    it("최대 120 토큰, 온도 0으로 호출", async () => {
      await classify_execution_mode(
        "test task",
        createMockContext(),
        mockProviders as any,
        mockLogger as Logger,
      );

      expect(mockProviders.run_orchestrator).toHaveBeenCalledWith({
        messages: expect.any(Array),
        max_tokens: 120,
        temperature: 0,
      });
    });

    it("active_tasks 없음 → BASE_FLOWCHART 사용", async () => {
      await classify_execution_mode(
        "task",
        createMockContext({ active_tasks: undefined }),
        mockProviders as any,
        mockLogger as Logger,
      );

      const call = (mockProviders.run_orchestrator as any).mock.calls[0][0];
      const system = call.messages[0].content;
      expect(system).toContain("mode classifier");
      expect(system).toContain("Mode Definitions");
    });

    it("active_tasks 있음 → INQUIRY_DEFINITION + 컨텍스트 포함", async () => {
      const activeTasks = [
        {
          taskId: "task-1",
          title: "Running Task",
          objective: "Do something",
          channel: "slack",
          chatId: "chat-1",
          status: "in_progress" as const,
          memory: {},
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          currentTurn: 1,
        },
      ];

      await classify_execution_mode(
        "task",
        createMockContext({ active_tasks: activeTasks }),
        mockProviders as any,
        mockLogger as Logger,
      );

      const call = (mockProviders.run_orchestrator as any).mock.calls[0][0];
      const system = call.messages[0].content;
      expect(system).toContain("Running Task");
    });

    it("available_tool_categories + skills 포함", async () => {
      const ctx = createMockContext({
        available_tool_categories: ["file", "web"],
        available_skills: [
          { name: "research", summary: "Research skill", triggers: [] },
        ],
      });

      await classify_execution_mode(
        "task",
        ctx,
        mockProviders as any,
        mockLogger as Logger,
      );

      const call = (mockProviders.run_orchestrator as any).mock.calls[0][0];
      const user = call.messages[1].content;
      expect(user).toContain("research");
    });

    it("recent_history 포함", async () => {
      const ctx = createMockContext({
        recent_history: [
          { role: "user", content: "previous message" },
          { role: "assistant", content: "previous response" },
        ],
      });

      await classify_execution_mode(
        "task",
        ctx,
        mockProviders as any,
        mockLogger as Logger,
      );

      const call = (mockProviders.run_orchestrator as any).mock.calls[0][0];
      const user = call.messages[1].content;
      expect(user).toContain("previous message");
      expect(user).toContain("RECENT_CONTEXT");
    });
  });

  describe("LLM 에러 처리", () => {
    it("orchestrator 에러 → once 기본값 + 경고 로그", async () => {
      mockProviders.run_orchestrator.mockRejectedValue(new Error("LLM error"));

      const result = await classify_execution_mode(
        "task",
        createMockContext(),
        mockProviders as any,
        mockLogger as Logger,
      );

      expect(result.mode).toBe("once");
      expect(mockLogger.warn).toHaveBeenCalledWith("classify_error", expect.any(Object));
    });

    it("파싱 실패 → once 기본값 + 경고 로그", async () => {
      mockProviders.run_orchestrator.mockResolvedValue({
        content: "invalid json response",
      });

      const result = await classify_execution_mode(
        "task",
        createMockContext(),
        mockProviders as any,
        mockLogger as Logger,
      );

      expect(result.mode).toBe("once");
      expect(mockLogger.warn).toHaveBeenCalledWith("classify_parse_failed", expect.any(Object));
    });

    it("응답 없음 → once 기본값", async () => {
      mockProviders.run_orchestrator.mockResolvedValue({
        content: undefined,
      });

      const result = await classify_execution_mode(
        "task",
        createMockContext(),
        mockProviders as any,
        mockLogger as Logger,
      );

      expect(result.mode).toBe("once");
    });
  });

  describe("모드별 추가 정보", () => {
    it("phase 모드: workflow_id 추출", async () => {
      mockProviders.run_orchestrator.mockResolvedValue({
        content: '{"mode":"phase","workflow_id":"custom-wf"}',
      });

      const result = await classify_execution_mode(
        "run workflow",
        createMockContext(),
        mockProviders as any,
        mockLogger as Logger,
      );

      expect(result.workflow_id).toBe("custom-wf");
    });

    it("phase 모드: nodes 배열 추출", async () => {
      mockProviders.run_orchestrator.mockResolvedValue({
        content: '{"mode":"phase","nodes":["node1","node2"]}',
      });

      const result = await classify_execution_mode(
        "run workflow",
        createMockContext(),
        mockProviders as any,
        mockLogger as Logger,
      );

      expect(result.nodes).toEqual(["node1", "node2"]);
    });

    it("once/agent/task 모드: tools 배열 추출", async () => {
      mockProviders.run_orchestrator.mockResolvedValue({
        content: '{"mode":"agent","tools":["tool1","tool2"]}',
      });

      const result = await classify_execution_mode(
        "task",
        createMockContext(),
        mockProviders as any,
        mockLogger as Logger,
      );

      expect(result.tools).toEqual(["tool1", "tool2"]);
    });

    it("builtin 모드: command + args", async () => {
      mockProviders.run_orchestrator.mockResolvedValue({
        content: '{"mode":"builtin","command":"task","args":"list all"}',
      });

      const result = await classify_execution_mode(
        "task list",
        createMockContext(),
        mockProviders as any,
        mockLogger as Logger,
      );

      expect(result.command).toBe("task");
      expect(result.args).toBe("list all");
    });
  });
});

describe("is_once_escalation — once 에스컬레이션 판별", () => {
  it("once_requires_task_loop → true", () => {
    expect(is_once_escalation("once_requires_task_loop")).toBe(true);
  });

  it("once_requires_agent_loop → true", () => {
    expect(is_once_escalation("once_requires_agent_loop")).toBe(true);
  });

  it("agent_requires_task_loop → false", () => {
    expect(is_once_escalation("agent_requires_task_loop")).toBe(false);
  });

  it("null → false", () => {
    expect(is_once_escalation(null)).toBe(false);
  });

  it("undefined → false", () => {
    expect(is_once_escalation(undefined)).toBe(false);
  });

  it("다른 에러 → false", () => {
    expect(is_once_escalation("some_error")).toBe(false);
  });
});

describe("is_agent_escalation — agent 에스컬레이션 판별", () => {
  it("agent_requires_task_loop → true", () => {
    expect(is_agent_escalation("agent_requires_task_loop")).toBe(true);
  });

  it("once_requires_task_loop → false", () => {
    expect(is_agent_escalation("once_requires_task_loop")).toBe(false);
  });

  it("once_requires_agent_loop → false", () => {
    expect(is_agent_escalation("once_requires_agent_loop")).toBe(false);
  });

  it("null → false", () => {
    expect(is_agent_escalation(null)).toBe(false);
  });

  it("undefined → false", () => {
    expect(is_agent_escalation(undefined)).toBe(false);
  });

  it("다른 에러 → false", () => {
    expect(is_agent_escalation("some_error")).toBe(false);
  });
});
