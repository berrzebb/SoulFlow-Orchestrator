/** Error Handler 노드 핸들러 테스트
 *
 * 목표: error_handler_handler를 통한 try-catch 워크플로우 검증
 *       - runner_execute: try_nodes 순차 실행
 *       - on_error: "continue" vs "fallback"
 *       - fallback_nodes: 에러 발생 시 실행
 *       - state tracking: memory/orche_states 업데이트
 *       - validation: try_nodes, fallback_nodes 필수성 검증
 */

import { describe, it, expect, vi } from "vitest";
import { error_handler_handler } from "@src/agent/nodes/error-handler.js";
import type { ErrorHandlerNodeDefinition, OrcheNodeDefinition } from "@src/agent/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "@src/agent/orche-node-executor.js";
import type { RunnerContext } from "@src/agent/node-registry.js";

/* ── Mock Data ── */

const createMockErrorHandlerNode = (overrides?: Partial<ErrorHandlerNodeDefinition>): ErrorHandlerNodeDefinition => ({
  node_id: "error-handler-1",
  label: "Test Error Handler",
  node_type: "error_handler",
  try_nodes: ["node-1"],
  on_error: "continue",
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

describe("Error Handler Node Handler", () => {
  describe("metadata", () => {
    it("should have correct node_type", () => {
      expect(error_handler_handler.node_type).toBe("error_handler");
    });

    it("should have output_schema with has_error, error, error_node, output", () => {
      const schema = error_handler_handler.output_schema || [];
      const fields = schema.map((f) => f.name);
      expect(fields).toContain("has_error");
      expect(fields).toContain("error");
      expect(fields).toContain("error_node");
      expect(fields).toContain("output");
    });

    it("should have input_schema with data", () => {
      const schema = error_handler_handler.input_schema || [];
      const fields = schema.map((f) => f.name);
      expect(fields).toContain("data");
    });

    it("should have create_default returning empty try_nodes and continue mode", () => {
      const defaultNode = error_handler_handler.create_default?.();
      expect(defaultNode?.try_nodes).toEqual([]);
      expect(defaultNode?.on_error).toBe("continue");
    });

    it("should have icon and color metadata", () => {
      expect(error_handler_handler.icon).toBeDefined();
      expect(error_handler_handler.color).toBeDefined();
    });
  });

  describe("execute — basic", () => {
    it("should return success state without runner", async () => {
      const node = createMockErrorHandlerNode();
      const ctx = createMockContext();

      const result = await error_handler_handler.execute(node, ctx);

      expect(result.output.has_error).toBe(false);
      expect(result.output.error).toBe("");
      expect(result.output.error_node).toBe("");
      expect(result.output.output).toBeNull();
    });
  });

  describe("runner_execute — successful try_nodes", () => {
    it("should execute single try_node and return success", async () => {
      const node = createMockErrorHandlerNode({
        try_nodes: ["node-1"],
      });
      const ctx = createMockContext();
      const execute_node = vi.fn().mockResolvedValue({ output: { data: "success" } });
      const runner = createMockRunner({
        all_nodes: [{ node_id: "node-1", node_type: "set", label: "Node 1" } as OrcheNodeDefinition],
        execute_node,
      });

      const result = await error_handler_handler.runner_execute?.(node, ctx, runner);

      expect(result?.output.has_error).toBe(false);
      expect(result?.output.error).toBe("");
      expect(result?.output.output).toEqual({ data: "success" });
      expect(execute_node).toHaveBeenCalledTimes(1);
    });

    it("should execute multiple try_nodes sequentially", async () => {
      const node = createMockErrorHandlerNode({
        try_nodes: ["node-1", "node-2"],
      });
      const ctx = createMockContext();
      const execute_node = vi
        .fn()
        .mockResolvedValueOnce({ output: { step: 1 } })
        .mockResolvedValueOnce({ output: { step: 2 } });
      const runner = createMockRunner({
        all_nodes: [
          { node_id: "node-1", node_type: "set", label: "Node 1" } as OrcheNodeDefinition,
          { node_id: "node-2", node_type: "set", label: "Node 2" } as OrcheNodeDefinition,
        ],
        execute_node,
      });

      const result = await error_handler_handler.runner_execute?.(node, ctx, runner);

      expect(result?.output.has_error).toBe(false);
      expect(result?.output.output).toEqual({ step: 2 });
      expect(execute_node).toHaveBeenCalledTimes(2);
    });

    it("should update memory with each node_id as key", async () => {
      const node = createMockErrorHandlerNode({
        try_nodes: ["node-1"],
      });
      const ctx = createMockContext();
      const execute_node = vi.fn().mockResolvedValue({ output: { result: "test" } });
      const runner = createMockRunner({
        all_nodes: [{ node_id: "node-1", node_type: "set", label: "Node 1" } as OrcheNodeDefinition],
        state: {
          workflow_id: "wf-1",
          memory: {},
          orche_states: [],
        },
        execute_node,
      });

      await error_handler_handler.runner_execute?.(node, ctx, runner);

      expect(runner.state.memory["node-1"]).toEqual({ result: "test" });
    });

    it("should update orche_states with completed status", async () => {
      const node = createMockErrorHandlerNode({
        try_nodes: ["node-1"],
      });
      const ctx = createMockContext();
      const execute_node = vi.fn().mockResolvedValue({ output: { result: "ok" } });
      const runner = createMockRunner({
        all_nodes: [{ node_id: "node-1", node_type: "set", label: "Node 1" } as OrcheNodeDefinition],
        state: {
          workflow_id: "wf-1",
          memory: {},
          orche_states: [{ node_id: "node-1", status: "pending" as const, result: null }],
        },
        execute_node,
      });

      await error_handler_handler.runner_execute?.(node, ctx, runner);

      const nodeState = runner.state.orche_states?.find((s) => s.node_id === "node-1");
      expect(nodeState?.status).toBe("completed");
      expect(nodeState?.result).toEqual({ result: "ok" });
    });

    it("should skip non-existent try_nodes", async () => {
      const node = createMockErrorHandlerNode({
        try_nodes: ["missing-node"],
      });
      const ctx = createMockContext();
      const execute_node = vi.fn();
      const runner = createMockRunner({
        all_nodes: [],
        execute_node,
      });

      const result = await error_handler_handler.runner_execute?.(node, ctx, runner);

      expect(result?.output.has_error).toBe(false);
      expect(execute_node).not.toHaveBeenCalled();
    });

    it("should handle empty try_nodes", async () => {
      const node = createMockErrorHandlerNode({
        try_nodes: [],
      });
      const ctx = createMockContext();
      const execute_node = vi.fn();
      const runner = createMockRunner({
        all_nodes: [],
        execute_node,
      });

      const result = await error_handler_handler.runner_execute?.(node, ctx, runner);

      expect(result?.output.has_error).toBe(false);
      expect(result?.output.output).toBeNull();
    });
  });

  describe("runner_execute — on_error continue", () => {
    it("should return error when try_node fails with on_error continue", async () => {
      const node = createMockErrorHandlerNode({
        try_nodes: ["node-1"],
        on_error: "continue",
      });
      const ctx = createMockContext();
      const execute_node = vi.fn().mockRejectedValue(new Error("Node execution failed"));
      const emit = vi.fn();
      const runner = createMockRunner({
        all_nodes: [{ node_id: "node-1", node_type: "set", label: "Node 1" } as OrcheNodeDefinition],
        execute_node,
        emit,
      });

      const result = await error_handler_handler.runner_execute?.(node, ctx, runner);

      expect(result?.output.has_error).toBe(true);
      expect(result?.output.error).toBe("Node execution failed");
      expect(result?.output.error_node).toBe("node-1");
      expect(emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "node_error",
          node_id: "error-handler-1",
        })
      );
    });

    it("should stop execution after first error with on_error continue", async () => {
      const node = createMockErrorHandlerNode({
        try_nodes: ["node-1", "node-2"],
        on_error: "continue",
      });
      const ctx = createMockContext();
      const execute_node = vi.fn().mockRejectedValue(new Error("Node 1 failed"));
      const runner = createMockRunner({
        all_nodes: [
          { node_id: "node-1", node_type: "set", label: "Node 1" } as OrcheNodeDefinition,
          { node_id: "node-2", node_type: "set", label: "Node 2" } as OrcheNodeDefinition,
        ],
        execute_node,
      });

      await error_handler_handler.runner_execute?.(node, ctx, runner);

      expect(execute_node).toHaveBeenCalledTimes(1);
    });
  });

  describe("runner_execute — on_error fallback", () => {
    it("should execute fallback_nodes when error occurs with on_error fallback", async () => {
      const node = createMockErrorHandlerNode({
        try_nodes: ["node-1"],
        on_error: "fallback",
        fallback_nodes: ["fallback-1"],
      });
      const ctx = createMockContext();
      const execute_node = vi
        .fn()
        .mockRejectedValueOnce(new Error("Node 1 failed"))
        .mockResolvedValueOnce({ output: { fallback: "result" } });
      const runner = createMockRunner({
        all_nodes: [
          { node_id: "node-1", node_type: "set", label: "Node 1" } as OrcheNodeDefinition,
          { node_id: "fallback-1", node_type: "set", label: "Fallback 1" } as OrcheNodeDefinition,
        ],
        execute_node,
      });

      const result = await error_handler_handler.runner_execute?.(node, ctx, runner);

      expect(result?.output.has_error).toBe(true);
      expect(result?.output.error).toBe("Node 1 failed");
      expect(result?.output.output).toEqual({ fallback: "result" });
      expect(execute_node).toHaveBeenCalledTimes(2);
    });

    it("should pass error context to fallback_nodes in memory", async () => {
      const node = createMockErrorHandlerNode({
        try_nodes: ["node-1"],
        on_error: "fallback",
        fallback_nodes: ["fallback-1"],
      });
      const ctx = createMockContext();
      let fallback_memory: any = null;
      const execute_node = vi
        .fn()
        .mockRejectedValueOnce(new Error("Node 1 failed"))
        .mockImplementation(async (n, opts) => {
          fallback_memory = opts.memory;
          return { output: { fallback: "result" } };
        });
      const runner = createMockRunner({
        all_nodes: [
          { node_id: "node-1", node_type: "set", label: "Node 1" } as OrcheNodeDefinition,
          { node_id: "fallback-1", node_type: "set", label: "Fallback 1" } as OrcheNodeDefinition,
        ],
        state: {
          workflow_id: "wf-1",
          memory: { previous: "data" },
          orche_states: [],
        },
        execute_node,
      });

      await error_handler_handler.runner_execute?.(node, ctx, runner);

      expect(fallback_memory?._error).toEqual({
        node_id: "node-1",
        message: "Node 1 failed",
      });
      expect(fallback_memory?.previous).toBe("data");
    });

    it("should execute multiple fallback_nodes sequentially", async () => {
      const node = createMockErrorHandlerNode({
        try_nodes: ["node-1"],
        on_error: "fallback",
        fallback_nodes: ["fallback-1", "fallback-2"],
      });
      const ctx = createMockContext();
      const execute_node = vi
        .fn()
        .mockRejectedValueOnce(new Error("Node 1 failed"))
        .mockResolvedValueOnce({ output: { step: 1 } })
        .mockResolvedValueOnce({ output: { step: 2 } });
      const runner = createMockRunner({
        all_nodes: [
          { node_id: "node-1", node_type: "set", label: "Node 1" } as OrcheNodeDefinition,
          { node_id: "fallback-1", node_type: "set", label: "Fallback 1" } as OrcheNodeDefinition,
          { node_id: "fallback-2", node_type: "set", label: "Fallback 2" } as OrcheNodeDefinition,
        ],
        execute_node,
      });

      const result = await error_handler_handler.runner_execute?.(node, ctx, runner);

      expect(result?.output.output).toEqual({ step: 2 });
      expect(execute_node).toHaveBeenCalledTimes(3);
    });

    it("should return error if fallback_nodes execution fails", async () => {
      const node = createMockErrorHandlerNode({
        try_nodes: ["node-1"],
        on_error: "fallback",
        fallback_nodes: ["fallback-1"],
      });
      const ctx = createMockContext();
      const execute_node = vi
        .fn()
        .mockRejectedValueOnce(new Error("Node 1 failed"))
        .mockRejectedValueOnce(new Error("Fallback failed"));
      const runner = createMockRunner({
        all_nodes: [
          { node_id: "node-1", node_type: "set", label: "Node 1" } as OrcheNodeDefinition,
          { node_id: "fallback-1", node_type: "set", label: "Fallback 1" } as OrcheNodeDefinition,
        ],
        execute_node,
      });

      const result = await error_handler_handler.runner_execute?.(node, ctx, runner);

      expect(result?.output.has_error).toBe(true);
      expect(result?.output.error).toContain("fallback fallback-1 failed");
      expect(result?.output.error_node).toBe("fallback-1");
    });

    it("should skip non-existent fallback_nodes", async () => {
      const node = createMockErrorHandlerNode({
        try_nodes: ["node-1"],
        on_error: "fallback",
        fallback_nodes: ["missing-fallback"],
      });
      const ctx = createMockContext();
      const execute_node = vi.fn().mockRejectedValueOnce(new Error("Node 1 failed"));
      const runner = createMockRunner({
        all_nodes: [{ node_id: "node-1", node_type: "set", label: "Node 1" } as OrcheNodeDefinition],
        execute_node,
      });

      const result = await error_handler_handler.runner_execute?.(node, ctx, runner);

      expect(result?.output.has_error).toBe(true);
      expect(result?.output.error).toBe("Node 1 failed");
      expect(result?.output.output).toBeNull();
    });

    it("should handle fallback with empty fallback_nodes list", async () => {
      const node = createMockErrorHandlerNode({
        try_nodes: ["node-1"],
        on_error: "fallback",
        fallback_nodes: [],
      });
      const ctx = createMockContext();
      const execute_node = vi.fn().mockRejectedValueOnce(new Error("Node 1 failed"));
      const runner = createMockRunner({
        all_nodes: [{ node_id: "node-1", node_type: "set", label: "Node 1" } as OrcheNodeDefinition],
        execute_node,
      });

      const result = await error_handler_handler.runner_execute?.(node, ctx, runner);

      expect(result?.output.has_error).toBe(true);
      expect(result?.output.error).toBe("Node 1 failed");
    });
  });

  describe("test (validation)", () => {
    it("should return no warnings for valid configuration", () => {
      const node = createMockErrorHandlerNode({
        try_nodes: ["node-1"],
      });
      const ctx = createMockContext();

      const result = error_handler_handler.test(node, ctx);

      expect(result.warnings).toEqual([]);
    });

    it("should warn when try_nodes is empty", () => {
      const node = createMockErrorHandlerNode({
        try_nodes: [],
      });
      const ctx = createMockContext();

      const result = error_handler_handler.test(node, ctx);

      expect(result.warnings).toContain("try_nodes should contain at least one node");
    });

    it("should warn when on_error is fallback but fallback_nodes missing", () => {
      const node = createMockErrorHandlerNode({
        try_nodes: ["node-1"],
        on_error: "fallback",
        fallback_nodes: undefined,
      });
      const ctx = createMockContext();

      const result = error_handler_handler.test(node, ctx);

      expect(result.warnings).toContain("fallback_nodes required when on_error is fallback");
    });

    it("should warn when on_error is fallback but fallback_nodes empty", () => {
      const node = createMockErrorHandlerNode({
        try_nodes: ["node-1"],
        on_error: "fallback",
        fallback_nodes: [],
      });
      const ctx = createMockContext();

      const result = error_handler_handler.test(node, ctx);

      expect(result.warnings).toContain("fallback_nodes required when on_error is fallback");
    });

    it("should not warn when fallback_nodes present with fallback mode", () => {
      const node = createMockErrorHandlerNode({
        try_nodes: ["node-1"],
        on_error: "fallback",
        fallback_nodes: ["fallback-1"],
      });
      const ctx = createMockContext();

      const result = error_handler_handler.test(node, ctx);

      expect(result.warnings).toEqual([]);
    });

    it("should include preview with try_nodes, on_error, fallback_nodes", () => {
      const node = createMockErrorHandlerNode({
        try_nodes: ["node-1", "node-2"],
        on_error: "fallback",
        fallback_nodes: ["fallback-1"],
      });
      const ctx = createMockContext();

      const result = error_handler_handler.test(node, ctx);

      expect(result.preview.try_nodes).toEqual(["node-1", "node-2"]);
      expect(result.preview.on_error).toBe("fallback");
      expect(result.preview.fallback_nodes).toEqual(["fallback-1"]);
    });

    it("should return multiple warnings together", () => {
      const node = createMockErrorHandlerNode({
        try_nodes: [],
        on_error: "fallback",
        fallback_nodes: undefined,
      });
      const ctx = createMockContext();

      const result = error_handler_handler.test(node, ctx);

      expect(result.warnings.length).toBe(2);
    });
  });

  describe("integration scenarios", () => {
    it("should execute workflow with three sequential try nodes", async () => {
      const node = createMockErrorHandlerNode({
        try_nodes: ["fetch", "process", "save"],
      });
      const ctx = createMockContext();
      const execute_node = vi
        .fn()
        .mockResolvedValueOnce({ output: { data: [1, 2, 3] } })
        .mockResolvedValueOnce({ output: { result: [2, 4, 6] } })
        .mockResolvedValueOnce({ output: { saved: true } });
      const runner = createMockRunner({
        all_nodes: [
          { node_id: "fetch", node_type: "http", label: "Fetch" } as OrcheNodeDefinition,
          { node_id: "process", node_type: "transform", label: "Process" } as OrcheNodeDefinition,
          { node_id: "save", node_type: "file", label: "Save" } as OrcheNodeDefinition,
        ],
        execute_node,
      });

      const result = await error_handler_handler.runner_execute?.(node, ctx, runner);

      expect(result?.output.has_error).toBe(false);
      expect(result?.output.output).toEqual({ saved: true });
      expect(runner.state.memory["fetch"]).toEqual({ data: [1, 2, 3] });
      expect(runner.state.memory["process"]).toEqual({ result: [2, 4, 6] });
      expect(runner.state.memory["save"]).toEqual({ saved: true });
    });

    it("should handle fetch-process-save with fallback on error", async () => {
      const node = createMockErrorHandlerNode({
        try_nodes: ["fetch", "process"],
        on_error: "fallback",
        fallback_nodes: ["alert"],
      });
      const ctx = createMockContext();
      const execute_node = vi
        .fn()
        .mockResolvedValueOnce({ output: { data: [1, 2, 3] } })
        .mockRejectedValueOnce(new Error("Processing failed"))
        .mockResolvedValueOnce({ output: { notified: true } });
      const runner = createMockRunner({
        all_nodes: [
          { node_id: "fetch", node_type: "http", label: "Fetch" } as OrcheNodeDefinition,
          { node_id: "process", node_type: "transform", label: "Process" } as OrcheNodeDefinition,
          { node_id: "alert", node_type: "notify", label: "Alert" } as OrcheNodeDefinition,
        ],
        execute_node,
      });

      const result = await error_handler_handler.runner_execute?.(node, ctx, runner);

      expect(result?.output.has_error).toBe(true);
      expect(result?.output.error).toBe("Processing failed");
      expect(result?.output.output).toEqual({ notified: true });
    });

    it("should track partial success with node memory updates", async () => {
      const node = createMockErrorHandlerNode({
        try_nodes: ["validate", "enrich", "persist"],
      });
      const ctx = createMockContext();
      const execute_node = vi
        .fn()
        .mockResolvedValueOnce({ output: { valid: true } })
        .mockRejectedValueOnce(new Error("Enrichment failed"));
      const runner = createMockRunner({
        all_nodes: [
          { node_id: "validate", node_type: "validator", label: "Validate" } as OrcheNodeDefinition,
          { node_id: "enrich", node_type: "transform", label: "Enrich" } as OrcheNodeDefinition,
          { node_id: "persist", node_type: "db", label: "Persist" } as OrcheNodeDefinition,
        ],
        execute_node,
      });

      const result = await error_handler_handler.runner_execute?.(node, ctx, runner);

      expect(result?.output.has_error).toBe(true);
      expect(runner.state.memory["validate"]).toEqual({ valid: true });
      expect(runner.state.memory["enrich"]).toBeUndefined();
    });
  });

  describe("edge cases", () => {
    it("should handle node with same id in try and fallback", async () => {
      const node = createMockErrorHandlerNode({
        try_nodes: ["node-1"],
        on_error: "fallback",
        fallback_nodes: ["node-1"],
      });
      const ctx = createMockContext();
      const execute_node = vi
        .fn()
        .mockRejectedValueOnce(new Error("First try failed"))
        .mockResolvedValueOnce({ output: { recovered: true } });
      const runner = createMockRunner({
        all_nodes: [{ node_id: "node-1", node_type: "set", label: "Node 1" } as OrcheNodeDefinition],
        execute_node,
      });

      const result = await error_handler_handler.runner_execute?.(node, ctx, runner);

      expect(result?.output.has_error).toBe(true);
      expect(result?.output.output).toEqual({ recovered: true });
    });

    it("should handle error with special characters in message", async () => {
      const node = createMockErrorHandlerNode({
        try_nodes: ["node-1"],
        on_error: "continue",
      });
      const ctx = createMockContext();
      const execute_node = vi.fn().mockRejectedValue(new Error("Error: $special!@# chars \"quoted\""));
      const runner = createMockRunner({
        all_nodes: [{ node_id: "node-1", node_type: "set", label: "Node 1" } as OrcheNodeDefinition],
        execute_node,
      });

      const result = await error_handler_handler.runner_execute?.(node, ctx, runner);

      expect(result?.output.error).toContain("$special!@#");
    });

    it("should skip nodes not matching try_nodes list", async () => {
      const node = createMockErrorHandlerNode({
        try_nodes: ["node-1"],
      });
      const ctx = createMockContext();
      const execute_node = vi.fn();
      const runner = createMockRunner({
        all_nodes: [{ node_id: "other-node", node_type: "set", label: "Other" } as OrcheNodeDefinition],
        execute_node,
      });

      const result = await error_handler_handler.runner_execute?.(node, ctx, runner);

      expect(execute_node).not.toHaveBeenCalled();
      expect(result?.output.has_error).toBe(false);
    });

    it("should preserve memory across fallback execution", async () => {
      const node = createMockErrorHandlerNode({
        try_nodes: ["node-1"],
        on_error: "fallback",
        fallback_nodes: ["fallback-1"],
      });
      const ctx = createMockContext();
      const execute_node = vi
        .fn()
        .mockRejectedValueOnce(new Error("Failed"))
        .mockImplementation(async (n, opts) => {
          opts.memory.fallback_executed = true;
          return { output: { status: "fallback" } };
        });
      const runner = createMockRunner({
        all_nodes: [
          { node_id: "node-1", node_type: "set", label: "Node 1" } as OrcheNodeDefinition,
          { node_id: "fallback-1", node_type: "set", label: "Fallback 1" } as OrcheNodeDefinition,
        ],
        state: {
          workflow_id: "wf-1",
          memory: { initial: "value" },
          orche_states: [],
        },
        execute_node,
      });

      await error_handler_handler.runner_execute?.(node, ctx, runner);

      expect(runner.state.memory["initial"]).toBe("value");
    });
  });
});
