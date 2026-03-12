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
    get_orchestrator_provider_id: vi.fn().mockReturnValue("openrouter"),
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

    it("aborted 상태 → error_result + logger.warn", async () => {
      const deps = createMockPhaseWorkflowDeps() as PhaseWorkflowDeps;
      const logWarnSpy = vi.fn();
      deps.logger.warn = logWarnSpy;

      const { run_phase_loop: phaseLoopExec } = await import("@src/agent/phase-loop-runner.js");
      (phaseLoopExec as any).mockResolvedValue({
        status: "aborted",
        error: "user_cancelled",
        phases: [],
        memory: {},
      });

      const result = await run_phase_loop(deps, mockRequest, "test task", "test-template");
      expect(result.error).toBeDefined();
      expect(logWarnSpy).toHaveBeenCalledWith("phase_loop_terminal", expect.objectContaining({ status: "aborted" }));
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

  describe("콜백 직접 호출 (exec 인수 캡처)", () => {
    async function capture_exec_args(deps: PhaseWorkflowDeps) {
      const { run_phase_loop: phaseLoopExec } = await import("@src/agent/phase-loop-runner.js");
      let captured_first_arg: any = null;
      let captured_second_arg: any = null;
      (phaseLoopExec as any).mockImplementationOnce(async (first: any, second: any) => {
        captured_first_arg = first;
        captured_second_arg = second;
        return {
          status: "completed",
          phases: [{ phase_id: "p1", title: "T1", status: "completed", agents: [{ agent_id: "a1", label: "A1", status: "completed", result: "ok" }] }],
          memory: {},
        };
      });
      await run_phase_loop(deps, mockRequest, "task", "test-template");
      return { first: captured_first_arg, second: captured_second_arg };
    }

    it("on_phase_change → req.on_progress 호출", async () => {
      const deps = createMockPhaseWorkflowDeps() as PhaseWorkflowDeps;
      const on_progress_spy = vi.fn();
      const req_with_progress = { ...mockRequest, on_progress: on_progress_spy };

      const { run_phase_loop: phaseLoopExec } = await import("@src/agent/phase-loop-runner.js");
      let on_phase_change_fn: any = null;
      (phaseLoopExec as any).mockImplementationOnce(async (first: any) => {
        on_phase_change_fn = first.on_phase_change;
        return {
          status: "completed",
          phases: [],
          memory: {},
        };
      });

      await run_phase_loop(deps, req_with_progress, "task", "test-template");

      if (on_phase_change_fn) {
        on_phase_change_fn({ current_phase: 0, phases: [{ phase_id: "p1" }] });
        expect(on_progress_spy).toHaveBeenCalledWith(expect.objectContaining({ step: 1, total_steps: 1 }));
      }
    });

    it("on_event → get_sse_broadcaster 및 req.on_agent_event 호출", async () => {
      const deps = createMockPhaseWorkflowDeps() as PhaseWorkflowDeps;
      const on_agent_event_spy = vi.fn();
      const req_with_event = { ...mockRequest, on_agent_event: on_agent_event_spy };

      const { run_phase_loop: phaseLoopExec } = await import("@src/agent/phase-loop-runner.js");
      let on_event_fn: any = null;
      (phaseLoopExec as any).mockImplementationOnce(async (_first: any, second: any) => {
        on_event_fn = second.on_event;
        return { status: "completed", phases: [], memory: {} };
      });

      await run_phase_loop(deps, req_with_event, "task", "test-template");

      if (on_event_fn) {
        on_event_fn({ type: "phase_start", phase_id: "p1", workflow_id: "wf-1" });
        expect(on_agent_event_spy).toHaveBeenCalled();
      }
    });

    it("send_message 콜백 — 성공 → bus.publish_outbound 호출", async () => {
      const deps = createMockPhaseWorkflowDeps() as PhaseWorkflowDeps;
      const { first } = await capture_exec_args(deps);

      if (first?.send_message) {
        const result = await first.send_message({ target: "origin", content: "hello" });
        expect(deps.bus?.publish_outbound).toHaveBeenCalled();
        expect(result.ok).toBe(true);
        expect(result.message_id).toBeTruthy();
      }
    });

    it("send_message 콜백 — bus 실패 → logger.error + ok:false", async () => {
      const deps = createMockPhaseWorkflowDeps() as PhaseWorkflowDeps;
      (deps.bus!.publish_outbound as any).mockRejectedValue(new Error("bus down"));
      const { first } = await capture_exec_args(deps);

      if (first?.send_message) {
        const result = await first.send_message({ target: "origin", content: "hello" });
        expect(deps.logger.error).toHaveBeenCalledWith("workflow_send_message_failed", expect.any(Object));
        expect(result.ok).toBe(false);
      }
    });

    it("invoke_tool 콜백 — ctx 있음 → workflow_id를 task_id로 변환", async () => {
      const deps = createMockPhaseWorkflowDeps() as PhaseWorkflowDeps;
      const execute_tool = vi.fn().mockResolvedValue({ result: "done" });
      deps.runtime = { execute_tool } as never;
      const { first } = await capture_exec_args(deps);

      if (first?.invoke_tool) {
        const result = await first.invoke_tool("bash", { cmd: "echo hi" }, { channel: "slack", chat_id: "C1", sender_id: "U1", workflow_id: "wf-1" });
        expect(execute_tool).toHaveBeenCalledWith("bash", { cmd: "echo hi" }, {
          channel: "slack", chat_id: "C1", sender_id: "U1", task_id: "wf-1",
        });
        expect(result).toEqual({ result: "done" });
      }
    });

    it("invoke_tool 콜백 — ctx=undefined → task_id 없이 호출", async () => {
      const deps = createMockPhaseWorkflowDeps() as PhaseWorkflowDeps;
      const execute_tool = vi.fn().mockResolvedValue({ result: "done" });
      deps.runtime = { execute_tool } as never;
      const { first } = await capture_exec_args(deps);

      if (first?.invoke_tool) {
        await first.invoke_tool("read", { path: "/tmp/foo" }, undefined);
        expect(execute_tool).toHaveBeenCalledWith("read", { path: "/tmp/foo" }, undefined);
      }
    });

    it("on_event 콜백 — get_sse_broadcaster null → 오류 없음", async () => {
      const deps = createMockPhaseWorkflowDeps() as PhaseWorkflowDeps;
      deps.get_sse_broadcaster = (() => null) as never;
      const { second } = await capture_exec_args(deps);

      if (second?.on_event) {
        expect(() => second.on_event({ type: "phase_started" } as never)).not.toThrow();
      }
    });

    it("load_template 콜백 → load_workflow_template 위임", async () => {
      const deps = createMockPhaseWorkflowDeps() as PhaseWorkflowDeps;
      const { second } = await capture_exec_args(deps);

      if (second?.load_template) {
        const { load_workflow_template } = await import("@src/orchestration/workflow-loader.js");
        second.load_template("my-workflow");
        expect(load_workflow_template).toHaveBeenCalledWith("/workspace", "my-workflow");
      }
    });

    it("send_message 콜백 — 다른 채널 target → 해당 채널로 publish", async () => {
      const deps = createMockPhaseWorkflowDeps() as PhaseWorkflowDeps;
      const { first } = await capture_exec_args(deps);

      if (first?.send_message) {
        const result = await first.send_message({ target: "custom", channel: "telegram", chat_id: "T1", content: "커스텀" });
        expect(deps.bus?.publish_outbound).toHaveBeenCalledWith(expect.objectContaining({
          provider: "telegram", chat_id: "T1",
        }));
        expect(result.ok).toBe(true);
      }
    });

    it("ask_channel 콜백 — timeout → timed_out=true", async () => {
      const deps = createMockPhaseWorkflowDeps() as PhaseWorkflowDeps;
      const { first } = await capture_exec_args(deps);

      if (first?.ask_channel) {
        const response = await first.ask_channel({ target: "origin", content: "질문" }, 10);
        expect(response.timed_out).toBe(true);
        expect(response.response).toBe("");
      }
    });

    it("ask_channel 콜백 — resolve → timed_out=false", async () => {
      const deps = createMockPhaseWorkflowDeps() as PhaseWorkflowDeps;
      let captured_resolve: ((content: string) => void) | null = null;
      (deps.hitl_store as any).set = vi.fn((_id: string, entry: any) => { captured_resolve = entry.resolve; });
      const { first } = await capture_exec_args(deps);

      if (first?.ask_channel) {
        const response_promise = first.ask_channel({ target: "origin", content: "질문" }, 5000);
        expect(captured_resolve).not.toBeNull();
        captured_resolve!("답변");
        const response = await response_promise;
        expect(response.timed_out).toBe(false);
        expect(response.response).toBe("답변");
      }
    });
  });

  describe("format_phase_summary — 메모리 폴백", () => {
    it("phases 없고 memory 있으면 마지막 키 값으로 요약", async () => {
      const deps = createMockPhaseWorkflowDeps() as PhaseWorkflowDeps;
      const { run_phase_loop: phaseLoopExec } = await import("@src/agent/phase-loop-runner.js");
      (phaseLoopExec as any).mockResolvedValue({
        status: "completed",
        phases: [],  // 빈 phases → lines.length === 0
        memory: { origin: "skip", result: "final_output_text" },
      });

      const result = await run_phase_loop(deps, mockRequest, "task", "test-template");

      expect(result.reply).toContain("final_output_text");
    });

    it("phases 없고 memory 없으면 빈 요약", async () => {
      const deps = createMockPhaseWorkflowDeps() as PhaseWorkflowDeps;
      const { run_phase_loop: phaseLoopExec } = await import("@src/agent/phase-loop-runner.js");
      (phaseLoopExec as any).mockResolvedValue({
        status: "completed",
        phases: [],
        memory: {},
      });

      const result = await run_phase_loop(deps, mockRequest, "task", "test-template");
      expect(result.reply).toContain("완료");
    });

    it("critic 정보가 있는 phase → critic review 출력", async () => {
      const deps = createMockPhaseWorkflowDeps() as PhaseWorkflowDeps;
      const { run_phase_loop: phaseLoopExec } = await import("@src/agent/phase-loop-runner.js");
      (phaseLoopExec as any).mockResolvedValue({
        status: "completed",
        phases: [
          {
            phase_id: "p1", title: "Phase 1", status: "completed",
            agents: [{ agent_id: "a1", label: "A1", status: "completed", result: "result" }],
            critic: { approved: true, review: "Looks good" },
          },
        ],
        memory: {},
      });

      const result = await run_phase_loop(deps, mockRequest, "task", "test-template");
      expect(result.reply).toContain("Critic");
      expect(result.reply).toContain("Looks good");
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

    it("critic=null → format_workflow_preview에서 critic_note 없음", async () => {
      const deps = createMockPhaseWorkflowDeps() as PhaseWorkflowDeps;
      (deps.providers.run_orchestrator as any).mockResolvedValue({
        content: JSON.stringify({
          title: "No Critic Workflow",
          objective: "test",
          phases: [{
            phase_id: "p1", title: "실행",
            agents: [{ agent_id: "a1", role: "coder", label: "코더", backend: "openrouter", system_prompt: "코드 작성." }],
            critic: null,
          }],
        }),
      });

      const result = await run_phase_loop(deps, mockRequest, "completely new task", undefined);
      expect(result.reply).toContain("1 agents)");
      expect(result.reply).not.toContain("+ critic");
    });

    it("title 없는 JSON → no_matching_workflow_template", async () => {
      const deps = createMockPhaseWorkflowDeps() as PhaseWorkflowDeps;
      (deps.providers.run_orchestrator as any).mockResolvedValue({
        content: '{"phases": [{"phase_id": "p1"}]}',
      });

      const result = await run_phase_loop(deps, mockRequest, "completely new task", undefined);
      expect(result.error).toContain("no_matching_workflow_template");
    });

    it("phases가 배열 아님 → no_matching_workflow_template", async () => {
      const deps = createMockPhaseWorkflowDeps() as PhaseWorkflowDeps;
      (deps.providers.run_orchestrator as any).mockResolvedValue({
        content: '{"title": "테스트", "phases": {"key": "val"}}',
      });

      const result = await run_phase_loop(deps, mockRequest, "completely new task", undefined);
      expect(result.error).toContain("no_matching_workflow_template");
    });
  });

  describe("에러 경로", () => {
    it("store.upsert reject → workflow_upsert_failed 로깅", async () => {
      const { load_workflow_templates, load_workflow_template } = await import("@src/orchestration/workflow-loader.js");
      vi.mocked(load_workflow_template).mockReturnValue(null);
      vi.mocked(load_workflow_templates).mockReturnValue([]);

      const deps = createMockPhaseWorkflowDeps() as PhaseWorkflowDeps;
      (deps.phase_workflow_store as any).upsert = vi.fn().mockRejectedValue(new Error("db write failure"));

      const result = await run_phase_loop(deps, mockRequest, "completely new unmatched task");
      expect(result.mode).toBe("phase");
      await new Promise((r) => setTimeout(r, 20));
      expect(deps.logger.error).toHaveBeenCalledWith(
        "workflow_upsert_failed",
        expect.objectContaining({ error: "db write failure" }),
      );
    });

    it("ask_channel publish_outbound reject → workflow_ask_channel_send_failed 로깅", async () => {
      const { run_phase_loop: phaseLoopExec } = await import("@src/agent/phase-loop-runner.js");
      let captured_first: any;
      (phaseLoopExec as any).mockImplementationOnce(async (first: any) => {
        captured_first = first;
        return { status: "completed", phases: [], memory: {} };
      });

      const { load_workflow_template: lwt, load_workflow_templates: lwts } = await import("@src/orchestration/workflow-loader.js");
      vi.mocked(lwt).mockReturnValue(mockTemplate as never);
      vi.mocked(lwts).mockReturnValue([mockTemplate] as never);

      const deps = createMockPhaseWorkflowDeps() as PhaseWorkflowDeps;
      (deps.bus as any).publish_outbound = vi.fn().mockRejectedValue(new Error("network error"));

      await run_phase_loop(deps, mockRequest, "test task", "test-template");

      const ask_promise = captured_first.ask_channel({ target: "origin", content: "질문" }, 30);
      await new Promise((r) => setTimeout(r, 20));
      expect(deps.logger.error).toHaveBeenCalledWith(
        "workflow_ask_channel_send_failed",
        expect.objectContaining({ error: "network error" }),
      );

      const set_call = (deps.hitl_store as any).set.mock.calls[0];
      if (set_call) set_call[1].resolve("답변");
      await ask_promise;
    });
  });

  describe("format_phase_summary — agent.error", () => {
    it("agent.error 있을 때 → error 텍스트 표시", async () => {
      const deps = createMockPhaseWorkflowDeps() as PhaseWorkflowDeps;
      const { run_phase_loop: phaseLoopExec } = await import("@src/agent/phase-loop-runner.js");
      (phaseLoopExec as any).mockResolvedValue({
        status: "completed",
        phases: [{
          phase_id: "p1", title: "실패 단계", status: "failed",
          agents: [
            { agent_id: "a1", label: "Analyst", status: "failed", error: "분석 실패했습니다", result: null },
          ],
        }],
        memory: {},
      });

      const result = await run_phase_loop(deps, mockRequest, "task", "test-template");
      expect(result.reply).toContain("분석 실패했습니다");
    });
  });
});
