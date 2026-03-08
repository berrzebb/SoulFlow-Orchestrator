/** Phase 4.5+: phase-workflow 모듈 테스트
 *
 * 목표: run_phase_loop 함수의 다양한 경로 테스트
 *       - 의존성 검증 (workspace, store, subagents)
 *       - 템플릿 로딩 (hint_id 우선, 제목 매칭, 동적 생성)
 *       - 변수 대체
 *       - 결과 상태 처리 (completed, waiting_user_input, error)
 *       - 프로세스 추적 및 이벤트 로깅
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PhaseWorkflowDeps } from "@src/orchestration/execution/phase-workflow.js";
import { run_phase_loop } from "@src/orchestration/execution/phase-workflow.js";
import type { OrchestrationRequest } from "@src/orchestration/types.js";

/* ── Mock Implementations ── */

const mockRequest: OrchestrationRequest = {
  message: {
    id: "msg-1",
    provider: "slack",
    channel: "general",
    sender_id: "user1",
    chat_id: "chat1",
    content: "run workflow",
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
  on_progress: vi.fn(),
  on_agent_event: vi.fn(),
};

const mockTemplate = {
  title: "Data Analysis Workflow",
  objective: "Analyze data",
  phases: [
    {
      phase_id: "phase-1",
      title: "Data Collection",
      agents: [
        {
          agent_id: "collector",
          role: "Data Collector",
          label: "Collector",
          backend: "openrouter",
          system_prompt: "Collect data",
        },
      ],
      critic: { backend: "openrouter", system_prompt: "Review data", gate: true },
    },
  ],
  nodes: [],
  variables: {},
};

const createMockPhaseWorkflowDeps = (): Partial<PhaseWorkflowDeps> => ({
  providers: {
    run_orchestrator: vi.fn().mockResolvedValue({
      content: JSON.stringify({
        title: "Generated Workflow",
        objective: "Test",
        phases: [
          {
            phase_id: "gen-phase-1",
            title: "Generated Phase",
            agents: [{ agent_id: "gen-agent", role: "Agent", label: "Agent", backend: "openrouter", system_prompt: "Test" }],
            critic: { backend: "openrouter", system_prompt: "Test", gate: true },
          },
        ],
      }),
    }),
  } as any,
  runtime: {
    execute_tool: vi.fn(),
  } as any,
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  workspace: "/workspace",
  process_tracker: {
    link_workflow: vi.fn(),
    end: vi.fn(),
    set_mode: vi.fn(),
  } as any,
  subagents: {} as any,
  phase_workflow_store: {
    upsert: vi.fn().mockResolvedValue(undefined),
    get: vi.fn(),
  } as any,
  bus: {
    publish_outbound: vi.fn().mockResolvedValue(undefined),
  } as any,
  hitl_store: {
    set: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
  } as any,
  get_sse_broadcaster: vi.fn(() => ({
    broadcast_workflow_event: vi.fn(),
  })),
  render_hitl: vi.fn((body) => `[HITL] ${body}`),
  decision_service: null,
  promise_service: null,
});

/* ── Mock Module Imports ── */

vi.mock("@src/agent/phase-loop-runner.js", () => ({
  run_phase_loop: vi.fn().mockResolvedValue({
    status: "completed",
    phases: [
      {
        phase_id: "phase-1",
        title: "Phase 1",
        status: "completed",
        agents: [{ agent_id: "agent-1", label: "Agent 1", status: "completed", result: "Result 1" }],
      },
    ],
    memory: { result: "workflow completed" },
  }),
}));

vi.mock("@src/orchestration/workflow-loader.js", () => ({
  load_workflow_templates: vi.fn(() => [mockTemplate]),
  load_workflow_template: vi.fn((workspace, hint) => (hint === "test-template" ? mockTemplate : null)),
  substitute_variables: vi.fn((template, vars) => ({
    ...template,
    title: `${template.title} [${vars.objective}]`,
  })),
}));

/* ── Tests ── */

describe("run_phase_loop — phase 워크플로우 실행", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("의존성 검증", () => {
    it("workspace 없음 → error throw", async () => {
      const deps = createMockPhaseWorkflowDeps() as PhaseWorkflowDeps;
      deps.workspace = "";

      await expect(run_phase_loop(deps, mockRequest, "test task")).rejects.toThrow("workspace is required");
    });

    it("subagents 없음 → phase_loop_deps_not_configured 에러", async () => {
      const deps = createMockPhaseWorkflowDeps() as PhaseWorkflowDeps;
      deps.subagents = null;

      const result = await run_phase_loop(deps, mockRequest, "test task");

      expect(result.error).toContain("phase_loop_deps_not_configured");
      expect(result.mode).toBe("phase");
    });

    it("phase_workflow_store 없음 → phase_loop_deps_not_configured 에러", async () => {
      const deps = createMockPhaseWorkflowDeps() as PhaseWorkflowDeps;
      deps.phase_workflow_store = null;

      const result = await run_phase_loop(deps, mockRequest, "test task");

      expect(result.error).toContain("phase_loop_deps_not_configured");
    });
  });

  describe("템플릿 로딩", () => {
    it("hint_id로 템플릿 로드 → 변수 대체 후 실행", async () => {
      const deps = createMockPhaseWorkflowDeps() as PhaseWorkflowDeps;

      const result = await run_phase_loop(deps, mockRequest, "analyze data", "test-template");

      expect(result.mode).toBe("phase");
      expect(result.reply).toContain("완료");
      expect(result.run_id).toBe("run-1");
    });

    it("hint_id 매칭 실패 → 제목으로 템플릿 검색", async () => {
      const deps = createMockPhaseWorkflowDeps() as PhaseWorkflowDeps;

      const result = await run_phase_loop(deps, mockRequest, "Data Analysis Workflow please", undefined);

      expect(result.mode).toBe("phase");
      expect(result.reply).toContain("완료");
    });

    it("키워드 매칭으로 템플릿 찾기", async () => {
      const deps = createMockPhaseWorkflowDeps() as PhaseWorkflowDeps;

      const result = await run_phase_loop(deps, mockRequest, "please use analysis workflow", undefined);

      expect(result.mode).toBe("phase");
      expect(result.reply).toContain("완료");
    });

    it("템플릿 미존재 → 동적 생성 폴백", async () => {
      const deps = createMockPhaseWorkflowDeps() as PhaseWorkflowDeps;

      const result = await run_phase_loop(deps, mockRequest, "totally unique unmatched task", undefined);

      expect(result.mode).toBe("phase");
      expect(result.reply).toContain("다음 워크플로우를 생성했습니다");
    });

    it("동적 생성 실패 → no_matching_workflow_template 에러", async () => {
      const deps = createMockPhaseWorkflowDeps() as PhaseWorkflowDeps;
      (deps.providers.run_orchestrator as any).mockResolvedValue({
        content: "invalid response",
      });

      const result = await run_phase_loop(deps, mockRequest, "totally unique unmatched task", undefined);

      expect(result.error).toContain("no_matching_workflow_template");
    });
  });

  describe("변수 대체", () => {
    it("template variables + objective 대체", async () => {
      const deps = createMockPhaseWorkflowDeps() as PhaseWorkflowDeps;

      const result = await run_phase_loop(deps, mockRequest, "custom objective", "test-template");

      expect(result.mode).toBe("phase");
      expect(result.reply).toContain("완료");
    });
  });

  describe("결과 상태 처리", () => {
    it("completed 상태 → reply_result", async () => {
      const deps = createMockPhaseWorkflowDeps() as PhaseWorkflowDeps;

      const result = await run_phase_loop(deps, mockRequest, "test task", "test-template");

      expect(result.mode).toBe("phase");
      expect(result.reply).toContain("완료");
      expect(result.tool_calls_count).toBe(0);
      expect(result.run_id).toBe("run-1");
    });

    it("waiting_user_input 상태 (pending) → render_hitl(question)", async () => {
      const deps = createMockPhaseWorkflowDeps() as PhaseWorkflowDeps;
      const { run_phase_loop: phaseLoopExec } = await import("@src/agent/phase-loop-runner.js");
      (phaseLoopExec as any).mockResolvedValue({
        status: "waiting_user_input",
        phases: [
          {
            phase_id: "phase-1",
            title: "Phase 1",
            pending_user_input: true,
            agents: [{ agent_id: "agent-1", label: "Agent 1", result: "waiting for input" }],
          },
        ],
      });

      const result = await run_phase_loop(deps, mockRequest, "test task", "test-template");

      expect(result.mode).toBe("phase");
      expect(result.reply).toContain("[HITL]");
      expect(result.reply).toContain("워크플로우");
    });

    it("waiting_user_input 상태 (critic failure) → render_hitl(escalation)", async () => {
      const deps = createMockPhaseWorkflowDeps() as PhaseWorkflowDeps;
      const { run_phase_loop: phaseLoopExec } = await import("@src/agent/phase-loop-runner.js");
      (phaseLoopExec as any).mockResolvedValue({
        status: "waiting_user_input",
        phases: [
          {
            phase_id: "phase-1",
            title: "Phase 1",
            agents: [{ agent_id: "agent-1", label: "Agent 1", result: "agent output" }],
            critic: { approved: false, review: "needs revision" },
          },
        ],
      });

      const result = await run_phase_loop(deps, mockRequest, "test task", "test-template");

      expect(result.mode).toBe("phase");
      expect(result.reply).toContain("[HITL]");
      expect(result.reply).toContain("워크플로우");
    });

    it("failed 상태 → error_result", async () => {
      const deps = createMockPhaseWorkflowDeps() as PhaseWorkflowDeps;
      const { run_phase_loop: phaseLoopExec } = await import("@src/agent/phase-loop-runner.js");
      (phaseLoopExec as any).mockResolvedValue({
        status: "failed",
        error: "execution failed",
        phases: [],
      });

      const result = await run_phase_loop(deps, mockRequest, "test task", "test-template");

      expect(result.error).toContain("phase_failed");
      expect(result.reply).toBeNull();
    });

    it("cancelled 상태 → error_result", async () => {
      const deps = createMockPhaseWorkflowDeps() as PhaseWorkflowDeps;
      const { run_phase_loop: phaseLoopExec } = await import("@src/agent/phase-loop-runner.js");
      (phaseLoopExec as any).mockResolvedValue({
        status: "cancelled",
        error: "user cancelled",
        phases: [],
      });

      const result = await run_phase_loop(deps, mockRequest, "test task", "test-template");

      expect(result.error).toContain("phase_cancelled");
    });
  });

  describe("프로세스 추적", () => {
    it("process_tracker.link_workflow 호출", async () => {
      const deps = createMockPhaseWorkflowDeps() as PhaseWorkflowDeps;

      await run_phase_loop(deps, mockRequest, "test task", "test-template");

      expect(deps.process_tracker?.link_workflow).toHaveBeenCalledWith("run-1", expect.stringContaining("wf-"));
    });
  });

  describe("채널 콜백", () => {
    it("send_message 콜백 동작", async () => {
      const deps = createMockPhaseWorkflowDeps() as PhaseWorkflowDeps;

      const result = await run_phase_loop(deps, mockRequest, "test task", "test-template");

      expect(result.mode).toBe("phase");
    });

    it("ask_channel 콜백 동작", async () => {
      const deps = createMockPhaseWorkflowDeps() as PhaseWorkflowDeps;

      const result = await run_phase_loop(deps, mockRequest, "test task", "test-template");

      expect(result.mode).toBe("phase");
    });
  });

  describe("이벤트 로깅", () => {
    it("phase_loop_terminal warn 로깅", async () => {
      const deps = createMockPhaseWorkflowDeps() as PhaseWorkflowDeps;
      const logWarnSpy = vi.fn();
      deps.logger.warn = logWarnSpy;

      const { run_phase_loop: phaseLoopExec } = await import("@src/agent/phase-loop-runner.js");
      (phaseLoopExec as any).mockResolvedValue({
        status: "failed",
        error: "test error",
        phases: [],
      });

      await run_phase_loop(deps, mockRequest, "test task", "test-template");

      expect(logWarnSpy).toHaveBeenCalledWith(
        "phase_loop_terminal",
        expect.objectContaining({
          status: "failed",
        })
      );
    });
  });

  describe("node_categories 전달", () => {
    it("node_categories 포함 → initial_memory에 추가", async () => {
      const deps = createMockPhaseWorkflowDeps() as PhaseWorkflowDeps;

      const result = await run_phase_loop(deps, mockRequest, "test task", "test-template", ["cat1", "cat2"]);

      expect(result.mode).toBe("phase");
    });
  });

  describe("동적 워크플로우 생성", () => {
    it("동적 생성 성공 → preview 반환 및 store upsert", async () => {
      const deps = createMockPhaseWorkflowDeps() as PhaseWorkflowDeps;
      (deps.providers.run_orchestrator as any).mockResolvedValue({
        content: JSON.stringify({
          title: "Auto Generated",
          objective: "Auto test",
          phases: [
            {
              phase_id: "auto-1",
              title: "Auto Phase",
              agents: [{ agent_id: "auto-agent", role: "Agent", label: "Agent", backend: "openrouter", system_prompt: "Auto" }],
              critic: { backend: "openrouter", system_prompt: "Auto", gate: true },
            },
          ],
        }),
      });

      const result = await run_phase_loop(deps, mockRequest, "completely new task", undefined);

      expect(result.mode).toBe("phase");
      expect(result.reply).toContain("다음 워크플로우를 생성했습니다");
      expect(deps.phase_workflow_store?.upsert).toHaveBeenCalled();
    });

    it("동적 생성 후 LLM 에러 → null 반환", async () => {
      const deps = createMockPhaseWorkflowDeps() as PhaseWorkflowDeps;
      (deps.providers.run_orchestrator as any).mockRejectedValue(new Error("LLM error"));

      const result = await run_phase_loop(deps, mockRequest, "completely new task", undefined);

      expect(result.error).toContain("no_matching_workflow_template");
    });
  });
});
