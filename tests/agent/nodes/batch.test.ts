/** Batch 노드 핸들러 테스트
 *
 * 목표: batch_handler를 통한 병렬 배치 처리 검증
 *       - runner_execute: 배열 아이템을 동시성 제한으로 처리
 *       - concurrency: 병렬 실행 수 제어
 *       - on_item_error: continue vs halt 에러 처리
 *       - state tracking: succeeded/failed 카운트, 에러 수집
 *       - validation: array_field, body_node 필수성
 */

import { describe, it, expect, vi } from "vitest";
import { batch_handler } from "@src/agent/nodes/batch.js";
import type { BatchNodeDefinition, OrcheNodeDefinition } from "@src/agent/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "@src/agent/orche-node-executor.js";
import type { RunnerContext } from "@src/agent/node-registry.js";

/* ── Mock Data ── */

const createMockBatchNode = (overrides?: Partial<BatchNodeDefinition>): BatchNodeDefinition => ({
  node_id: "batch-1",
  label: "Test Batch",
  node_type: "batch",
  array_field: "items",
  body_node: "worker",
  concurrency: 3,
  on_item_error: "continue",
  ...overrides,
});

const createMockContext = (overrides?: Partial<OrcheNodeExecutorContext>): OrcheNodeExecutorContext => ({
  memory: {
    agent_id: "agent-1",
    user_id: "user-1",
    workspace_id: "workspace-1",
    previous_output: {},
    items: [1, 2, 3, 4, 5],
    nested: {
      data: {
        items: ["a", "b", "c"],
      },
    },
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
  execute_node: vi.fn().mockResolvedValue({ output: { processed: true } }),
  emit: vi.fn(),
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
  ...overrides,
});

/* ── Tests ── */

describe("Batch Node Handler", () => {
  describe("metadata", () => {
    it("should have correct node_type", () => {
      expect(batch_handler.node_type).toBe("batch");
    });

    it("should have output_schema with results, total, succeeded, failed, errors", () => {
      const schema = batch_handler.output_schema || [];
      const fields = schema.map((f) => f.name);
      expect(fields).toContain("results");
      expect(fields).toContain("total");
      expect(fields).toContain("succeeded");
      expect(fields).toContain("failed");
      expect(fields).toContain("errors");
    });

    it("should have input_schema with items and concurrency", () => {
      const schema = batch_handler.input_schema || [];
      const fields = schema.map((f) => f.name);
      expect(fields).toContain("items");
      expect(fields).toContain("concurrency");
    });

    it("should have create_default with concurrency of 5", () => {
      const defaultNode = batch_handler.create_default?.();
      expect(defaultNode?.concurrency).toBe(5);
      expect(defaultNode?.on_item_error).toBe("continue");
    });

    it("should have icon and color metadata", () => {
      expect(batch_handler.icon).toBeDefined();
      expect(batch_handler.color).toBeDefined();
    });
  });

  describe("execute — basic", () => {
    it("should return empty results without runner", async () => {
      const node = createMockBatchNode();
      const ctx = createMockContext();

      const result = await batch_handler.execute(node, ctx);

      expect(result.output.results).toEqual([]);
      expect(result.output.total).toBe(5);
      expect(result.output.succeeded).toBe(0);
      expect(result.output.failed).toBe(0);
    });

    it("should count items from array_field", async () => {
      const node = createMockBatchNode({
        array_field: "items",
      });
      const ctx = createMockContext();

      const result = await batch_handler.execute(node, ctx);

      expect(result.output.total).toBe(5);
    });

    it("should handle missing array_field", async () => {
      const node = createMockBatchNode({
        array_field: "nonexistent",
      });
      const ctx = createMockContext();

      const result = await batch_handler.execute(node, ctx);

      expect(result.output.total).toBe(0);
    });

    it("should handle nested array_field with dot notation", async () => {
      const node = createMockBatchNode({
        array_field: "nested.data.items",
      });
      const ctx = createMockContext();

      const result = await batch_handler.execute(node, ctx);

      expect(result.output.total).toBe(3);
    });
  });

  describe("runner_execute — all items succeed", () => {
    it("should process all items and return results", async () => {
      const node = createMockBatchNode({
        array_field: "items",
        body_node: "worker",
      });
      const ctx = createMockContext();
      const execute_node = vi.fn().mockResolvedValue({ output: { processed: true } });
      const runner = createMockRunner({
        all_nodes: [{ node_id: "worker", node_type: "set", label: "Worker" } as OrcheNodeDefinition],
        state: {
          workflow_id: "wf-1",
          memory: { items: [1, 2, 3] },
          orche_states: [],
        },
        execute_node,
      });

      const result = await batch_handler.runner_execute?.(node, ctx, runner);

      expect(result?.output.total).toBe(3);
      expect(result?.output.succeeded).toBe(3);
      expect(result?.output.failed).toBe(0);
      expect(result?.output.errors).toEqual([]);
      expect(result?.output.results).toHaveLength(3);
      expect(execute_node).toHaveBeenCalledTimes(3);
    });

    it("should pass item in memory as _batch_item", async () => {
      const node = createMockBatchNode({
        array_field: "items",
        body_node: "worker",
      });
      const ctx = createMockContext();
      const execute_node = vi.fn().mockResolvedValue({ output: { result: "ok" } });
      const runner = createMockRunner({
        all_nodes: [{ node_id: "worker", node_type: "set", label: "Worker" } as OrcheNodeDefinition],
        state: {
          workflow_id: "wf-1",
          memory: { items: ["a", "b"] },
          orche_states: [],
        },
        execute_node,
      });

      await batch_handler.runner_execute?.(node, ctx, runner);

      const calls = execute_node.mock.calls;
      expect(calls[0][1].memory._batch_item).toBe("a");
      expect(calls[1][1].memory._batch_item).toBe("b");
    });

    it("should pass batch index in memory as _batch_index", async () => {
      const node = createMockBatchNode({
        array_field: "items",
        body_node: "worker",
      });
      const ctx = createMockContext();
      const execute_node = vi.fn().mockResolvedValue({ output: { result: "ok" } });
      const runner = createMockRunner({
        all_nodes: [{ node_id: "worker", node_type: "set", label: "Worker" } as OrcheNodeDefinition],
        state: {
          workflow_id: "wf-1",
          memory: { items: [10, 20, 30] },
          orche_states: [],
        },
        execute_node,
      });

      await batch_handler.runner_execute?.(node, ctx, runner);

      const calls = execute_node.mock.calls;
      expect(calls[0][1].memory._batch_index).toBe(0);
      expect(calls[1][1].memory._batch_index).toBe(1);
      expect(calls[2][1].memory._batch_index).toBe(2);
    });

    it("should respect concurrency limit", async () => {
      const node = createMockBatchNode({
        array_field: "items",
        body_node: "worker",
        concurrency: 2,
      });
      const ctx = createMockContext();
      let maxConcurrent = 0;
      let currentConcurrent = 0;
      const execute_node = vi.fn().mockImplementation(async () => {
        currentConcurrent++;
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
        await new Promise((resolve) => setTimeout(resolve, 10));
        currentConcurrent--;
        return { output: { ok: true } };
      });
      const runner = createMockRunner({
        all_nodes: [{ node_id: "worker", node_type: "set", label: "Worker" } as OrcheNodeDefinition],
        state: {
          workflow_id: "wf-1",
          memory: { items: [1, 2, 3, 4] },
          orche_states: [],
        },
        execute_node,
      });

      const result = await batch_handler.runner_execute?.(node, ctx, runner);

      expect(result?.output.succeeded).toBe(4);
      expect(maxConcurrent).toBeLessThanOrEqual(2);
    });
  });

  describe("runner_execute — item failures", () => {
    it("should collect errors when on_item_error is continue", async () => {
      const node = createMockBatchNode({
        array_field: "items",
        body_node: "worker",
        on_item_error: "continue",
      });
      const ctx = createMockContext();
      const execute_node = vi
        .fn()
        .mockResolvedValueOnce({ output: { ok: true } })
        .mockRejectedValueOnce(new Error("Item 2 failed"))
        .mockResolvedValueOnce({ output: { ok: true } });
      const runner = createMockRunner({
        all_nodes: [{ node_id: "worker", node_type: "set", label: "Worker" } as OrcheNodeDefinition],
        state: {
          workflow_id: "wf-1",
          memory: { items: [1, 2, 3] },
          orche_states: [],
        },
        execute_node,
      });

      const result = await batch_handler.runner_execute?.(node, ctx, runner);

      expect(result?.output.total).toBe(3);
      expect(result?.output.succeeded).toBe(2);
      expect(result?.output.failed).toBe(1);
      expect(result?.output.errors).toHaveLength(1);
      expect(result?.output.errors[0]).toEqual({ index: 1, error: "Item 2 failed" });
    });

    it("should halt on first error when on_item_error is halt", async () => {
      const node = createMockBatchNode({
        array_field: "items",
        body_node: "worker",
        on_item_error: "halt",
        concurrency: 1, // Serial to ensure order
      });
      const ctx = createMockContext();
      const execute_node = vi
        .fn()
        .mockResolvedValueOnce({ output: { ok: true } })
        .mockRejectedValueOnce(new Error("Error on item 2"))
        .mockResolvedValueOnce({ output: { ok: true } }); // This won't be called
      const runner = createMockRunner({
        all_nodes: [{ node_id: "worker", node_type: "set", label: "Worker" } as OrcheNodeDefinition],
        state: {
          workflow_id: "wf-1",
          memory: { items: [1, 2, 3] },
          orche_states: [],
        },
        execute_node,
      });

      const result = await batch_handler.runner_execute?.(node, ctx, runner);

      expect(result?.output.succeeded).toBe(1);
      expect(result?.output.failed).toBe(1);
      expect(execute_node).toHaveBeenCalledTimes(2); // Only first two called
    });

    it("should include null in results for failed items", async () => {
      const node = createMockBatchNode({
        array_field: "items",
        body_node: "worker",
        on_item_error: "continue",
      });
      const ctx = createMockContext();
      const execute_node = vi
        .fn()
        .mockResolvedValueOnce({ output: { value: "success" } })
        .mockRejectedValueOnce(new Error("Error"))
        .mockResolvedValueOnce({ output: { value: "success" } });
      const runner = createMockRunner({
        all_nodes: [{ node_id: "worker", node_type: "set", label: "Worker" } as OrcheNodeDefinition],
        state: {
          workflow_id: "wf-1",
          memory: { items: [1, 2, 3] },
          orche_states: [],
        },
        execute_node,
      });

      const result = await batch_handler.runner_execute?.(node, ctx, runner);

      expect(result?.output.results[0]).toEqual({ value: "success" });
      expect(result?.output.results[1]).toBeNull();
      expect(result?.output.results[2]).toEqual({ value: "success" });
    });

    it("should return error when body_node not found", async () => {
      const node = createMockBatchNode({
        array_field: "items",
        body_node: "missing",
      });
      const ctx = createMockContext();
      const runner = createMockRunner({
        all_nodes: [],
        state: {
          workflow_id: "wf-1",
          memory: { items: [1, 2, 3] },
          orche_states: [],
        },
      });

      const result = await batch_handler.runner_execute?.(node, ctx, runner);

      expect(result?.output.succeeded).toBe(0);
      expect(result?.output.failed).toBe(3);
      expect(result?.output.errors[0]).toContain("body node not found");
    });
  });

  describe("runner_execute — edge cases", () => {
    it("should handle empty array", async () => {
      const node = createMockBatchNode({
        array_field: "items",
        body_node: "worker",
      });
      const ctx = createMockContext();
      const execute_node = vi.fn();
      const runner = createMockRunner({
        all_nodes: [{ node_id: "worker", node_type: "set", label: "Worker" } as OrcheNodeDefinition],
        state: {
          workflow_id: "wf-1",
          memory: { items: [] },
          orche_states: [],
        },
        execute_node,
      });

      const result = await batch_handler.runner_execute?.(node, ctx, runner);

      expect(result?.output.total).toBe(0);
      expect(result?.output.succeeded).toBe(0);
      expect(result?.output.failed).toBe(0);
      expect(execute_node).not.toHaveBeenCalled();
    });

    it("should handle single item", async () => {
      const node = createMockBatchNode({
        array_field: "items",
        body_node: "worker",
      });
      const ctx = createMockContext();
      const execute_node = vi.fn().mockResolvedValue({ output: { ok: true } });
      const runner = createMockRunner({
        all_nodes: [{ node_id: "worker", node_type: "set", label: "Worker" } as OrcheNodeDefinition],
        state: {
          workflow_id: "wf-1",
          memory: { items: ["only-one"] },
          orche_states: [],
        },
        execute_node,
      });

      const result = await batch_handler.runner_execute?.(node, ctx, runner);

      expect(result?.output.total).toBe(1);
      expect(result?.output.succeeded).toBe(1);
    });

    it("should handle concurrency larger than item count", async () => {
      const node = createMockBatchNode({
        array_field: "items",
        body_node: "worker",
        concurrency: 100,
      });
      const ctx = createMockContext();
      const execute_node = vi.fn().mockResolvedValue({ output: { ok: true } });
      const runner = createMockRunner({
        all_nodes: [{ node_id: "worker", node_type: "set", label: "Worker" } as OrcheNodeDefinition],
        state: {
          workflow_id: "wf-1",
          memory: { items: [1, 2] },
          orche_states: [],
        },
        execute_node,
      });

      const result = await batch_handler.runner_execute?.(node, ctx, runner);

      expect(result?.output.total).toBe(2);
      expect(result?.output.succeeded).toBe(2);
      expect(execute_node).toHaveBeenCalledTimes(2);
    });

    it("should handle concurrency of 1 (serial)", async () => {
      const node = createMockBatchNode({
        array_field: "items",
        body_node: "worker",
        concurrency: 1,
      });
      const ctx = createMockContext();
      const execute_node = vi.fn().mockResolvedValue({ output: { ok: true } });
      const runner = createMockRunner({
        all_nodes: [{ node_id: "worker", node_type: "set", label: "Worker" } as OrcheNodeDefinition],
        state: {
          workflow_id: "wf-1",
          memory: { items: [1, 2, 3] },
          orche_states: [],
        },
        execute_node,
      });

      const result = await batch_handler.runner_execute?.(node, ctx, runner);

      expect(result?.output.succeeded).toBe(3);
      expect(execute_node).toHaveBeenCalledTimes(3);
    });

    it("should preserve original memory context", async () => {
      const node = createMockBatchNode({
        array_field: "items",
        body_node: "worker",
      });
      const ctx = createMockContext();
      const execute_node = vi.fn().mockImplementation((_, options) => {
        expect(options.memory.user_id).toBe("user-1");
        return Promise.resolve({ output: { ok: true } });
      });
      const runner = createMockRunner({
        all_nodes: [{ node_id: "worker", node_type: "set", label: "Worker" } as OrcheNodeDefinition],
        state: {
          workflow_id: "wf-1",
          memory: { user_id: "user-1", items: [1, 2] },
          orche_states: [],
        },
        execute_node,
      });

      await batch_handler.runner_execute?.(node, ctx, runner);

      expect(execute_node).toHaveBeenCalled();
    });
  });

  describe("test (validation)", () => {
    it("should return no warnings for valid configuration", () => {
      const node = createMockBatchNode({
        array_field: "items",
        body_node: "worker",
        concurrency: 5,
      });
      const ctx = createMockContext();

      const result = batch_handler.test(node, ctx);

      expect(result.warnings).toEqual([]);
    });

    it("should warn when array_field missing", () => {
      const node = createMockBatchNode({
        array_field: "",
        body_node: "worker",
      });
      const ctx = createMockContext();

      const result = batch_handler.test(node, ctx);

      expect(result.warnings).toContain("array_field is required");
    });

    it("should warn when body_node missing", () => {
      const node = createMockBatchNode({
        array_field: "items",
        body_node: "",
      });
      const ctx = createMockContext();

      const result = batch_handler.test(node, ctx);

      expect(result.warnings).toContain("body_node is required");
    });

    it("should warn when concurrency less than 1", () => {
      const node = createMockBatchNode({
        concurrency: 0,
      });
      const ctx = createMockContext();

      const result = batch_handler.test(node, ctx);

      expect(result.warnings).toContain("concurrency must be at least 1");
    });

    it("should include preview with configuration", () => {
      const node = createMockBatchNode({
        array_field: "items",
        body_node: "worker",
        concurrency: 10,
      });
      const ctx = createMockContext();

      const result = batch_handler.test(node, ctx);

      expect(result.preview.array_field).toBe("items");
      expect(result.preview.item_count).toBe(5);
      expect(result.preview.body_node).toBe("worker");
      expect(result.preview.concurrency).toBe(10);
    });

    it("should show item count from array_field", () => {
      const node = createMockBatchNode({
        array_field: "nested.data.items",
      });
      const ctx = createMockContext();

      const result = batch_handler.test(node, ctx);

      expect(result.preview.item_count).toBe(3);
    });
  });

  describe("integration scenarios", () => {
    it("should process items and collect results", async () => {
      const node = createMockBatchNode({
        array_field: "items",
        body_node: "transform",
        concurrency: 2,
      });
      const ctx = createMockContext();
      const execute_node = vi.fn().mockImplementation((_, options) => {
        const item = options.memory._batch_item;
        return Promise.resolve({ output: { doubled: item * 2 } });
      });
      const runner = createMockRunner({
        all_nodes: [{ node_id: "transform", node_type: "transform", label: "Transform" } as OrcheNodeDefinition],
        state: {
          workflow_id: "wf-1",
          memory: { items: [1, 2, 3, 4] },
          orche_states: [],
        },
        execute_node,
      });

      const result = await batch_handler.runner_execute?.(node, ctx, runner);

      expect(result?.output.total).toBe(4);
      expect(result?.output.succeeded).toBe(4);
      expect(result?.output.results).toEqual([{ doubled: 2 }, { doubled: 4 }, { doubled: 6 }, { doubled: 8 }]);
    });

    it("should handle mixed success and failure", async () => {
      const node = createMockBatchNode({
        array_field: "items",
        body_node: "processor",
        on_item_error: "continue",
      });
      const ctx = createMockContext();
      let callCount = 0;
      const execute_node = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 2) throw new Error("Even number failed");
        return Promise.resolve({ output: { processed: true } });
      });
      const runner = createMockRunner({
        all_nodes: [{ node_id: "processor", node_type: "set", label: "Processor" } as OrcheNodeDefinition],
        state: {
          workflow_id: "wf-1",
          memory: { items: [1, 2, 3, 4, 5] },
          orche_states: [],
        },
        execute_node,
      });

      const result = await batch_handler.runner_execute?.(node, ctx, runner);

      expect(result?.output.total).toBe(5);
      expect(result?.output.succeeded).toBe(4);
      expect(result?.output.failed).toBe(1);
      expect(result?.output.errors).toHaveLength(1);
    });
  });
});
