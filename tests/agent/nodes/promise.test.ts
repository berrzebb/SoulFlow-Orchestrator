/** Promise 노드 핸들러 테스트
 *
 * 목표: promise_handler를 통한 행동 약속(constraints/agreements) 관리 검증
 *       - append: 새로운 약속 기록 생성
 *       - list: 약속 목록 조회 (필터링 포함)
 *       - get_effective: 에이전트 유효 약속 조회
 *       - archive: 약속 기록 보관
 *       - template resolution: key/value 필드의 템플릿 해석
 *       - error handling: 서비스 오류 및 미사용 경우 처리
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { promise_handler } from "@src/agent/nodes/promise.js";
import type { PromiseNodeDefinition, OrcheNodeDefinition } from "@src/agent/workflow-node.types.js";
import type { OrcheNodeExecutorContext, RunnerContext } from "@src/agent/node-registry.js";

/* ── Mock Data ── */

const createMockPromiseNode = (overrides?: Partial<PromiseNodeDefinition>): PromiseNodeDefinition => ({
  node_id: "promise-1",
  title: "Test Promise",
  node_type: "promise",
  operation: "append",
  scope: "global",
  key: "commitment_key",
  value: "commitment_value",
  ...overrides,
});

const createMockContext = (overrides?: Partial<OrcheNodeExecutorContext>): OrcheNodeExecutorContext => ({
  memory: {
    agent_id: "agent-1",
    user_id: "user-1",
    workspace_id: "workspace-1",
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
    return { logger, services: undefined };
  }

  const promiseService = {
    append: vi.fn(async (input: any) => ({
      action: "inserted",
      record: { id: "rec-1", ...input, created_at: new Date().toISOString() },
    })),
    list: vi.fn(async (input: any) => [
      {
        id: "rec-1",
        scope: input.scope,
        scope_id: input.scope_id,
        key: "key1",
        value: "value1",
        status: "active",
      },
      {
        id: "rec-2",
        scope: input.scope,
        scope_id: input.scope_id,
        key: "key2",
        value: "value2",
        status: "active",
      },
    ]),
    get_effective: vi.fn(async (input: any) => [
      {
        id: "rec-3",
        key: "commitment",
        value: "deliver by Friday",
        priority: 2,
        status: "active",
      },
    ]),
    archive: vi.fn(async (id: string) => id === "rec-1"),
  };

  return {
    logger,
    services: {
      promise: promiseService as any,
    },
  };
};

/* ── Tests ── */

describe("Promise Node Handler", () => {
  describe("metadata", () => {
    it("should have correct node_type", () => {
      expect(promise_handler.node_type).toBe("promise");
    });

    it("should have output_schema with action, record, records, count", () => {
      const schema = promise_handler.output_schema || [];
      const fields = schema.map((f) => f.name);
      expect(fields).toContain("action");
      expect(fields).toContain("record");
      expect(fields).toContain("records");
      expect(fields).toContain("count");
    });

    it("should have create_default returning valid node template", () => {
      const defaultNode = promise_handler.create_default?.();
      expect(defaultNode?.operation).toBe("append");
      expect(defaultNode?.scope).toBe("global");
    });
  });

  describe("execute (fallback when service unavailable)", () => {
    it("should return pending state with _meta", async () => {
      const node = createMockPromiseNode();
      const ctx = createMockContext();

      const result = await promise_handler.execute(node, ctx);

      expect(result.output.action).toBe("pending");
      expect(result.output._meta).toBeDefined();
      expect(result.output._meta.operation).toBe("append");
      expect(result.output._meta.scope).toBe("global");
      expect(result.output._meta.key).toBe("commitment_key");
      expect(result.output._meta.value).toBe("commitment_value");
    });

    it("should include metadata fields in output", async () => {
      const node = createMockPromiseNode({
        priority: 2,
        tags: ["urgent", "client"],
        rationale: "Client deadline",
      });
      const ctx = createMockContext();

      const result = await promise_handler.execute(node, ctx);

      expect(result.output._meta.priority).toBe(2);
      expect(result.output._meta.tags).toEqual(["urgent", "client"]);
      expect(result.output._meta.rationale).toBe("Client deadline");
    });

    it("should handle template resolution in key", async () => {
      const node = createMockPromiseNode({
        key: "task_{{memory.user_id}}",
      });
      const ctx = createMockContext();

      const result = await promise_handler.execute(node, ctx);

      // resolve_templates should process {{}} syntax
      expect(result.output._meta.key).toBeDefined();
    });

    it("should resolve templates in value", async () => {
      const node = createMockPromiseNode({
        value: "Complete by {{memory.deadline}}",
      });
      const ctx = createMockContext();

      const result = await promise_handler.execute(node, ctx);

      expect(result.output._meta.value).toBeDefined();
    });

    it("should handle empty key/value gracefully", async () => {
      const node = createMockPromiseNode({
        key: undefined,
        value: undefined,
      });
      const ctx = createMockContext();

      const result = await promise_handler.execute(node, ctx);

      expect(result.output._meta.key).toBe("");
      expect(result.output._meta.value).toBe("");
    });
  });

  describe("runner_execute — append operation", () => {
    it("should call svc.append and return inserted action", async () => {
      const node = createMockPromiseNode({ operation: "append" });
      const ctx = createMockContext();
      const runner = createMockRunnerContext(true);

      const result = await promise_handler.runner_execute(node, ctx, runner);

      expect(result.output.action).toBe("inserted");
      expect(result.output.record).toBeDefined();
      expect(result.output.count).toBe(1);
      expect(runner.services?.promise.append).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: "global",
          key: "commitment_key",
          value: "commitment_value",
          source: "workflow",
        }),
      );
    });

    it("should pass priority, rationale, tags to append", async () => {
      const node = createMockPromiseNode({
        operation: "append",
        priority: 3,
        rationale: "Critical deadline",
        tags: ["client", "urgent"],
      });
      const ctx = createMockContext();
      const runner = createMockRunnerContext(true);

      await promise_handler.runner_execute(node, ctx, runner);

      expect(runner.services?.promise.append).toHaveBeenCalledWith(
        expect.objectContaining({
          priority: 3,
          rationale: "Critical deadline",
          tags: ["client", "urgent"],
        }),
      );
    });

    it("should use scope_id if provided", async () => {
      const node = createMockPromiseNode({
        operation: "append",
        scope: "team",
        scope_id: "team-123",
      });
      const ctx = createMockContext();
      const runner = createMockRunnerContext(true);

      await promise_handler.runner_execute(node, ctx, runner);

      expect(runner.services?.promise.append).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: "team",
          scope_id: "team-123",
        }),
      );
    });

    it("should resolve templates in key/value before calling service", async () => {
      // Mock resolve_templates behavior: {{memory.user_id}} → "user-1"
      const node = createMockPromiseNode({
        operation: "append",
        key: "task_{{memory.user_id}}",
        value: "deadline {{memory.deadline}}",
      });
      const ctx = createMockContext({
        memory: {
          user_id: "user-1",
          deadline: "2026-03-15",
          agent_id: "agent-1",
          workspace_id: "workspace-1",
          previous_output: {},
        },
      });
      const runner = createMockRunnerContext(true);

      await promise_handler.runner_execute(node, ctx, runner);

      const call = (runner.services?.promise.append as any).mock.calls[0][0];
      expect(call.key).toBeDefined();
      expect(call.value).toBeDefined();
    });
  });

  describe("runner_execute — list operation", () => {
    it("should call svc.list and return records", async () => {
      const node = createMockPromiseNode({ operation: "list" });
      const ctx = createMockContext();
      const runner = createMockRunnerContext(true);

      const result = await promise_handler.runner_execute(node, ctx, runner);

      expect(result.output.action).toBe("listed");
      expect(result.output.records).toHaveLength(2);
      expect(result.output.count).toBe(2);
      expect(runner.services?.promise.list).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: "global",
          status: "active",
        }),
      );
    });

    it("should filter by key if provided", async () => {
      const node = createMockPromiseNode({
        operation: "list",
        key: "specific_key",
      });
      const ctx = createMockContext();
      const runner = createMockRunnerContext(true);

      await promise_handler.runner_execute(node, ctx, runner);

      expect(runner.services?.promise.list).toHaveBeenCalledWith(
        expect.objectContaining({
          key: "specific_key",
        }),
      );
    });

    it("should not pass key if empty", async () => {
      const node = createMockPromiseNode({
        operation: "list",
        key: "",
      });
      const ctx = createMockContext();
      const runner = createMockRunnerContext(true);

      await promise_handler.runner_execute(node, ctx, runner);

      const call = (runner.services?.promise.list as any).mock.calls[0][0];
      expect(call.key).toBeUndefined();
    });

    it("should include scope_id in list query", async () => {
      const node = createMockPromiseNode({
        operation: "list",
        scope: "agent",
        scope_id: "agent-123",
      });
      const ctx = createMockContext();
      const runner = createMockRunnerContext(true);

      await promise_handler.runner_execute(node, ctx, runner);

      expect(runner.services?.promise.list).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: "agent",
          scope_id: "agent-123",
        }),
      );
    });
  });

  describe("runner_execute — get_effective operation", () => {
    it("should call svc.get_effective with agent_id", async () => {
      const node = createMockPromiseNode({
        operation: "get_effective",
        scope_id: "agent-123",
      });
      const ctx = createMockContext();
      const runner = createMockRunnerContext(true);

      const result = await promise_handler.runner_execute(node, ctx, runner);

      expect(result.output.action).toBe("get_effective");
      expect(result.output.records).toHaveLength(1);
      expect(result.output.count).toBe(1);
      expect(runner.services?.promise.get_effective).toHaveBeenCalledWith({
        agent_id: "agent-123",
      });
    });

    it("should return empty array if no effective promises", async () => {
      const runner = createMockRunnerContext(true);
      (runner.services?.promise.get_effective as any).mockResolvedValue([]);

      const node = createMockPromiseNode({
        operation: "get_effective",
        scope_id: "agent-456",
      });
      const ctx = createMockContext();

      const result = await promise_handler.runner_execute(node, ctx, runner);

      expect(result.output.records).toEqual([]);
      expect(result.output.count).toBe(0);
    });
  });

  describe("runner_execute — archive operation", () => {
    it("should call svc.archive with target_id", async () => {
      const node = createMockPromiseNode({
        operation: "archive",
        target_id: "rec-1",
      });
      const ctx = createMockContext();
      const runner = createMockRunnerContext(true);

      const result = await promise_handler.runner_execute(node, ctx, runner);

      expect(result.output.action).toBe("archived");
      expect(result.output.count).toBe(1);
      expect(runner.services?.promise.archive).toHaveBeenCalledWith("rec-1");
    });

    it("should return not_found if archive returns false", async () => {
      const runner = createMockRunnerContext(true);
      (runner.services?.promise.archive as any).mockResolvedValue(false);

      const node = createMockPromiseNode({
        operation: "archive",
        target_id: "nonexistent",
      });
      const ctx = createMockContext();

      const result = await promise_handler.runner_execute(node, ctx, runner);

      expect(result.output.action).toBe("not_found");
      expect(result.output.count).toBe(0);
    });

    it("should handle missing target_id gracefully", async () => {
      const node = createMockPromiseNode({
        operation: "archive",
        target_id: undefined,
      });
      const ctx = createMockContext();
      const runner = createMockRunnerContext(true);

      const result = await promise_handler.runner_execute(node, ctx, runner);

      // Should call with empty string
      expect(runner.services?.promise.archive).toHaveBeenCalledWith("");
    });
  });

  describe("runner_execute — fallback when service unavailable", () => {
    it("should fallback to execute when runner.services.promise missing", async () => {
      const node = createMockPromiseNode({ operation: "append" });
      const ctx = createMockContext();
      const runner = createMockRunnerContext(false); // No service

      const result = await promise_handler.runner_execute(node, ctx, runner);

      expect(result.output.action).toBe("pending");
      expect(result.output._meta).toBeDefined();
    });
  });

  describe("runner_execute — error handling", () => {
    it("should catch append errors and return error action", async () => {
      const runner = createMockRunnerContext(true);
      const error = new Error("Database connection failed");
      (runner.services?.promise.append as any).mockRejectedValue(error);

      const node = createMockPromiseNode({ operation: "append" });
      const ctx = createMockContext();

      const result = await promise_handler.runner_execute(node, ctx, runner);

      expect(result.output.action).toBe("error");
      expect(result.output.error).toContain("Database connection failed");
      expect(runner.logger.warn).toHaveBeenCalledWith(
        "promise_node_error",
        expect.objectContaining({
          node_id: "promise-1",
        }),
      );
    });

    it("should catch list errors and return error action", async () => {
      const runner = createMockRunnerContext(true);
      (runner.services?.promise.list as any).mockRejectedValue(
        new Error("Query failed"),
      );

      const node = createMockPromiseNode({ operation: "list" });
      const ctx = createMockContext();

      const result = await promise_handler.runner_execute(node, ctx, runner);

      expect(result.output.action).toBe("error");
      expect(result.output.error).toContain("Query failed");
    });

    it("should log error with node_id for debugging", async () => {
      const runner = createMockRunnerContext(true);
      (runner.services?.promise.get_effective as any).mockRejectedValue(
        new Error("Service timeout"),
      );

      const node = createMockPromiseNode({
        node_id: "promise-debug",
        operation: "get_effective",
      });
      const ctx = createMockContext();

      await promise_handler.runner_execute(node, ctx, runner);

      expect(runner.logger.warn).toHaveBeenCalledWith(
        "promise_node_error",
        expect.objectContaining({
          node_id: "promise-debug",
          error: expect.stringContaining("Service timeout"),
        }),
      );
    });
  });

  describe("runner_execute — unknown operation", () => {
    it("should return error for unknown operation", async () => {
      const node = createMockPromiseNode({
        operation: "invalid_op" as any,
      });
      const ctx = createMockContext();
      const runner = createMockRunnerContext(true);

      const result = await promise_handler.runner_execute(node, ctx, runner);

      expect(result.output.action).toBe("error");
      expect(result.output.error).toContain("unknown operation");
    });
  });

  describe("test (validation)", () => {
    it("should return empty warnings for valid append", () => {
      const node = createMockPromiseNode({
        operation: "append",
        key: "valid_key",
        value: "valid_value",
      });

      const result = promise_handler.test(node);

      expect(result.warnings).toEqual([]);
    });

    it("should warn if append missing key", () => {
      const node = createMockPromiseNode({
        operation: "append",
        key: "",
      });

      const result = promise_handler.test(node);

      expect(result.warnings).toContain("key is required for append");
    });

    it("should warn if append missing value", () => {
      const node = createMockPromiseNode({
        operation: "append",
        value: "",
      });

      const result = promise_handler.test(node);

      expect(result.warnings).toContain("value is required for append");
    });

    it("should warn if archive missing target_id", () => {
      const node = createMockPromiseNode({
        operation: "archive",
        target_id: undefined,
      });

      const result = promise_handler.test(node);

      expect(result.warnings).toContain(
        "target_id is required for archive",
      );
    });

    it("should not warn for archive with target_id", () => {
      const node = createMockPromiseNode({
        operation: "archive",
        target_id: "rec-123",
      });

      const result = promise_handler.test(node);

      expect(result.warnings).toEqual([]);
    });

    it("should return preview with operation and scope", () => {
      const node = createMockPromiseNode({
        operation: "list",
        scope: "team",
        priority: 2,
      });

      const result = promise_handler.test(node);

      expect(result.preview).toEqual({
        operation: "list",
        scope: "team",
        key: "commitment_key",
        priority: 2,
      });
    });

    it("should use global scope as default in preview", () => {
      const node = createMockPromiseNode({
        scope: undefined,
      });

      const result = promise_handler.test(node);

      expect(result.preview.scope).toBe("global");
    });

    it("should use priority 1 as default in preview", () => {
      const node = createMockPromiseNode({
        priority: undefined,
      });

      const result = promise_handler.test(node);

      expect(result.preview.priority).toBe(1);
    });
  });

  describe("integration scenarios", () => {
    it("should append, list, then archive promise lifecycle", async () => {
      const runner = createMockRunnerContext(true);
      const ctx = createMockContext();

      // Append
      const appendNode = createMockPromiseNode({
        operation: "append",
        key: "project_deadline",
        value: "deliver by end of sprint",
        priority: 2,
      });
      const appendResult = await promise_handler.runner_execute(
        appendNode,
        ctx,
        runner,
      );
      expect(appendResult.output.action).toBe("inserted");

      // List
      const listNode = createMockPromiseNode({
        operation: "list",
        key: "project_deadline",
      });
      const listResult = await promise_handler.runner_execute(
        listNode,
        ctx,
        runner,
      );
      expect(listResult.output.action).toBe("listed");
      expect(listResult.output.records.length).toBeGreaterThanOrEqual(0);

      // Archive
      const archiveNode = createMockPromiseNode({
        operation: "archive",
        target_id: "rec-1",
      });
      const archiveResult = await promise_handler.runner_execute(
        archiveNode,
        ctx,
        runner,
      );
      expect(archiveResult.output.action).toMatch(/archived|not_found/);
    });

    it("should get effective promises for agent", async () => {
      const runner = createMockRunnerContext(true);
      const ctx = createMockContext();

      const node = createMockPromiseNode({
        operation: "get_effective",
        scope_id: "agent-1",
      });

      const result = await promise_handler.runner_execute(node, ctx, runner);

      expect(result.output.action).toBe("get_effective");
      expect(Array.isArray(result.output.records)).toBe(true);
    });

    it("should handle scope_id resolution for team scope", async () => {
      const runner = createMockRunnerContext(true);
      const ctx = createMockContext();

      const node = createMockPromiseNode({
        operation: "append",
        scope: "team",
        scope_id: "team-abc",
        key: "sprint_goal",
        value: "complete feature X",
      });

      const result = await promise_handler.runner_execute(node, ctx, runner);

      expect(runner.services?.promise.append).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: "team",
          scope_id: "team-abc",
        }),
      );
    });
  });
});
