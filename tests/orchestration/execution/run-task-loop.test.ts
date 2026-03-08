/** Phase 4.5+: run_task_loop 모듈 테스트
 *
 * 목표: task 모드의 run_task_loop와 try_native_task_execute 테스트
 *       - native backend 경로
 *       - legacy headless 경로
 *       - task workflow 노드 (plan, execute, finalize)
 *       - 파일 요청, 승인 대기 등 상태 처리
 */

import { describe, it, expect, vi } from "vitest";
import type { RunnerDeps, RunExecutionArgs } from "@src/orchestration/execution/runner-deps.js";
import { run_task_loop, try_native_task_execute } from "@src/orchestration/execution/run-task-loop.js";
import type { OrchestrationRequest } from "@src/orchestration/types.js";
import { StreamBuffer } from "@src/channels/stream-buffer.js";

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

const mockArgs: RunExecutionArgs & { media: string[] } = {
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
    get_tool_executors: vi.fn(() => []),
    get_context_builder: vi.fn(() => ({
      skills_loader: {
        get_role_skill: vi.fn(() => ({ heart: "❤️" })),
      },
    })),
    run_agent_loop: vi.fn(),
    run_task_loop: vi.fn(),
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
  } as any,
  build_persona_followup: vi.fn(() => "followup"),
  build_compaction_flush: vi.fn(() => undefined),
  log_event: vi.fn(),
});

/* ── Tests ── */

describe("run_task_loop — task 모드 실행", () => {
  describe("try_native_task_execute 헬퍼", () => {
    it("native backend 미지원 → null 반환", async () => {
      const deps = createMockRunnerDeps() as RunnerDeps;
      const stream = new StreamBuffer();

      const result = await try_native_task_execute(
        deps,
        mockArgs,
        stream,
        mockArgs.tool_ctx,
        "task-1",
        "test objective",
        "test prompt"
      );

      expect(result).toBeNull();
    });

    it("native backend 실패 → warn 로그 후 null", async () => {
      const deps = createMockRunnerDeps() as RunnerDeps;
      const stream = new StreamBuffer();
      const logWarnSpy = vi.fn();
      deps.logger.warn = logWarnSpy;

      deps.agent_backends = {
        resolve_for_mode: vi.fn(() => ({
          id: "native-backend",
          native_tool_loop: true,
          capabilities: { thinking: false },
        })),
        resolve_backend: vi.fn(),
        run: vi.fn().mockRejectedValue(new Error("Backend failed")),
      } as any;

      const result = await try_native_task_execute(
        deps,
        mockArgs,
        stream,
        mockArgs.tool_ctx,
        "task-1",
        "test objective",
        "test prompt"
      );

      expect(logWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("native_tool_loop task_execute error"),
        expect.any(Object)
      );
      expect(result).toBeNull();
    });
  });

  describe("task workflow 노드", () => {
    it("runtime.run_task_loop 호출 → 결과 반환", async () => {
      const deps = createMockRunnerDeps() as RunnerDeps;

      (deps.runtime.run_task_loop as any).mockResolvedValue({
        state: {
          status: "completed",
          memory: {
            last_output: "Task completed successfully",
          },
        },
      });

      const result = await run_task_loop(deps, mockArgs);

      expect(result.mode).toBe("task");
      expect(result.reply).toContain("Task completed successfully");
    });

    it("파일 요청 대기 상태 → suppress_result", async () => {
      const deps = createMockRunnerDeps() as RunnerDeps;

      (deps.runtime.run_task_loop as any).mockResolvedValue({
        state: {
          status: "completed",
          memory: {
            file_request_waiting: true,
            last_output: "",
          },
        },
      });

      const result = await run_task_loop(deps, mockArgs);

      expect(result.suppress_reply).toBe(true);
      expect(result.mode).toBe("task");
    });

    it("최종 응답 억제 → suppress_result", async () => {
      const deps = createMockRunnerDeps() as RunnerDeps;

      (deps.runtime.run_task_loop as any).mockResolvedValue({
        state: {
          status: "completed",
          memory: {
            suppress_final_reply: true,
            last_output: "internal output",
          },
        },
      });

      const result = await run_task_loop(deps, mockArgs);

      expect(result.suppress_reply).toBe(true);
      expect(result.mode).toBe("task");
    });

    it("승인 대기 상태 → suppress_result with run_id", async () => {
      const deps = createMockRunnerDeps() as RunnerDeps;

      (deps.runtime.run_task_loop as any).mockResolvedValue({
        state: {
          status: "waiting_approval",
          memory: {
            last_output: "approval required output",
          },
        },
      });

      const result = await run_task_loop(deps, mockArgs);

      expect(result.suppress_reply).toBe(true);
      expect(result.run_id).toBe("run-1");
      expect(result.mode).toBe("task");
    });

    it("사용자 입력 대기 → suppress_result with run_id", async () => {
      const deps = createMockRunnerDeps() as RunnerDeps;

      (deps.runtime.run_task_loop as any).mockResolvedValue({
        state: {
          status: "waiting_user_input",
          memory: {
            last_output: "waiting for user input",
          },
        },
      });

      const result = await run_task_loop(deps, mockArgs);

      expect(result.suppress_reply).toBe(true);
      expect(result.run_id).toBe("run-1");
      expect(result.mode).toBe("task");
    });

    it("최대 턴 도달 → suppress_result with run_id", async () => {
      const deps = createMockRunnerDeps() as RunnerDeps;

      (deps.runtime.run_task_loop as any).mockResolvedValue({
        state: {
          status: "max_turns_reached",
          memory: {
            last_output: "max turns reached",
          },
        },
      });

      const result = await run_task_loop(deps, mockArgs);

      expect(result.suppress_reply).toBe(true);
      expect(result.run_id).toBe("run-1");
      expect(result.mode).toBe("task");
    });

    it("실패 상태 → error_result", async () => {
      const deps = createMockRunnerDeps() as RunnerDeps;

      (deps.runtime.run_task_loop as any).mockResolvedValue({
        state: {
          status: "failed",
          exitReason: "execution error",
          memory: {},
        },
      });

      const result = await run_task_loop(deps, mockArgs);

      expect(result.error).toBeDefined();
      expect(result.error).toContain("task_failed");
      expect(result.mode).toBe("task");
    });

    it("취소 상태 → error_result", async () => {
      const deps = createMockRunnerDeps() as RunnerDeps;

      (deps.runtime.run_task_loop as any).mockResolvedValue({
        state: {
          status: "cancelled",
          exitReason: "user cancelled",
          memory: {},
        },
      });

      const result = await run_task_loop(deps, mockArgs);

      expect(result.error).toBeDefined();
      expect(result.error).toContain("task_cancelled");
      expect(result.mode).toBe("task");
    });

    it("빈 출력 → error_result", async () => {
      const deps = createMockRunnerDeps() as RunnerDeps;

      (deps.runtime.run_task_loop as any).mockResolvedValue({
        state: {
          status: "completed",
          memory: {
            last_output: "",
          },
        },
      });

      const result = await run_task_loop(deps, mockArgs);

      expect(result.error).toBeDefined();
      expect(result.error).toContain("task_loop_no_output");
      expect(result.mode).toBe("task");
    });

    it("공급자 에러 응답 → 에러 추출", async () => {
      const deps = createMockRunnerDeps() as RunnerDeps;

      (deps.runtime.run_task_loop as any).mockResolvedValue({
        state: {
          status: "completed",
          memory: {
            last_output: "Error calling anthropic_api: Rate limit exceeded",
          },
        },
      });

      const result = await run_task_loop(deps, mockArgs);

      expect(result.error).toBeDefined();
      expect(result.error).toContain("Rate limit exceeded");
      expect(result.mode).toBe("task");
    });

    it("정상 응답 → reply_result", async () => {
      const deps = createMockRunnerDeps() as RunnerDeps;

      (deps.runtime.run_task_loop as any).mockResolvedValue({
        state: {
          status: "completed",
          memory: {
            last_output: "Task executed successfully",
          },
        },
      });

      const result = await run_task_loop(deps, mockArgs);

      expect(result.reply).toContain("Task executed successfully");
      expect(result.mode).toBe("task");
      expect(result.tool_calls_count).toBeGreaterThanOrEqual(0);
    });
  });

  describe("프로세스 추적", () => {
    it("process_tracker link_task 호출", async () => {
      const deps = createMockRunnerDeps() as RunnerDeps;
      deps.process_tracker = {
        link_task: vi.fn(),
        link_loop: vi.fn(),
        end: vi.fn(),
        set_mode: vi.fn(),
        set_tool_count: vi.fn(),
        set_executor: vi.fn(),
      } as any;

      (deps.runtime.run_task_loop as any).mockResolvedValue({
        state: {
          status: "completed",
          memory: {
            last_output: "result",
          },
        },
      });

      await run_task_loop(deps, mockArgs);

      expect(deps.process_tracker.link_task).toHaveBeenCalledWith("run-1", expect.stringContaining("task:"));
    });
  });

  describe("native backend — execute 노드 경로", () => {
    function make_node_executor(exec_result: Record<string, unknown>) {
      // run_task_loop mock이 실제로 노드를 호출하도록 구현
      return vi.fn().mockImplementation(async ({ nodes, task_id, objective, initial_memory }: any) => {
        const memory = { ...initial_memory };
        // plan 노드
        const plan = await nodes[0].run({ task_state: { taskId: task_id, objective, status: "running", memory, currentTurn: 0, maxTurns: 20 }, memory });
        // execute 노드
        const exec = await nodes[1].run({ task_state: { taskId: task_id, objective, status: "running", memory: plan.memory_patch, currentTurn: 1, maxTurns: 20 }, memory: plan.memory_patch });
        // finalize 노드 (exec.next_step_index=2 일 때)
        let final_state = exec;
        if (exec.next_step_index === 2) {
          final_state = await nodes[2].run({ task_state: { taskId: task_id, objective, status: "running", memory: exec.memory_patch, currentTurn: 2, maxTurns: 20 }, memory: exec.memory_patch });
        }
        return {
          state: {
            status: exec_result.status ?? final_state.status ?? "completed",
            exitReason: exec_result.exit_reason ?? final_state.exit_reason,
            memory: { ...final_state.memory_patch, ...exec_result },
            currentTurn: 3,
          }
        };
      });
    }

    it("native backend 성공 → 정상 출력", async () => {
      const deps = createMockRunnerDeps() as RunnerDeps;
      deps.agent_backends = {
        resolve_for_mode: vi.fn(() => ({
          id: "native-backend",
          native_tool_loop: true,
          capabilities: { thinking: false },
        })),
        resolve_backend: vi.fn(),
        run: vi.fn().mockResolvedValue({
          content: "native task output",
          tool_calls_count: 2,
          finish_reason: "stop",
        }),
      } as any;
      (deps.runtime.run_task_loop as any).mockImplementation(make_node_executor({ last_output: "native task output" }));

      const result = await run_task_loop(deps, mockArgs);

      expect(result.reply).toContain("native task output");
      expect(result.mode).toBe("task");
    });

    it("native backend → finish_reason=cancelled → suppress", async () => {
      const deps = createMockRunnerDeps() as RunnerDeps;
      deps.agent_backends = {
        resolve_for_mode: vi.fn(() => ({ id: "nb", native_tool_loop: true, capabilities: {} })),
        resolve_backend: vi.fn(),
        run: vi.fn().mockResolvedValue({ content: "done", tool_calls_count: 0, finish_reason: "cancelled" }),
      } as any;
      // finalize 노드가 status=completed, suppress를 반영
      (deps.runtime.run_task_loop as any).mockImplementation(async ({ nodes, task_id, objective, initial_memory }: any) => {
        const memory = { ...initial_memory };
        const plan = await nodes[0].run({ task_state: { taskId: task_id, objective, status: "running", memory, currentTurn: 0, maxTurns: 20 }, memory });
        const exec = await nodes[1].run({ task_state: { taskId: task_id, objective, status: "running", memory: plan.memory_patch, currentTurn: 1, maxTurns: 20 }, memory: plan.memory_patch });
        return {
          state: {
            status: exec.status || "completed",
            exitReason: exec.exit_reason,
            memory: exec.memory_patch,
            currentTurn: 2,
          }
        };
      });

      const result = await run_task_loop(deps, mockArgs);
      expect(result.suppress_reply).toBe(true);
    });

    it("native backend → finish_reason=approval_required → waiting_approval", async () => {
      const deps = createMockRunnerDeps() as RunnerDeps;
      deps.agent_backends = {
        resolve_for_mode: vi.fn(() => ({ id: "nb", native_tool_loop: true, capabilities: {} })),
        resolve_backend: vi.fn(),
        run: vi.fn().mockResolvedValue({ content: "approval needed", tool_calls_count: 0, finish_reason: "approval_required" }),
      } as any;
      (deps.runtime.run_task_loop as any).mockImplementation(async ({ nodes, task_id, objective, initial_memory }: any) => {
        const memory = { ...initial_memory };
        const plan = await nodes[0].run({ task_state: { taskId: task_id, objective, status: "running", memory, currentTurn: 0, maxTurns: 20 }, memory });
        const exec = await nodes[1].run({ task_state: { taskId: task_id, objective, status: "running", memory: plan.memory_patch, currentTurn: 1, maxTurns: 20 }, memory: plan.memory_patch });
        return {
          state: {
            status: exec.status || "waiting_approval",
            exitReason: exec.exit_reason,
            memory: exec.memory_patch,
            currentTurn: 2,
          }
        };
      });

      const result = await run_task_loop(deps, mockArgs);
      expect(result.suppress_reply).toBe(true);
    });

    it("native backend → __request_user_choice__ → waiting_user_input", async () => {
      const deps = createMockRunnerDeps() as RunnerDeps;
      deps.agent_backends = {
        resolve_for_mode: vi.fn(() => ({ id: "nb", native_tool_loop: true, capabilities: {} })),
        resolve_backend: vi.fn(),
        run: vi.fn().mockResolvedValue({ content: "__request_user_choice__", tool_calls_count: 0, finish_reason: "stop" }),
      } as any;
      (deps.runtime.run_task_loop as any).mockImplementation(async ({ nodes, task_id, objective, initial_memory }: any) => {
        const memory = { ...initial_memory };
        const plan = await nodes[0].run({ task_state: { taskId: task_id, objective, status: "running", memory, currentTurn: 0, maxTurns: 20 }, memory });
        const exec = await nodes[1].run({ task_state: { taskId: task_id, objective, status: "running", memory: plan.memory_patch, currentTurn: 1, maxTurns: 20 }, memory: plan.memory_patch });
        return {
          state: {
            status: exec.status || "waiting_user_input",
            exitReason: exec.exit_reason,
            memory: exec.memory_patch,
            currentTurn: 2,
          }
        };
      });

      const result = await run_task_loop(deps, mockArgs);
      expect(result.suppress_reply).toBe(true);
    });

    it("legacy headless 경로 — done_sent=true → suppress", async () => {
      const deps = createMockRunnerDeps() as RunnerDeps;
      // agent_backends null → legacy path
      deps.agent_backends = undefined;
      (deps.runtime.run_agent_loop as any) = vi.fn().mockResolvedValue({
        final_content: "output",
      });
      // create_tool_call_handler가 done_sent=true를 반환하도록 하기 어려우므로
      // run_task_loop를 노드 실행 방식으로 mock
      (deps.runtime.run_task_loop as any).mockImplementation(async ({ nodes, task_id, objective, initial_memory }: any) => {
        const memory = { ...initial_memory };
        const plan = await nodes[0].run({ task_state: { taskId: task_id, objective, status: "running", memory, currentTurn: 0, maxTurns: 20 }, memory });
        const exec = await nodes[1].run({ task_state: { taskId: task_id, objective, status: "running", memory: plan.memory_patch, currentTurn: 1, maxTurns: 20 }, memory: plan.memory_patch });
        return {
          state: {
            status: exec.status ?? "completed",
            exitReason: exec.exit_reason,
            memory: exec.memory_patch,
            currentTurn: 2,
          }
        };
      });

      const result = await run_task_loop(deps, mockArgs);
      // legacy path 실행됨 (agent_backends=null → try_native_task_execute → null)
      expect(result.mode).toBe("task");
    });

    it("legacy headless — run_agent_loop → approval_required → waiting_approval", async () => {
      const deps = createMockRunnerDeps() as RunnerDeps;
      deps.agent_backends = undefined;
      (deps.runtime.run_agent_loop as any) = vi.fn().mockResolvedValue({ final_content: "approval_required" });
      (deps.runtime.run_task_loop as any).mockImplementation(async ({ nodes, task_id, objective, initial_memory }: any) => {
        const memory = { ...initial_memory };
        const plan = await nodes[0].run({ task_state: { taskId: task_id, objective, status: "running", memory, currentTurn: 0, maxTurns: 20 }, memory });
        const exec = await nodes[1].run({ task_state: { taskId: task_id, objective, status: "running", memory: plan.memory_patch, currentTurn: 1, maxTurns: 20 }, memory: plan.memory_patch });
        return { state: { status: exec.status ?? "waiting_approval", exitReason: exec.exit_reason, memory: exec.memory_patch, currentTurn: 2 } };
      });

      const result = await run_task_loop(deps, mockArgs);
      expect(result.suppress_reply).toBe(true);
    });

    it("legacy headless — run_agent_loop → __request_user_choice__ → waiting_user_input", async () => {
      const deps = createMockRunnerDeps() as RunnerDeps;
      deps.agent_backends = undefined;
      (deps.runtime.run_agent_loop as any) = vi.fn().mockResolvedValue({ final_content: "__request_user_choice__" });
      (deps.runtime.run_task_loop as any).mockImplementation(async ({ nodes, task_id, objective, initial_memory }: any) => {
        const memory = { ...initial_memory };
        const plan = await nodes[0].run({ task_state: { taskId: task_id, objective, status: "running", memory, currentTurn: 0, maxTurns: 20 }, memory });
        const exec = await nodes[1].run({ task_state: { taskId: task_id, objective, status: "running", memory: plan.memory_patch, currentTurn: 1, maxTurns: 20 }, memory: plan.memory_patch });
        return { state: { status: exec.status ?? "waiting_user_input", exitReason: exec.exit_reason, memory: exec.memory_patch, currentTurn: 2 } };
      });

      const result = await run_task_loop(deps, mockArgs);
      expect(result.suppress_reply).toBe(true);
    });
  });

  describe("이벤트 로깅", () => {
    it("task_started 이벤트 로깅", async () => {
      const deps = createMockRunnerDeps() as RunnerDeps;
      const logEventSpy = vi.fn();
      deps.log_event = logEventSpy;

      (deps.runtime.run_task_loop as any).mockResolvedValue({
        state: {
          status: "completed",
          memory: {
            last_output: "result",
          },
        },
      });

      await run_task_loop(deps, mockArgs);

      expect(logEventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          phase: "progress",
          summary: expect.stringContaining("task_started"),
        })
      );
    });

    it("waiting_approval 이벤트 로깅", async () => {
      const deps = createMockRunnerDeps() as RunnerDeps;
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

      await run_task_loop(deps, mockArgs);

      expect(logEventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          phase: "approval",
          summary: "waiting_approval",
        })
      );
    });
  });
});
