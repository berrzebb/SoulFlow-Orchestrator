/** Phase 4.5+: continue_task_loop 모듈 테스트
 *
 * 목표: 재개된 task를 계속 실행하는 continue_task_loop 테스트
 *       - prior_session 복원
 *       - 사용자 입력 처리
 *       - 승인/입력 대기 상태
 *       - 에러 및 성공 경로
 */

import { describe, it, expect, vi } from "vitest";
import type { ContinueTaskDeps } from "@src/orchestration/execution/continue-task-loop.js";
import { continue_task_loop } from "@src/orchestration/execution/continue-task-loop.js";
import type { OrchestrationRequest, ExecutorProvider } from "@src/orchestration/types.js";
import type { TaskState } from "@src/contracts.js";
import { StreamBuffer } from "@src/channels/stream-buffer.js";

/* ── Mock Implementations ── */

const mockRequest: OrchestrationRequest = {
  message: {
    id: "msg-1",
    provider: "slack",
    channel: "general",
    sender_id: "user1",
    chat_id: "chat1",
    content: "test response",
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

const mockTask: TaskState = {
  taskId: "task:slack:chat1:test:scope-1",
  title: "Resumed Task",
  objective: "Complete the task",
  channel: "slack",
  chatId: "chat1",
  status: "waiting_user_input",
  memory: {
    objective: "Complete the task",
    __user_input: "user response",
  },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  currentTurn: 5,
};

const createMockContinueTaskDeps = (): Partial<ContinueTaskDeps> => ({
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
    get_always_skills: vi.fn(() => []),
    get_tool_definitions: vi.fn(() => []),
    get_tool_executors: vi.fn(() => ({})),
    get_context_builder: vi.fn(() => ({
      skills_loader: {
        get_role_skill: vi.fn(() => ({ heart: "❤️" })),
      },
    })),
    run_agent_loop: vi.fn().mockResolvedValue({ final_content: "" }),
    run_task_loop: vi.fn(),
    recommend_skills: vi.fn(() => []),
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
  convert_agent_result: vi.fn(),
  hooks_for: vi.fn(() => ({})),
  config: {
    agent_loop_max_turns: 10,
    task_loop_max_turns: 20,
    executor_provider: "chatgpt" as ExecutorProvider,
  } as any,
  build_persona_followup: vi.fn(() => "followup"),
  build_compaction_flush: vi.fn(() => undefined),
  log_event: vi.fn(),
  policy_resolver: {
    resolve: vi.fn(() => ({ max_turns: 5, tools_blocklist: [], tools_allowlist: [] })),
  } as any,
  caps: vi.fn(() => ({})),
  build_system_prompt: vi.fn().mockResolvedValue("You are a helpful assistant"),
  collect_skill_provider_preferences: vi.fn(() => []),
});

/* ── Tests ── */

describe("continue_task_loop — 재개된 task 실행", () => {
  describe("task 재개 성공 경로", () => {
    it("runtime.run_task_loop 호출 → 결과 반환", async () => {
      const deps = createMockContinueTaskDeps() as ContinueTaskDeps;

      (deps.runtime.run_task_loop as any).mockResolvedValue({
        state: {
          status: "completed",
          memory: {
            last_output: "Task resumed and completed",
          },
        },
      });

      const result = await continue_task_loop(deps, mockRequest, mockTask, "test task", []);

      expect(result.mode).toBe("task");
      expect(result.reply).toContain("Task resumed and completed");
      expect(result.run_id).toBe("run-1");
    });

    it("최종 응답 억제 → suppress_result with run_id", async () => {
      const deps = createMockContinueTaskDeps() as ContinueTaskDeps;

      (deps.runtime.run_task_loop as any).mockResolvedValue({
        state: {
          status: "completed",
          memory: {
            suppress_final_reply: true,
            last_output: "internal",
          },
        },
      });

      const result = await continue_task_loop(deps, mockRequest, mockTask, "test task", []);

      expect(result.suppress_reply).toBe(true);
      expect(result.run_id).toBe("run-1");
      expect(result.mode).toBe("task");
    });

    it("승인 대기 상태 → suppress_result with run_id", async () => {
      const deps = createMockContinueTaskDeps() as ContinueTaskDeps;

      (deps.runtime.run_task_loop as any).mockResolvedValue({
        state: {
          status: "waiting_approval",
          memory: {
            last_output: "approval needed",
          },
        },
      });

      const result = await continue_task_loop(deps, mockRequest, mockTask, "test task", []);

      expect(result.suppress_reply).toBe(true);
      expect(result.run_id).toBe("run-1");
      expect(result.mode).toBe("task");
    });

    it("사용자 입력 대기 → suppress_result with run_id", async () => {
      const deps = createMockContinueTaskDeps() as ContinueTaskDeps;

      (deps.runtime.run_task_loop as any).mockResolvedValue({
        state: {
          status: "waiting_user_input",
          memory: {
            last_output: "waiting for user input",
          },
        },
      });

      const result = await continue_task_loop(deps, mockRequest, mockTask, "test task", []);

      expect(result.suppress_reply).toBe(true);
      expect(result.run_id).toBe("run-1");
      expect(result.mode).toBe("task");
    });

    it("최대 턴 도달 → suppress_result with run_id", async () => {
      const deps = createMockContinueTaskDeps() as ContinueTaskDeps;

      (deps.runtime.run_task_loop as any).mockResolvedValue({
        state: {
          status: "max_turns_reached",
          memory: {
            last_output: "max turns reached",
          },
        },
      });

      const result = await continue_task_loop(deps, mockRequest, mockTask, "test task", []);

      expect(result.suppress_reply).toBe(true);
      expect(result.run_id).toBe("run-1");
      expect(result.mode).toBe("task");
    });
  });

  describe("에러 경로", () => {
    it("실패 상태 → error_result with run_id", async () => {
      const deps = createMockContinueTaskDeps() as ContinueTaskDeps;

      (deps.runtime.run_task_loop as any).mockResolvedValue({
        state: {
          status: "failed",
          exitReason: "execution error",
          memory: {},
        },
      });

      const result = await continue_task_loop(deps, mockRequest, mockTask, "test task", []);

      expect(result.error).toBeDefined();
      expect(result.error).toContain("task_failed");
      expect(result.run_id).toBe("run-1");
      expect(result.mode).toBe("task");
    });

    it("취소 상태 → error_result with run_id", async () => {
      const deps = createMockContinueTaskDeps() as ContinueTaskDeps;

      (deps.runtime.run_task_loop as any).mockResolvedValue({
        state: {
          status: "cancelled",
          exitReason: "user cancelled",
          memory: {},
        },
      });

      const result = await continue_task_loop(deps, mockRequest, mockTask, "test task", []);

      expect(result.error).toBeDefined();
      expect(result.error).toContain("task_cancelled");
      expect(result.run_id).toBe("run-1");
      expect(result.mode).toBe("task");
    });

    it("빈 출력 → error_result with run_id", async () => {
      const deps = createMockContinueTaskDeps() as ContinueTaskDeps;

      (deps.runtime.run_task_loop as any).mockResolvedValue({
        state: {
          status: "completed",
          memory: {
            last_output: "",
          },
        },
      });

      const result = await continue_task_loop(deps, mockRequest, mockTask, "test task", []);

      expect(result.error).toBeDefined();
      expect(result.error).toContain("resume_task_no_output");
      expect(result.run_id).toBe("run-1");
      expect(result.mode).toBe("task");
    });
  });

  describe("프로세스 추적", () => {
    it("process_tracker 메서드 호출", async () => {
      const deps = createMockContinueTaskDeps() as ContinueTaskDeps;
      deps.process_tracker = {
        set_mode: vi.fn(),
        set_executor: vi.fn(),
        link_task: vi.fn(),
        link_loop: vi.fn(),
        end: vi.fn(),
        set_tool_count: vi.fn(),
      } as any;

      (deps.runtime.run_task_loop as any).mockResolvedValue({
        state: {
          status: "completed",
          memory: {
            last_output: "result",
          },
        },
      });

      await continue_task_loop(deps, mockRequest, mockTask, "test task", []);

      expect(deps.process_tracker.set_mode).toHaveBeenCalledWith("run-1", "task");
      expect(deps.process_tracker.set_executor).toHaveBeenCalledWith("run-1", "orchestrator_llm");
      expect(deps.process_tracker.link_task).toHaveBeenCalledWith("run-1", mockTask.taskId);
    });
  });

  describe("이벤트 로깅", () => {
    it("waiting_approval 이벤트 로깅", async () => {
      const deps = createMockContinueTaskDeps() as ContinueTaskDeps;
      const logEventSpy = vi.fn();
      deps.log_event = logEventSpy;

      (deps.runtime.run_task_loop as any).mockResolvedValue({
        state: {
          status: "waiting_approval",
          memory: {
            last_output: "approval needed",
          },
        },
      });

      await continue_task_loop(deps, mockRequest, mockTask, "test task", []);

      expect(logEventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          phase: "approval",
          summary: "waiting_approval (resume)",
        })
      );
    });
  });

  describe("skill 및 정책 해결", () => {
    it("build_system_prompt 호출", async () => {
      const deps = createMockContinueTaskDeps() as ContinueTaskDeps;
      const buildSystemPromptSpy = vi.fn().mockResolvedValue("You are helpful");
      deps.build_system_prompt = buildSystemPromptSpy;

      (deps.runtime.run_task_loop as any).mockResolvedValue({
        state: {
          status: "completed",
          memory: {
            last_output: "result",
          },
        },
      });

      await continue_task_loop(deps, mockRequest, mockTask, "test task", []);

      expect(buildSystemPromptSpy).toHaveBeenCalledWith(
        expect.any(Array), // skill_names
        "slack", // provider
        "chat1", // chat_id
        undefined, // tool_categories
        "test" // alias
      );
    });

    it("policy_resolver.resolve 호출", async () => {
      const deps = createMockContinueTaskDeps() as ContinueTaskDeps;
      const resolveSpy = vi.fn().mockReturnValue({ max_turns: 5, tools_blocklist: [], tools_allowlist: [] });
      deps.policy_resolver = { resolve: resolveSpy } as any;

      (deps.runtime.run_task_loop as any).mockResolvedValue({
        state: {
          status: "completed",
          memory: {
            last_output: "result",
          },
        },
      });

      await continue_task_loop(deps, mockRequest, mockTask, "test task", []);

      expect(resolveSpy).toHaveBeenCalledWith("test task", []);
    });

    it("recommend_skills 결과가 skill_names에 포함됨 (resolve_context_skills)", async () => {
      const deps = createMockContinueTaskDeps() as ContinueTaskDeps;
      (deps.runtime.recommend_skills as any).mockReturnValue(["webSearch", "calculator", ""]);

      (deps.runtime.run_task_loop as any).mockResolvedValue({
        state: { status: "completed", memory: { last_output: "done" } },
      });

      let capturedSkills: string[] = [];
      deps.build_system_prompt = vi.fn().mockImplementation(async (skills: string[]) => {
        capturedSkills = skills;
        return "prompt";
      });

      await continue_task_loop(deps, mockRequest, mockTask, "test task", []);

      // 빈 문자열은 필터링, 유효 스킬은 추가됨
      expect(capturedSkills).toContain("webSearch");
      expect(capturedSkills).toContain("calculator");
      expect(capturedSkills).not.toContain("");
    });
  });

  describe("execute 노드 내부 경로 — native backend", () => {
    /** run_task_loop mock이 실제로 execute 노드를 호출하도록 구현. */
    function make_node_invoker(exec_result: Record<string, unknown>) {
      return vi.fn().mockImplementation(async ({ nodes, task_id, objective, initial_memory }: any) => {
        const memory = { ...initial_memory };
        const exec = await nodes[0].run({
          task_state: { taskId: task_id, objective, status: "running", memory, currentTurn: 0, maxTurns: 20 },
          memory,
        });
        return {
          state: {
            status: exec_result.status ?? exec.status ?? "completed",
            exitReason: exec_result.exit_reason ?? exec.exit_reason,
            memory: { ...exec.memory_patch, ...exec_result },
            currentTurn: 1,
          },
        };
      });
    }

    it("native backend 성공 → 정상 출력 반환", async () => {
      const deps = createMockContinueTaskDeps() as ContinueTaskDeps;
      deps.agent_backends = {
        resolve_for_mode: vi.fn(() => ({ id: "nb", native_tool_loop: true, capabilities: {} })),
        resolve_backend: vi.fn(),
        run: vi.fn().mockResolvedValue({ content: "native reply", tool_calls_count: 1, finish_reason: "stop" }),
        get_session_store: vi.fn(() => null),
      } as any;
      (deps.runtime.run_task_loop as any).mockImplementation(make_node_invoker({ last_output: "native reply" }));

      const result = await continue_task_loop(deps, mockRequest, mockTask, "test task", []);

      expect(result.reply).toContain("native reply");
      expect(result.mode).toBe("task");
    });

    it("native backend → finish_reason=cancelled → suppress", async () => {
      const deps = createMockContinueTaskDeps() as ContinueTaskDeps;
      deps.agent_backends = {
        resolve_for_mode: vi.fn(() => ({ id: "nb", native_tool_loop: true, capabilities: {} })),
        resolve_backend: vi.fn(),
        run: vi.fn().mockResolvedValue({ content: "cancelled", tool_calls_count: 0, finish_reason: "cancelled" }),
        get_session_store: vi.fn(() => null),
      } as any;
      (deps.runtime.run_task_loop as any).mockImplementation(async ({ nodes, task_id, objective, initial_memory }: any) => {
        const memory = { ...initial_memory };
        const exec = await nodes[0].run({
          task_state: { taskId: task_id, objective, status: "running", memory, currentTurn: 0, maxTurns: 20 },
          memory,
        });
        return { state: { status: exec.status ?? "completed", exitReason: exec.exit_reason, memory: exec.memory_patch, currentTurn: 1 } };
      });

      const result = await continue_task_loop(deps, mockRequest, mockTask, "test task", []);
      expect(result.suppress_reply).toBe(true);
    });

    it("native backend → finish_reason=approval_required → suppress", async () => {
      const deps = createMockContinueTaskDeps() as ContinueTaskDeps;
      deps.agent_backends = {
        resolve_for_mode: vi.fn(() => ({ id: "nb", native_tool_loop: true, capabilities: {} })),
        resolve_backend: vi.fn(),
        run: vi.fn().mockResolvedValue({ content: "need approval", tool_calls_count: 0, finish_reason: "approval_required" }),
        get_session_store: vi.fn(() => null),
      } as any;
      (deps.runtime.run_task_loop as any).mockImplementation(async ({ nodes, task_id, objective, initial_memory }: any) => {
        const memory = { ...initial_memory };
        const exec = await nodes[0].run({
          task_state: { taskId: task_id, objective, status: "running", memory, currentTurn: 0, maxTurns: 20 },
          memory,
        });
        return { state: { status: exec.status ?? "waiting_approval", memory: exec.memory_patch, currentTurn: 1 } };
      });

      const result = await continue_task_loop(deps, mockRequest, mockTask, "test task", []);
      expect(result.suppress_reply).toBe(true);
    });

    it("native backend → __request_user_choice__ → suppress", async () => {
      const deps = createMockContinueTaskDeps() as ContinueTaskDeps;
      deps.agent_backends = {
        resolve_for_mode: vi.fn(() => ({ id: "nb", native_tool_loop: true, capabilities: {} })),
        resolve_backend: vi.fn(),
        run: vi.fn().mockResolvedValue({ content: "__request_user_choice__", tool_calls_count: 0, finish_reason: "stop" }),
        get_session_store: vi.fn(() => null),
      } as any;
      (deps.runtime.run_task_loop as any).mockImplementation(async ({ nodes, task_id, objective, initial_memory }: any) => {
        const memory = { ...initial_memory };
        const exec = await nodes[0].run({
          task_state: { taskId: task_id, objective, status: "running", memory, currentTurn: 0, maxTurns: 20 },
          memory,
        });
        return { state: { status: exec.status ?? "waiting_user_input", memory: exec.memory_patch, currentTurn: 1 } };
      });

      const result = await continue_task_loop(deps, mockRequest, mockTask, "test task", []);
      expect(result.suppress_reply).toBe(true);
    });
  });

  describe("execute 노드 내부 경로 — legacy headless", () => {
    function make_legacy_node_invoker() {
      return vi.fn().mockImplementation(async ({ nodes, task_id, objective, initial_memory }: any) => {
        const memory = { ...initial_memory };
        const exec = await nodes[0].run({
          task_state: { taskId: task_id, objective, status: "running", memory, currentTurn: 0, maxTurns: 20 },
          memory,
        });
        return { state: { status: exec.status ?? "completed", exitReason: exec.exit_reason, memory: exec.memory_patch, currentTurn: 1 } };
      });
    }

    it("legacy 경로 — 정상 응답 → completed", async () => {
      const deps = createMockContinueTaskDeps() as ContinueTaskDeps;
      deps.agent_backends = undefined;
      (deps.runtime.run_agent_loop as any) = vi.fn().mockResolvedValue({ final_content: "legacy output" });
      (deps.runtime.run_task_loop as any).mockImplementation(make_legacy_node_invoker());

      const result = await continue_task_loop(deps, mockRequest, mockTask, "test task", []);

      expect(result.mode).toBe("task");
      // legacy 경로는 next_step_index 없이 status=completed 반환
    });

    it("legacy 경로 — approval_required 포함 → waiting_approval", async () => {
      const deps = createMockContinueTaskDeps() as ContinueTaskDeps;
      deps.agent_backends = undefined;
      (deps.runtime.run_agent_loop as any) = vi.fn().mockResolvedValue({ final_content: "approval_required" });
      (deps.runtime.run_task_loop as any).mockImplementation(make_legacy_node_invoker());

      const result = await continue_task_loop(deps, mockRequest, mockTask, "test task", []);
      expect(result.suppress_reply).toBe(true);
    });

    it("legacy 경로 — __request_user_choice__ 포함 → waiting_user_input", async () => {
      const deps = createMockContinueTaskDeps() as ContinueTaskDeps;
      deps.agent_backends = undefined;
      (deps.runtime.run_agent_loop as any) = vi.fn().mockResolvedValue({ final_content: "__request_user_choice__" });
      (deps.runtime.run_task_loop as any).mockImplementation(make_legacy_node_invoker());

      const result = await continue_task_loop(deps, mockRequest, mockTask, "test task", []);
      expect(result.suppress_reply).toBe(true);
    });

    it("memory.__user_input 있으면 objective에 추가됨", async () => {
      const deps = createMockContinueTaskDeps() as ContinueTaskDeps;
      deps.agent_backends = undefined;
      let capturedObjective: string | undefined;
      (deps.runtime.run_agent_loop as any) = vi.fn().mockImplementation(async (opts: any) => {
        capturedObjective = opts.objective;
        return { final_content: "done" };
      });

      const taskWithUserInput: TaskState = {
        ...mockTask,
        objective: "Base objective",
        memory: { ...mockTask.memory, __user_input: "사용자 응답" },
      };

      // 실제 task.memory를 initial_memory로 전달하여 execute 노드에서 __user_input을 읽도록 함
      (deps.runtime.run_task_loop as any).mockImplementation(async ({ nodes, task_id, objective }: any) => {
        const memory = { ...taskWithUserInput.memory };
        const exec = await nodes[0].run({
          task_state: { taskId: task_id, objective, status: "running", memory, currentTurn: 0, maxTurns: 20 },
          memory,
        });
        return { state: { status: exec.status ?? "completed", exitReason: exec.exit_reason, memory: exec.memory_patch, currentTurn: 1 } };
      });

      await continue_task_loop(deps, mockRequest, taskWithUserInput, "test task", []);
      expect(capturedObjective).toContain("[사용자 응답]");
    });
  });
});
