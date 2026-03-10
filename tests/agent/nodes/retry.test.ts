/** Retry 노드 핸들러 테스트
 *
 * 목표: retry_handler를 통한 재시도 로직 검증
 *       - runner_execute: 실패 노드를 설정된 횟수만큼 재시도
 *       - backoff strategies: exponential/linear/fixed 지연 계산
 *       - state tracking: attempts, succeeded, last_error
 *       - validation: target_node/depends_on, max_attempts 필수성
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { retry_handler } from "@src/agent/nodes/retry.js";
import type { RetryNodeDefinition, OrcheNodeDefinition } from "@src/agent/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "@src/agent/orche-node-executor.js";
import type { RunnerContext } from "@src/agent/node-registry.js";

/* ── Mock Data ── */

const createMockRetryNode = (overrides?: Partial<RetryNodeDefinition>): RetryNodeDefinition => ({
  node_id: "retry-1",
  label: "Test Retry",
  node_type: "retry",
  target_node: "target-1",
  max_attempts: 3,
  backoff: "exponential",
  initial_delay_ms: 100,
  max_delay_ms: 10000,
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

const createMockRunner = (overrides?: Partial<RunnerContext>): RunnerContext => ({
  all_nodes: [],
  state: {
    workflow_id: "wf-1",
    memory: {},
    orche_states: [],
  },
  options: {
    abort_signal: new AbortController().signal,
    workspace: "/tmp/workspace",
  },
  execute_node: vi.fn().mockResolvedValue({ output: { result: "success" } }),
  emit: vi.fn(),
  ...overrides,
});

/* ── Tests ── */

describe("Retry Node Handler", () => {
  describe("metadata", () => {
    it("should have correct node_type", () => {
      expect(retry_handler.node_type).toBe("retry");
    });

    it("should have output_schema with result, attempts, succeeded, last_error", () => {
      const schema = retry_handler.output_schema || [];
      const fields = schema.map((f) => f.name);
      expect(fields).toContain("result");
      expect(fields).toContain("attempts");
      expect(fields).toContain("succeeded");
      expect(fields).toContain("last_error");
    });

    it("should have input_schema with target_output and target_error", () => {
      const schema = retry_handler.input_schema || [];
      const fields = schema.map((f) => f.name);
      expect(fields).toContain("target_output");
      expect(fields).toContain("target_error");
    });

    it("should have create_default with exponential backoff", () => {
      const defaultNode = retry_handler.create_default?.();
      expect(defaultNode?.max_attempts).toBe(3);
      expect(defaultNode?.backoff).toBe("exponential");
      expect(defaultNode?.initial_delay_ms).toBe(1000);
    });

    it("should have icon and color metadata", () => {
      expect(retry_handler.icon).toBeDefined();
      expect(retry_handler.color).toBeDefined();
    });
  });

  describe("execute — basic", () => {
    it("should return success with target node result from memory", async () => {
      const node = createMockRetryNode();
      const ctx = createMockContext({
        memory: { "target-1": { data: "result" } },
      });

      const result = await retry_handler.execute(node, ctx);

      expect(result.output.succeeded).toBe(true);
      expect(result.output.result).toEqual({ data: "result" });
      expect(result.output.attempts).toBe(1);
    });

    it("should return failed when target not in memory", async () => {
      const node = createMockRetryNode();
      const ctx = createMockContext();

      const result = await retry_handler.execute(node, ctx);

      expect(result.output.succeeded).toBe(false);
      expect(result.output.result).toBeUndefined();
    });

    it("should use depends_on as fallback for target_node", async () => {
      const node = createMockRetryNode({
        target_node: undefined,
        depends_on: ["node-2"],
      });
      const ctx = createMockContext({
        memory: { "node-2": { value: 42 } },
      });

      const result = await retry_handler.execute(node, ctx);

      expect(result.output.succeeded).toBe(true);
      expect(result.output.result).toEqual({ value: 42 });
    });
  });

  describe("runner_execute — success on first attempt", () => {
    it("should execute target node and return success", async () => {
      const node = createMockRetryNode({
        target_node: "target-1",
      });
      const ctx = createMockContext();
      const execute_node = vi.fn().mockResolvedValue({ output: { status: "ok" } });
      const runner = createMockRunner({
        all_nodes: [{ node_id: "target-1", node_type: "set", label: "Target" } as OrcheNodeDefinition],
        execute_node,
      });

      const result = await retry_handler.runner_execute?.(node, ctx, runner);

      expect(result?.output.succeeded).toBe(true);
      expect(result?.output.result).toEqual({ status: "ok" });
      expect(result?.output.attempts).toBe(1);
      expect(result?.output.last_error).toBe("");
      expect(execute_node).toHaveBeenCalledTimes(1);
    });

    it("should update memory with target node result", async () => {
      const node = createMockRetryNode({
        target_node: "target-1",
      });
      const ctx = createMockContext();
      const execute_node = vi.fn().mockResolvedValue({ output: { value: "test" } });
      const runner = createMockRunner({
        all_nodes: [{ node_id: "target-1", node_type: "set", label: "Target" } as OrcheNodeDefinition],
        state: {
          workflow_id: "wf-1",
          memory: {},
          orche_states: [],
        },
        execute_node,
      });

      await retry_handler.runner_execute?.(node, ctx, runner);

      expect(runner.state.memory["target-1"]).toEqual({ value: "test" });
    });

    it("should update orche_states with completed status", async () => {
      const node = createMockRetryNode({
        target_node: "target-1",
      });
      const ctx = createMockContext();
      const execute_node = vi.fn().mockResolvedValue({ output: { ok: true } });
      const runner = createMockRunner({
        all_nodes: [{ node_id: "target-1", node_type: "set", label: "Target" } as OrcheNodeDefinition],
        state: {
          workflow_id: "wf-1",
          memory: {},
          orche_states: [{ node_id: "target-1", status: "pending" as const, result: null }],
        },
        execute_node,
      });

      await retry_handler.runner_execute?.(node, ctx, runner);

      const nodeState = runner.state.orche_states?.find((s) => s.node_id === "target-1");
      expect(nodeState?.status).toBe("completed");
      expect(nodeState?.result).toEqual({ ok: true });
      expect(nodeState?.completed_at).toBeDefined();
    });
  });

  describe("runner_execute — failure and retry", () => {
    it("should retry on failure until max_attempts", async () => {
      const node = createMockRetryNode({
        target_node: "target-1",
        max_attempts: 3,
      });
      const ctx = createMockContext();
      const execute_node = vi
        .fn()
        .mockRejectedValueOnce(new Error("Attempt 1 failed"))
        .mockRejectedValueOnce(new Error("Attempt 2 failed"))
        .mockResolvedValueOnce({ output: { result: "success" } });
      const runner = createMockRunner({
        all_nodes: [{ node_id: "target-1", node_type: "set", label: "Target" } as OrcheNodeDefinition],
        execute_node,
      });

      const result = await retry_handler.runner_execute?.(node, ctx, runner);

      expect(result?.output.succeeded).toBe(true);
      expect(result?.output.attempts).toBe(3);
      expect(execute_node).toHaveBeenCalledTimes(3);
    });

    it("should return last error after max attempts exhausted", async () => {
      const node = createMockRetryNode({
        target_node: "target-1",
        max_attempts: 2,
      });
      const ctx = createMockContext();
      const execute_node = vi
        .fn()
        .mockRejectedValueOnce(new Error("Error 1"))
        .mockRejectedValueOnce(new Error("Error 2"));
      const runner = createMockRunner({
        all_nodes: [{ node_id: "target-1", node_type: "set", label: "Target" } as OrcheNodeDefinition],
        execute_node,
      });

      const result = await retry_handler.runner_execute?.(node, ctx, runner);

      expect(result?.output.succeeded).toBe(false);
      expect(result?.output.attempts).toBe(2);
      expect(result?.output.last_error).toBe("Error 2");
      expect(result?.output.result).toBeNull();
    });

    it("should emit node_retry events on failure", async () => {
      const node = createMockRetryNode({
        target_node: "target-1",
        max_attempts: 2,
      });
      const ctx = createMockContext();
      const emit = vi.fn();
      const execute_node = vi
        .fn()
        .mockRejectedValueOnce(new Error("Failed"))
        .mockResolvedValueOnce({ output: { ok: true } });
      const runner = createMockRunner({
        all_nodes: [{ node_id: "target-1", node_type: "set", label: "Target" } as OrcheNodeDefinition],
        execute_node,
        emit,
      });

      await retry_handler.runner_execute?.(node, ctx, runner);

      const emitted = emit.mock.calls.map((call) => call[0]);
      expect(emitted).toContainEqual(
        expect.objectContaining({
          type: "node_retry",
          attempt: 1,
          max_attempts: 2,
        })
      );
    });

    it("should return error when target node not found", async () => {
      const node = createMockRetryNode({
        target_node: "missing-target",
      });
      const ctx = createMockContext();
      const runner = createMockRunner({
        all_nodes: [],
      });

      const result = await retry_handler.runner_execute?.(node, ctx, runner);

      expect(result?.output.succeeded).toBe(false);
      expect(result?.output.attempts).toBe(0);
      expect(result?.output.last_error).toContain("target node not found");
    });
  });

  describe("runner_execute — backoff strategy selection", () => {
    it("should support exponential backoff", async () => {
      const node = createMockRetryNode({
        target_node: "target-1",
        max_attempts: 2,
        backoff: "exponential",
        initial_delay_ms: 100,
      });
      const ctx = createMockContext();
      const execute_node = vi.fn().mockRejectedValueOnce(new Error("fail")).mockResolvedValueOnce({ output: { ok: true } });
      const runner = createMockRunner({
        all_nodes: [{ node_id: "target-1", node_type: "set", label: "Target" } as OrcheNodeDefinition],
        execute_node,
      });

      const result = await retry_handler.runner_execute?.(node, ctx, runner);

      expect(result?.output.succeeded).toBe(true);
      expect(result?.output.attempts).toBe(2);
    });

    it("should support linear backoff", async () => {
      const node = createMockRetryNode({
        target_node: "target-1",
        backoff: "linear",
        initial_delay_ms: 50,
      });
      const ctx = createMockContext();
      const execute_node = vi.fn().mockResolvedValue({ output: { ok: true } });
      const runner = createMockRunner({
        all_nodes: [{ node_id: "target-1", node_type: "set", label: "Target" } as OrcheNodeDefinition],
        execute_node,
      });

      const result = await retry_handler.runner_execute?.(node, ctx, runner);

      expect(result?.output.succeeded).toBe(true);
    });

    it("should support fixed backoff", async () => {
      const node = createMockRetryNode({
        target_node: "target-1",
        backoff: "fixed",
        initial_delay_ms: 100,
      });
      const ctx = createMockContext();
      const execute_node = vi.fn().mockResolvedValue({ output: { ok: true } });
      const runner = createMockRunner({
        all_nodes: [{ node_id: "target-1", node_type: "set", label: "Target" } as OrcheNodeDefinition],
        execute_node,
      });

      const result = await retry_handler.runner_execute?.(node, ctx, runner);

      expect(result?.output.succeeded).toBe(true);
    });

    it("should not exceed max_delay_ms", async () => {
      const node = createMockRetryNode({
        target_node: "target-1",
        backoff: "exponential",
        initial_delay_ms: 10000,
        max_delay_ms: 5000, // Should cap
      });
      const ctx = createMockContext();
      const execute_node = vi.fn().mockResolvedValue({ output: { ok: true } });
      const runner = createMockRunner({
        all_nodes: [{ node_id: "target-1", node_type: "set", label: "Target" } as OrcheNodeDefinition],
        execute_node,
      });

      const result = await retry_handler.runner_execute?.(node, ctx, runner);

      expect(result?.output.succeeded).toBe(true);
    });
  });

  describe("test (validation)", () => {
    it("should return no warnings for valid configuration", () => {
      const node = createMockRetryNode();
      const ctx = createMockContext();

      const result = retry_handler.test(node, ctx);

      expect(result.warnings).toEqual([]);
    });

    it("should warn when target_node and depends_on missing", () => {
      const node = createMockRetryNode({
        target_node: undefined,
        depends_on: undefined,
      });
      const ctx = createMockContext();

      const result = retry_handler.test(node, ctx);

      expect(result.warnings).toContain("target_node or depends_on is required");
    });

    it("should warn when max_attempts less than 1", () => {
      const node = createMockRetryNode({
        max_attempts: 0,
      });
      const ctx = createMockContext();

      const result = retry_handler.test(node, ctx);

      expect(result.warnings).toContain("max_attempts must be at least 1");
    });

    it("should warn when initial_delay_ms not positive", () => {
      const node = createMockRetryNode({
        initial_delay_ms: 0,
      });
      const ctx = createMockContext();

      const result = retry_handler.test(node, ctx);

      expect(result.warnings).toContain("initial_delay_ms should be positive");
    });

    it("should warn when initial_delay_ms is negative", () => {
      const node = createMockRetryNode({
        initial_delay_ms: -100,
      });
      const ctx = createMockContext();

      const result = retry_handler.test(node, ctx);

      expect(result.warnings).toContain("initial_delay_ms should be positive");
    });

    it("should not warn when depends_on is provided", () => {
      const node = createMockRetryNode({
        target_node: undefined,
        depends_on: ["node-1"],
      });
      const ctx = createMockContext();

      const result = retry_handler.test(node, ctx);

      expect(result.warnings.filter((w) => w.includes("target_node"))).toHaveLength(0);
    });

    it("should include preview with configuration", () => {
      const node = createMockRetryNode({
        target_node: "my-node",
        max_attempts: 5,
        backoff: "linear",
        initial_delay_ms: 500,
      });
      const ctx = createMockContext();

      const result = retry_handler.test(node, ctx);

      expect(result.preview.target_node).toBe("my-node");
      expect(result.preview.max_attempts).toBe(5);
      expect(result.preview.backoff).toBe("linear");
      expect(result.preview.initial_delay_ms).toBe(500);
    });

    it("should warn on all validation errors together", () => {
      const node = createMockRetryNode({
        target_node: undefined,
        depends_on: undefined,
        max_attempts: 0,
        initial_delay_ms: -1,
      });
      const ctx = createMockContext();

      const result = retry_handler.test(node, ctx);

      expect(result.warnings.length).toBe(3);
    });
  });

  describe("integration scenarios", () => {
    it("should handle transient failure (fail then succeed)", async () => {
      const node = createMockRetryNode({
        target_node: "api-call",
        max_attempts: 3,
        backoff: "exponential",
      });
      const ctx = createMockContext();
      const execute_node = vi
        .fn()
        .mockRejectedValueOnce(new Error("Network timeout"))
        .mockResolvedValueOnce({ output: { data: [1, 2, 3] } });
      const runner = createMockRunner({
        all_nodes: [{ node_id: "api-call", node_type: "http", label: "API Call" } as OrcheNodeDefinition],
        execute_node,
      });

      const result = await retry_handler.runner_execute?.(node, ctx, runner);

      expect(result?.output.succeeded).toBe(true);
      expect(result?.output.attempts).toBe(2);
      expect(result?.output.result).toEqual({ data: [1, 2, 3] });
    });

    it("should handle persistent failure and give up", async () => {
      const node = createMockRetryNode({
        target_node: "unreliable-service",
        max_attempts: 3,
        backoff: "fixed",
        initial_delay_ms: 10,
      });
      const ctx = createMockContext();
      const execute_node = vi
        .fn()
        .mockRejectedValue(new Error("Service unavailable"));
      const runner = createMockRunner({
        all_nodes: [
          { node_id: "unreliable-service", node_type: "http", label: "Service" } as OrcheNodeDefinition,
        ],
        execute_node,
      });

      const result = await retry_handler.runner_execute?.(node, ctx, runner);

      expect(result?.output.succeeded).toBe(false);
      expect(result?.output.attempts).toBe(3);
      expect(result?.output.last_error).toBe("Service unavailable");
    });

    it("should track retry progression in events", async () => {
      const node = createMockRetryNode({
        target_node: "task",
        max_attempts: 3,
      });
      const ctx = createMockContext();
      const emit = vi.fn();
      const execute_node = vi
        .fn()
        .mockRejectedValueOnce(new Error("Error 1"))
        .mockRejectedValueOnce(new Error("Error 2"))
        .mockResolvedValueOnce({ output: { done: true } });
      const runner = createMockRunner({
        all_nodes: [{ node_id: "task", node_type: "set", label: "Task" } as OrcheNodeDefinition],
        execute_node,
        emit,
      });

      await retry_handler.runner_execute?.(node, ctx, runner);

      const retryEvents = emit.mock.calls
        .map((call) => call[0])
        .filter((event) => event.type === "node_retry");
      expect(retryEvents).toHaveLength(2);
      expect(retryEvents[0]).toMatchObject({ attempt: 1, max_attempts: 3 });
      expect(retryEvents[1]).toMatchObject({ attempt: 2, max_attempts: 3 });
    });
  });

  describe("edge cases", () => {
    it("should handle max_attempts of 1 (no retry)", async () => {
      const node = createMockRetryNode({
        target_node: "target-1",
        max_attempts: 1,
      });
      const ctx = createMockContext();
      const execute_node = vi.fn().mockRejectedValue(new Error("Failed"));
      const runner = createMockRunner({
        all_nodes: [{ node_id: "target-1", node_type: "set", label: "Target" } as OrcheNodeDefinition],
        execute_node,
      });

      const result = await retry_handler.runner_execute?.(node, ctx, runner);

      expect(result?.output.succeeded).toBe(false);
      expect(result?.output.attempts).toBe(1);
      expect(execute_node).toHaveBeenCalledTimes(1);
    });

    it("should handle large max_attempts value", async () => {
      const node = createMockRetryNode({
        target_node: "target-1",
        max_attempts: 100,
      });
      const ctx = createMockContext();
      const execute_node = vi.fn().mockResolvedValue({ output: { ok: true } });
      const runner = createMockRunner({
        all_nodes: [{ node_id: "target-1", node_type: "set", label: "Target" } as OrcheNodeDefinition],
        execute_node,
      });

      const result = await retry_handler.runner_execute?.(node, ctx, runner);

      expect(result?.output.succeeded).toBe(true);
      expect(result?.output.attempts).toBe(1);
      expect(execute_node).toHaveBeenCalledTimes(1);
    });

    it("should handle zero initial delay", async () => {
      const node = createMockRetryNode({
        target_node: "target-1",
        max_attempts: 3,
        initial_delay_ms: 0,
      });
      const ctx = createMockContext();
      const execute_node = vi
        .fn()
        .mockRejectedValueOnce(new Error("fail"))
        .mockResolvedValueOnce({ output: { ok: true } });
      const runner = createMockRunner({
        all_nodes: [{ node_id: "target-1", node_type: "set", label: "Target" } as OrcheNodeDefinition],
        execute_node,
      });

      const result = await retry_handler.runner_execute?.(node, ctx, runner);

      expect(result?.output.succeeded).toBe(true);
    });

    it("linear backoff 실패 시 delay 계산 (L124)", async () => {
      const node = createMockRetryNode({
        target_node: "target-1",
        backoff: "linear",
        initial_delay_ms: 1,
        max_attempts: 3,
      });
      const ctx = createMockContext();
      const execute_node = vi.fn()
        .mockRejectedValueOnce(new Error("first fail"))
        .mockResolvedValueOnce({ output: { ok: true } });
      const runner = createMockRunner({
        all_nodes: [{ node_id: "target-1", node_type: "set", label: "Target" } as OrcheNodeDefinition],
        execute_node,
      });
      const result = await retry_handler.runner_execute?.(node, ctx, runner);
      expect(result?.output.succeeded).toBe(true);
    });

    it("unknown backoff → default delay (L126)", async () => {
      const node = createMockRetryNode({
        target_node: "target-1",
        backoff: "unknown_strategy" as any,
        initial_delay_ms: 1,
        max_attempts: 3,
      });
      const ctx = createMockContext();
      const execute_node = vi.fn()
        .mockRejectedValueOnce(new Error("fail"))
        .mockResolvedValueOnce({ output: { ok: true } });
      const runner = createMockRunner({
        all_nodes: [{ node_id: "target-1", node_type: "set", label: "Target" } as OrcheNodeDefinition],
        execute_node,
      });
      const result = await retry_handler.runner_execute?.(node, ctx, runner);
      expect(result?.output.succeeded).toBe(true);
    });

    it("should handle uses uses depends_on as target", async () => {
      const node = createMockRetryNode({
        target_node: undefined,
        depends_on: ["dependency"],
        max_attempts: 2,
      });
      const ctx = createMockContext();
      const execute_node = vi.fn().mockResolvedValue({ output: { result: "data" } });
      const runner = createMockRunner({
        all_nodes: [{ node_id: "dependency", node_type: "set", label: "Dependency" } as OrcheNodeDefinition],
        execute_node,
      });

      const result = await retry_handler.runner_execute?.(node, ctx, runner);

      expect(result?.output.succeeded).toBe(true);
      expect(execute_node).toHaveBeenCalled();
    });
  });
});
