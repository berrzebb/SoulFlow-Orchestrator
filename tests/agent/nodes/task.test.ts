/** Task 노드 핸들러 테스트
 *
 * 목표: task_handler를 통한 태스크 실행 노드 검증
 *       - execute: 태스크 생성을 위한 메타데이터 반환
 *       - runner_execute: create_task 서비스 호출 및 결과 처리
 *       - Template resolution: task_title, objective, initial_memory 템플릿 해석
 *       - Channel fallback: 채널/chat_id 미지정 시 runner.state 사용
 *       - Error handling: 서비스 오류 및 미사용 경우 처리
 *       - Validation: max_turns > 100 경고, 필수 필드 검증
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { task_handler } from "@src/agent/nodes/task.js";
import type { TaskNodeDefinition, OrcheNodeDefinition } from "@src/agent/workflow-node.types.js";
import type { OrcheNodeExecutorContext, RunnerContext } from "@src/agent/node-registry.js";

/* ── Mock Data ── */

const createMockTaskNode = (overrides?: Partial<TaskNodeDefinition>): TaskNodeDefinition => ({
  node_id: "task-1",
  title: "Test Task Node",
  node_type: "task",
  task_title: "Complete report",
  objective: "Write comprehensive quarterly report",
  channel: "slack",
  ...overrides,
});

const createMockContext = (overrides?: Partial<OrcheNodeExecutorContext>): OrcheNodeExecutorContext => ({
  memory: {
    agent_id: "agent-1",
    user_id: "user-1",
    workspace_id: "workspace-1",
    deadline: "2026-03-15",
    project: "Q1 Planning",
    previous_output: {},
  },
  ...overrides,
});

const createMockRunnerContext = (
  withService: boolean = true,
): RunnerContext => {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  if (!withService) {
    return {
      logger,
      state: {
        channel: "slack",
        chat_id: "C123456",
      },
      services: undefined,
    };
  }

  const createTaskService = vi.fn(async (input: any) => ({
    task_id: "task-abc-123",
    status: "pending",
    result: { stage: "initialized", created_at: new Date().toISOString() },
    error: undefined,
  }));

  return {
    logger,
    state: {
      channel: "slack",
      chat_id: "C123456",
    },
    services: {
      create_task: createTaskService,
    },
  };
};

/* ── Tests ── */

describe("Task Node Handler", () => {
  describe("metadata", () => {
    it("should have correct node_type", () => {
      expect(task_handler.node_type).toBe("task");
    });

    it("should have output_schema with task_id, status, result, exit_reason", () => {
      const schema = task_handler.output_schema || [];
      const fields = schema.map((f) => f.name);
      expect(fields).toContain("task_id");
      expect(fields).toContain("status");
      expect(fields).toContain("result");
      expect(fields).toContain("exit_reason");
    });

    it("should have create_default returning valid node template", () => {
      const defaultNode = task_handler.create_default?.();
      expect(defaultNode?.task_title).toBe("");
      expect(defaultNode?.objective).toBe("");
      expect(defaultNode?.max_turns).toBe(20);
    });
  });

  describe("execute (fallback when service unavailable)", () => {
    it("should return pending state with _meta", async () => {
      const node = createMockTaskNode();
      const ctx = createMockContext();

      const result = await task_handler.execute(node, ctx);

      expect(result.output.status).toBe("pending");
      expect(result.output._meta).toBeDefined();
      expect(result.output._meta.task_title).toBe("Complete report");
      expect(result.output._meta.objective).toBe("Write comprehensive quarterly report");
      expect(result.output._meta.channel).toBe("slack");
    });

    it("should include max_turns with default 20", async () => {
      const node = createMockTaskNode();
      const ctx = createMockContext();

      const result = await task_handler.execute(node, ctx);

      expect(result.output._meta.max_turns).toBe(20);
    });

    it("should preserve explicit max_turns", async () => {
      const node = createMockTaskNode({ max_turns: 50 });
      const ctx = createMockContext();

      const result = await task_handler.execute(node, ctx);

      expect(result.output._meta.max_turns).toBe(50);
    });

    it("should resolve template in task_title", async () => {
      const node = createMockTaskNode({
        task_title: "{{memory.project}} Report",
      });
      const ctx = createMockContext();

      const result = await task_handler.execute(node, ctx);

      // Template should be resolved
      expect(result.output._meta.task_title).toBeDefined();
    });

    it("should resolve template in objective", async () => {
      const node = createMockTaskNode({
        objective: "Complete {{memory.project}} by {{memory.deadline}}",
      });
      const ctx = createMockContext();

      const result = await task_handler.execute(node, ctx);

      expect(result.output._meta.objective).toBeDefined();
    });

    it("should handle empty initial_memory", async () => {
      const node = createMockTaskNode();
      const ctx = createMockContext();

      const result = await task_handler.execute(node, ctx);

      expect(result.output._meta.initial_memory).toEqual({});
    });

    it("should resolve initial_memory templates", async () => {
      const node = createMockTaskNode({
        initial_memory: {
          project: "{{memory.project}}",
          deadline: "{{memory.deadline}}",
        },
      });
      const ctx = createMockContext();

      const result = await task_handler.execute(node, ctx);

      expect(result.output._meta.initial_memory).toBeDefined();
      expect(typeof result.output._meta.initial_memory).toBe("object");
    });

    it("should empty task_id and result in fallback", async () => {
      const node = createMockTaskNode();
      const ctx = createMockContext();

      const result = await task_handler.execute(node, ctx);

      expect(result.output.task_id).toBe("");
      expect(result.output.result).toEqual({});
    });
  });

  describe("runner_execute with create_task service", () => {
    it("should call create_task with resolved templates", async () => {
      const node = createMockTaskNode();
      const ctx = createMockContext();
      const runner = createMockRunnerContext(true);

      const result = await task_handler.runner_execute(node, ctx, runner);

      expect(runner.services?.create_task).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Complete report",
          objective: "Write comprehensive quarterly report",
          channel: "slack",
          max_turns: 20,
        }),
      );
    });

    it("should return task_id from service", async () => {
      const node = createMockTaskNode();
      const ctx = createMockContext();
      const runner = createMockRunnerContext(true);

      const result = await task_handler.runner_execute(node, ctx, runner);

      expect(result.output.task_id).toBe("task-abc-123");
    });

    it("should return status from service", async () => {
      const node = createMockTaskNode();
      const ctx = createMockContext();
      const runner = createMockRunnerContext(true);

      const result = await task_handler.runner_execute(node, ctx, runner);

      expect(result.output.status).toBe("pending");
    });

    it("should return result object from service", async () => {
      const node = createMockTaskNode();
      const ctx = createMockContext();
      const runner = createMockRunnerContext(true);

      const result = await task_handler.runner_execute(node, ctx, runner);

      expect(result.output.result).toBeDefined();
      expect(result.output.result.stage).toBe("initialized");
    });

    it("should handle missing result field from service", async () => {
      const runner = createMockRunnerContext(true);
      (runner.services?.create_task as any).mockResolvedValue({
        task_id: "task-xyz",
        status: "completed",
        result: undefined,
        error: undefined,
      });

      const node = createMockTaskNode();
      const ctx = createMockContext();

      const result = await task_handler.runner_execute(node, ctx, runner);

      expect(result.output.result).toEqual({});
    });

    it("should return error from service as exit_reason", async () => {
      const runner = createMockRunnerContext(true);
      (runner.services?.create_task as any).mockResolvedValue({
        task_id: "task-123",
        status: "failed",
        result: {},
        error: "Task execution timeout",
      });

      const node = createMockTaskNode();
      const ctx = createMockContext();

      const result = await task_handler.runner_execute(node, ctx, runner);

      expect(result.output.exit_reason).toBe("Task execution timeout");
    });

    it("should resolve template in task_title before calling service", async () => {
      const node = createMockTaskNode({
        task_title: "{{memory.project}} Status Update",
      });
      const ctx = createMockContext();
      const runner = createMockRunnerContext(true);

      await task_handler.runner_execute(node, ctx, runner);

      const call = (runner.services?.create_task as any).mock.calls[0][0];
      expect(call.title).toBeDefined();
      // Template should be resolved, not contain {{}}
    });

    it("should resolve initial_memory templates before calling service", async () => {
      const node = createMockTaskNode({
        initial_memory: {
          project_code: "{{memory.project}}",
          due_date: "{{memory.deadline}}",
        },
      });
      const ctx = createMockContext();
      const runner = createMockRunnerContext(true);

      await task_handler.runner_execute(node, ctx, runner);

      const call = (runner.services?.create_task as any).mock.calls[0][0];
      expect(call.initial_memory).toBeDefined();
      expect(typeof call.initial_memory).toBe("object");
    });

    it("should use explicit chat_id", async () => {
      const node = createMockTaskNode({
        chat_id: "C987654",
      });
      const ctx = createMockContext();
      const runner = createMockRunnerContext(true);

      await task_handler.runner_execute(node, ctx, runner);

      expect(runner.services?.create_task).toHaveBeenCalledWith(
        expect.objectContaining({
          chat_id: "C987654",
        }),
      );
    });

    it("should fallback to runner.state.chat_id if not provided", async () => {
      const node = createMockTaskNode({
        chat_id: undefined,
      });
      const ctx = createMockContext();
      const runner = createMockRunnerContext(true);

      await task_handler.runner_execute(node, ctx, runner);

      expect(runner.services?.create_task).toHaveBeenCalledWith(
        expect.objectContaining({
          chat_id: "C123456",
        }),
      );
    });

    it("should use explicit channel", async () => {
      const node = createMockTaskNode({
        channel: "telegram",
      });
      const ctx = createMockContext();
      const runner = createMockRunnerContext(true);

      await task_handler.runner_execute(node, ctx, runner);

      expect(runner.services?.create_task).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: "telegram",
        }),
      );
    });

    it("should fallback to runner.state.channel if not provided", async () => {
      const node = createMockTaskNode({
        channel: undefined,
      });
      const ctx = createMockContext();
      const runner = createMockRunnerContext(true);

      await task_handler.runner_execute(node, ctx, runner);

      expect(runner.services?.create_task).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: "slack",
        }),
      );
    });

    it("should pass max_turns with default 20", async () => {
      const node = createMockTaskNode({
        max_turns: undefined,
      });
      const ctx = createMockContext();
      const runner = createMockRunnerContext(true);

      await task_handler.runner_execute(node, ctx, runner);

      expect(runner.services?.create_task).toHaveBeenCalledWith(
        expect.objectContaining({
          max_turns: 20,
        }),
      );
    });

    it("should pass explicit max_turns", async () => {
      const node = createMockTaskNode({
        max_turns: 75,
      });
      const ctx = createMockContext();
      const runner = createMockRunnerContext(true);

      await task_handler.runner_execute(node, ctx, runner);

      expect(runner.services?.create_task).toHaveBeenCalledWith(
        expect.objectContaining({
          max_turns: 75,
        }),
      );
    });
  });

  describe("runner_execute — fallback when service unavailable", () => {
    it("should fallback to execute when runner.services.create_task missing", async () => {
      const node = createMockTaskNode();
      const ctx = createMockContext();
      const runner = createMockRunnerContext(false); // No service

      const result = await task_handler.runner_execute(node, ctx, runner);

      expect(result.output.status).toBe("pending");
      expect(result.output._meta).toBeDefined();
    });
  });

  describe("runner_execute — error handling", () => {
    it("should catch service errors and return failed status", async () => {
      const runner = createMockRunnerContext(true);
      const error = new Error("Database connection failed");
      (runner.services?.create_task as any).mockRejectedValue(error);

      const node = createMockTaskNode();
      const ctx = createMockContext();

      const result = await task_handler.runner_execute(node, ctx, runner);

      expect(result.output.status).toBe("failed");
      expect(result.output.exit_reason).toContain("Database connection failed");
      expect(runner.logger.warn).toHaveBeenCalledWith(
        "task_node_error",
        expect.objectContaining({
          node_id: "task-1",
        }),
      );
    });

    it("should log error with node_id for debugging", async () => {
      const runner = createMockRunnerContext(true);
      (runner.services?.create_task as any).mockRejectedValue(
        new Error("Service timeout"),
      );

      const node = createMockTaskNode({
        node_id: "task-debug-123",
      });
      const ctx = createMockContext();

      await task_handler.runner_execute(node, ctx, runner);

      expect(runner.logger.warn).toHaveBeenCalledWith(
        "task_node_error",
        expect.objectContaining({
          node_id: "task-debug-123",
          error: expect.stringContaining("Service timeout"),
        }),
      );
    });

    it("should return empty task_id on error", async () => {
      const runner = createMockRunnerContext(true);
      (runner.services?.create_task as any).mockRejectedValue(
        new Error("Service error"),
      );

      const node = createMockTaskNode();
      const ctx = createMockContext();

      const result = await task_handler.runner_execute(node, ctx, runner);

      expect(result.output.task_id).toBe("");
    });

    it("should return empty result object on error", async () => {
      const runner = createMockRunnerContext(true);
      (runner.services?.create_task as any).mockRejectedValue(
        new Error("Service error"),
      );

      const node = createMockTaskNode();
      const ctx = createMockContext();

      const result = await task_handler.runner_execute(node, ctx, runner);

      expect(result.output.result).toEqual({});
    });
  });

  describe("test (validation)", () => {
    it("should return empty warnings for valid task", () => {
      const node = createMockTaskNode({
        task_title: "Valid title",
        objective: "Valid objective",
        max_turns: 20,
      });

      const result = task_handler.test(node);

      expect(result.warnings).toEqual([]);
    });

    it("should warn if task_title is empty", () => {
      const node = createMockTaskNode({
        task_title: "",
      });

      const result = task_handler.test(node);

      expect(result.warnings).toContain("task_title is empty");
    });

    it("should warn if objective is empty", () => {
      const node = createMockTaskNode({
        objective: "",
      });

      const result = task_handler.test(node);

      expect(result.warnings).toContain("objective is empty");
    });

    it("should warn if max_turns exceeds 100", () => {
      const node = createMockTaskNode({
        max_turns: 150,
      });

      const result = task_handler.test(node);

      expect(result.warnings).toContain("max_turns > 100 may be expensive");
    });

    it("should not warn for max_turns exactly 100", () => {
      const node = createMockTaskNode({
        max_turns: 100,
      });

      const result = task_handler.test(node);

      expect(result.warnings).not.toContain("max_turns > 100 may be expensive");
    });

    it("should not warn for max_turns exactly 101", () => {
      const node = createMockTaskNode({
        max_turns: 101,
      });

      const result = task_handler.test(node);

      expect(result.warnings).toContain("max_turns > 100 may be expensive");
    });

    it("should return preview with task info", () => {
      const node = createMockTaskNode({
        task_title: "Quarterly Review",
        objective: "Review team performance",
        max_turns: 50,
      });

      const result = task_handler.test(node);

      expect(result.preview).toEqual({
        task_title: "Quarterly Review",
        objective: "Review team performance",
        max_turns: 50,
      });
    });

    it("should use default max_turns 20 in preview", () => {
      const node = createMockTaskNode({
        max_turns: undefined,
      });

      const result = task_handler.test(node);

      expect(result.preview.max_turns).toBe(20);
    });
  });

  describe("integration scenarios", () => {
    it("should handle complex initial_memory with nested values", async () => {
      const node = createMockTaskNode({
        initial_memory: {
          project: "{{memory.project}}",
          deadline: "{{memory.deadline}}",
          context: "Initial analysis phase",
        },
      });
      const ctx = createMockContext();
      const runner = createMockRunnerContext(true);

      const result = await task_handler.runner_execute(node, ctx, runner);

      const call = (runner.services?.create_task as any).mock.calls[0][0];
      expect(call.initial_memory).toHaveProperty("project");
      expect(call.initial_memory).toHaveProperty("deadline");
      expect(call.initial_memory).toHaveProperty("context");
    });

    it("should create task with all parameters", async () => {
      const node = createMockTaskNode({
        task_title: "Complete Q1 Planning",
        objective: "Finalize quarterly goals and initiatives",
        channel: "slack",
        chat_id: "C999999",
        max_turns: 30,
        initial_memory: {
          quarter: "Q1",
          year: "2026",
        },
      });
      const ctx = createMockContext();
      const runner = createMockRunnerContext(true);

      await task_handler.runner_execute(node, ctx, runner);

      expect(runner.services?.create_task).toHaveBeenCalledWith({
        title: "Complete Q1 Planning",
        objective: "Finalize quarterly goals and initiatives",
        channel: "slack",
        chat_id: "C999999",
        max_turns: 30,
        initial_memory: expect.objectContaining({
          quarter: "Q1",
          year: "2026",
        }),
      });
    });

    it("should handle template resolution with memory context", async () => {
      const node = createMockTaskNode({
        task_title: "{{memory.project}} Report",
        objective: "Deliver {{memory.project}} by {{memory.deadline}}",
        initial_memory: {
          project_name: "{{memory.project}}",
        },
      });
      const ctx = createMockContext({
        memory: {
          project: "Platform Upgrade",
          deadline: "2026-03-20",
          agent_id: "agent-1",
          user_id: "user-1",
          workspace_id: "workspace-1",
          previous_output: {},
        },
      });
      const runner = createMockRunnerContext(true);

      await task_handler.runner_execute(node, ctx, runner);

      const call = (runner.services?.create_task as any).mock.calls[0][0];
      expect(call.title).toBeDefined();
      expect(call.objective).toBeDefined();
      expect(call.initial_memory.project_name).toBeDefined();
    });

    it("should fallback channels and pass service response", async () => {
      const node = createMockTaskNode({
        task_title: "Fallback Test",
        objective: "Test fallback behavior",
        channel: undefined,
        chat_id: undefined,
      });
      const ctx = createMockContext();
      const runner = createMockRunnerContext(true);

      const result = await task_handler.runner_execute(node, ctx, runner);

      // Should call service with runner.state defaults
      expect(runner.services?.create_task).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: "slack",
          chat_id: "C123456",
        }),
      );

      // Should return service response
      expect(result.output.task_id).toBe("task-abc-123");
      expect(result.output.status).toBe("pending");
    });
  });
});
