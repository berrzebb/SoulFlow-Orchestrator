/** Gate (K-of-N 조건부 진행) 노드 핸들러 테스트
 *
 * 목표: gate_handler를 통한 K-of-N 조건부 진행 검증
 *       - execute: 완료/대기 노드 분류 및 quorum 체크
 *       - completed: 메모리에서 정의된 노드들
 *       - pending: 메모리에서 정의되지 않은 노드들
 *       - quorum_met: completed >= quorum 확인
 *       - results: 완료된 노드들의 데이터
 */

import { describe, it, expect } from "vitest";
import { gate_handler } from "@src/agent/nodes/gate.js";
import type { GateNodeDefinition, OrcheNodeDefinition } from "@src/agent/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "@src/agent/node-registry.js";

/* ── Mock Data ── */

const createMockGateNode = (overrides?: Partial<GateNodeDefinition>): GateNodeDefinition => ({
  node_id: "gate-1",
  title: "Test Gate Node",
  node_type: "gate",
  depends_on: ["src-1", "src-2", "src-3"],
  quorum: 2,
  timeout_ms: 300_000,
  on_timeout: "proceed" as const,
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

/* ── Tests ── */

describe("Gate Node Handler", () => {
  describe("metadata", () => {
    it("should have correct node_type", () => {
      expect(gate_handler.node_type).toBe("gate");
    });

    it("should have output_schema with completed, pending, results, quorum_met", () => {
      const schema = gate_handler.output_schema || [];
      const fields = schema.map((f) => f.name);
      expect(fields).toContain("completed");
      expect(fields).toContain("pending");
      expect(fields).toContain("results");
      expect(fields).toContain("quorum_met");
    });

    it("should have create_default returning valid node template", () => {
      const defaultNode = gate_handler.create_default?.();
      expect(defaultNode?.quorum).toBe(1);
      expect(defaultNode?.timeout_ms).toBe(300_000);
      expect(defaultNode?.on_timeout).toBe("proceed");
    });
  });

  describe("execute — basic operation", () => {
    it("should classify completed and pending sources", async () => {
      const node = createMockGateNode({
        depends_on: ["src-1", "src-2", "src-3"],
        quorum: 1,
      });
      const ctx = createMockContext({
        memory: {
          "src-1": { result: "data1" },
          "src-3": { result: "data3" },
          // src-2 is missing
        },
      });

      const result = await gate_handler.execute(node, ctx);

      expect(result.output.completed).toEqual(["src-1", "src-3"]);
      expect(result.output.pending).toEqual(["src-2"]);
    });

    it("should collect results from completed sources", async () => {
      const node = createMockGateNode({
        depends_on: ["src-1", "src-2"],
        quorum: 1,
      });
      const ctx = createMockContext({
        memory: {
          "src-1": { data: "value1" },
          "src-2": { data: "value2" },
        },
      });

      const result = await gate_handler.execute(node, ctx);

      expect(result.output.results).toEqual({
        "src-1": { data: "value1" },
        "src-2": { data: "value2" },
      });
    });

    it("should check quorum met condition", async () => {
      const node = createMockGateNode({
        depends_on: ["a", "b", "c"],
        quorum: 2,
      });
      const ctx = createMockContext({
        memory: {
          "a": 1,
          "b": 2,
          // c is missing
        },
      });

      const result = await gate_handler.execute(node, ctx);

      expect(result.output.completed).toHaveLength(2);
      expect(result.output.quorum_met).toBe(true);
    });

    it("should fail quorum when not enough completed", async () => {
      const node = createMockGateNode({
        depends_on: ["x", "y", "z"],
        quorum: 3,
      });
      const ctx = createMockContext({
        memory: {
          "x": 1,
          "y": 2,
          // z is missing
        },
      });

      const result = await gate_handler.execute(node, ctx);

      expect(result.output.completed).toHaveLength(2);
      expect(result.output.quorum_met).toBe(false);
    });

    it("should handle empty depends_on", async () => {
      const node = createMockGateNode({
        depends_on: [],
        quorum: 1,
      });
      const ctx = createMockContext();

      const result = await gate_handler.execute(node, ctx);

      expect(result.output.completed).toEqual([]);
      expect(result.output.pending).toEqual([]);
      expect(result.output.quorum_met).toBe(false);
    });

    it("should handle all sources completed", async () => {
      const node = createMockGateNode({
        depends_on: ["p", "q"],
        quorum: 2,
      });
      const ctx = createMockContext({
        memory: {
          "p": { status: "ok" },
          "q": { status: "ok" },
        },
      });

      const result = await gate_handler.execute(node, ctx);

      expect(result.output.completed).toHaveLength(2);
      expect(result.output.pending).toHaveLength(0);
      expect(result.output.quorum_met).toBe(true);
    });

    it("should handle all sources pending", async () => {
      const node = createMockGateNode({
        depends_on: ["m", "n"],
        quorum: 1,
      });
      const ctx = createMockContext();

      const result = await gate_handler.execute(node, ctx);

      expect(result.output.completed).toHaveLength(0);
      expect(result.output.pending).toHaveLength(2);
      expect(result.output.quorum_met).toBe(false);
    });
  });

  describe("execute — preserve data types", () => {
    it("should preserve string values", async () => {
      const node = createMockGateNode({
        depends_on: ["src"],
        quorum: 1,
      });
      const ctx = createMockContext({
        memory: { src: "text value" },
      });

      const result = await gate_handler.execute(node, ctx);

      expect(result.output.results.src).toBe("text value");
    });

    it("should preserve numeric values", async () => {
      const node = createMockGateNode({
        depends_on: ["src"],
        quorum: 1,
      });
      const ctx = createMockContext({
        memory: { src: 42.5 },
      });

      const result = await gate_handler.execute(node, ctx);

      expect(result.output.results.src).toBe(42.5);
    });

    it("should preserve array values", async () => {
      const node = createMockGateNode({
        depends_on: ["src"],
        quorum: 1,
      });
      const ctx = createMockContext({
        memory: { src: [1, 2, 3] },
      });

      const result = await gate_handler.execute(node, ctx);

      expect(result.output.results.src).toEqual([1, 2, 3]);
    });

    it("should preserve object values", async () => {
      const node = createMockGateNode({
        depends_on: ["src"],
        quorum: 1,
      });
      const ctx = createMockContext({
        memory: { src: { nested: { value: 99 } } },
      });

      const result = await gate_handler.execute(node, ctx);

      expect(result.output.results.src).toEqual({ nested: { value: 99 } });
    });

    it("should preserve null values", async () => {
      const node = createMockGateNode({
        depends_on: ["src"],
        quorum: 1,
      });
      const ctx = createMockContext({
        memory: { src: null },
      });

      const result = await gate_handler.execute(node, ctx);

      expect(result.output.results.src).toBeNull();
    });

    it("should skip undefined values (not in results)", async () => {
      const node = createMockGateNode({
        depends_on: ["src1", "src2"],
        quorum: 1,
      });
      const ctx = createMockContext({
        memory: { src1: "value" },
      });

      const result = await gate_handler.execute(node, ctx);

      expect("src2" in result.output.results).toBe(false);
    });
  });

  describe("execute — quorum variations", () => {
    it("should default quorum to 1 when not specified", async () => {
      const node = createMockGateNode({
        depends_on: ["a", "b"],
      });
      delete node.quorum;
      const ctx = createMockContext({
        memory: { "a": 1 },
      });

      const result = await gate_handler.execute(node, ctx);

      expect(result.output.quorum_met).toBe(true);
    });

    it("should support quorum equal to source count", async () => {
      const node = createMockGateNode({
        depends_on: ["a", "b", "c"],
        quorum: 3,
      });
      const ctx = createMockContext({
        memory: {
          "a": 1,
          "b": 2,
          "c": 3,
        },
      });

      const result = await gate_handler.execute(node, ctx);

      expect(result.output.quorum_met).toBe(true);
    });

    it("should support quorum of 1", async () => {
      const node = createMockGateNode({
        depends_on: ["x", "y", "z"],
        quorum: 1,
      });
      const ctx = createMockContext({
        memory: { "x": { done: true } },
      });

      const result = await gate_handler.execute(node, ctx);

      expect(result.output.quorum_met).toBe(true);
    });
  });

  describe("test (validation)", () => {
    it("should return no warnings for valid config", () => {
      const node = createMockGateNode({
        depends_on: ["a", "b", "c"],
        quorum: 2,
      });
      const ctx = createMockContext();

      const result = gate_handler.test(node, ctx);

      expect(result.warnings).toEqual([]);
    });

    it("should warn when depends_on is empty", () => {
      const node = createMockGateNode({
        depends_on: [],
      });
      const ctx = createMockContext();

      const result = gate_handler.test(node, ctx);

      expect(result.warnings).toContain("depends_on is empty — gate needs source nodes");
    });

    it("should warn when quorum exceeds source count", () => {
      const node = createMockGateNode({
        depends_on: ["a", "b"],
        quorum: 3,
      });
      const ctx = createMockContext();

      const result = gate_handler.test(node, ctx);

      expect(result.warnings).toContain("quorum exceeds number of source nodes");
    });

    it("should warn when quorum is less than 1", () => {
      const node = createMockGateNode({
        depends_on: ["a"],
        quorum: 0,
      });
      const ctx = createMockContext();

      const result = gate_handler.test(node, ctx);

      expect(result.warnings).toContain("quorum must be at least 1");
    });

    it("should include preview with quorum and source count", () => {
      const node = createMockGateNode({
        depends_on: ["a", "b", "c"],
        quorum: 2,
      });
      const ctx = createMockContext();

      const result = gate_handler.test(node, ctx);

      expect(result.preview.quorum).toBe(2);
      expect(result.preview.sources).toBe(3);
    });

    it("should include on_timeout in preview", () => {
      const node = createMockGateNode({
        on_timeout: "fail" as const,
      });
      const ctx = createMockContext();

      const result = gate_handler.test(node, ctx);

      expect(result.preview.on_timeout).toBe("fail");
    });
  });

  describe("integration scenarios", () => {
    it("should gate parallel task results", async () => {
      const node = createMockGateNode({
        depends_on: ["api_call", "db_query", "cache_fetch"],
        quorum: 2,
      });
      const ctx = createMockContext({
        memory: {
          "api_call": { status: 200, data: ["item1", "item2"] },
          "db_query": { count: 2, items: ["db1", "db2"] },
          // cache_fetch is still loading
        },
      });

      const result = await gate_handler.execute(node, ctx);

      expect(result.output.completed).toHaveLength(2);
      expect(result.output.pending).toEqual(["cache_fetch"]);
      expect(result.output.quorum_met).toBe(true);
    });

    it("should wait for consensus among services", async () => {
      const node = createMockGateNode({
        depends_on: ["service_a", "service_b", "service_c"],
        quorum: 3,
      });
      const ctx = createMockContext({
        memory: {
          "service_a": { ready: true },
          "service_b": { ready: true },
          // service_c still initializing
        },
      });

      const result = await gate_handler.execute(node, ctx);

      expect(result.output.quorum_met).toBe(false);
      expect(result.output.pending).toContain("service_c");
    });

    it("should handle cleanup with partial completions", async () => {
      const node = createMockGateNode({
        depends_on: ["cleanup_1", "cleanup_2", "cleanup_3"],
        quorum: 2,
      });
      const ctx = createMockContext({
        memory: {
          "cleanup_1": { status: "completed" },
          "cleanup_2": { status: "completed" },
          // cleanup_3 failed silently
        },
      });

      const result = await gate_handler.execute(node, ctx);

      expect(result.output.quorum_met).toBe(true);
      expect(result.output.results).toHaveProperty("cleanup_1");
      expect(result.output.results).toHaveProperty("cleanup_2");
    });

    it("should support fan-in from many sources", async () => {
      const sources = Array.from({ length: 10 }, (_, i) => `source_${i}`);
      const node = createMockGateNode({
        depends_on: sources,
        quorum: 5,
      });
      const memory: Record<string, number> = {};
      for (let i = 0; i < 7; i++) {
        memory[`source_${i}`] = i;
      }
      const ctx = createMockContext({ memory });

      const result = await gate_handler.execute(node, ctx);

      expect(result.output.completed).toHaveLength(7);
      expect(result.output.pending).toHaveLength(3);
      expect(result.output.quorum_met).toBe(true);
    });

    it("should handle timeout decision flags", async () => {
      const node = createMockGateNode({
        depends_on: ["resource_1", "resource_2"],
        quorum: 2,
        on_timeout: "fail",
      });
      const ctx = createMockContext({
        memory: {
          "resource_1": { allocated: true },
          // resource_2 timeout/missing
        },
      });

      const result = await gate_handler.execute(node, ctx);

      expect(result.output.quorum_met).toBe(false);
    });
  });
});
