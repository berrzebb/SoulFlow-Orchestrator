/** Merge (Join) 노드 핸들러 테스트
 *
 * 목표: merge_handler를 통한 upstram 노드 결과 병합 검증
 *       - execute: depends_on 노드들의 데이터 수집 및 병합
 *       - merge_mode: "collect" (배열) vs 기본 (객체)
 *       - depends_on: 여러 노드의 결과를 메모리에서 검색
 *       - Missing data: undefined 데이터 무시
 *       - Validation: test() 누락된 입력 경고
 */

import { describe, it, expect } from "vitest";
import { merge_handler } from "@src/agent/nodes/merge.js";
import type { MergeNodeDefinition, OrcheNodeDefinition } from "@src/agent/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "@src/agent/node-registry.js";

/* ── Mock Data ── */

const createMockMergeNode = (overrides?: Partial<MergeNodeDefinition>): MergeNodeDefinition => ({
  node_id: "merge-1",
  title: "Test Merge Node",
  node_type: "merge",
  depends_on: ["node-1", "node-2", "node-3"],
  merge_mode: "wait_all",
  ...overrides,
});

const createMockContext = (overrides?: Partial<OrcheNodeExecutorContext>): OrcheNodeExecutorContext => ({
  memory: {
    agent_id: "agent-1",
    user_id: "user-1",
    workspace_id: "workspace-1",
    "node-1": { name: "Alice", age: 30 },
    "node-2": [1, 2, 3],
    "node-3": "result from node 3",
    previous_output: {},
  },
  ...overrides,
});

/* ── Tests ── */

describe("Merge Node Handler", () => {
  describe("metadata", () => {
    it("should have correct node_type", () => {
      expect(merge_handler.node_type).toBe("merge");
    });

    it("should have output_schema with merged field", () => {
      const schema = merge_handler.output_schema || [];
      const fields = schema.map((f) => f.name);
      expect(fields).toContain("merged");
    });

    it("should have create_default returning valid node template", () => {
      const defaultNode = merge_handler.create_default?.();
      expect(defaultNode?.merge_mode).toBe("wait_all");
    });
  });

  describe("execute — wait_all merge mode (default)", () => {
    it("should merge multiple inputs into object", async () => {
      const node = createMockMergeNode({
        depends_on: ["node-1", "node-2"],
      });
      const ctx = createMockContext();

      const result = await merge_handler.execute(node, ctx);

      expect(result.output.merged).toEqual({
        "node-1": { name: "Alice", age: 30 },
        "node-2": [1, 2, 3],
      });
    });

    it("should use node_id as key in merged object", async () => {
      const node = createMockMergeNode({
        depends_on: ["node-1", "node-2", "node-3"],
      });
      const ctx = createMockContext();

      const result = await merge_handler.execute(node, ctx);

      expect(Object.keys(result.output.merged)).toEqual([
        "node-1",
        "node-2",
        "node-3",
      ]);
    });

    it("should preserve data types in merged output", async () => {
      const node = createMockMergeNode({
        depends_on: ["node-1", "node-2", "node-3"],
      });
      const ctx = createMockContext();

      const result = await merge_handler.execute(node, ctx);

      expect(typeof result.output.merged["node-1"]).toBe("object");
      expect(Array.isArray(result.output.merged["node-2"])).toBe(true);
      expect(typeof result.output.merged["node-3"]).toBe("string");
    });

    it("should skip undefined upstream nodes", async () => {
      const node = createMockMergeNode({
        depends_on: ["node-1", "nonexistent", "node-2"],
      });
      const ctx = createMockContext();

      const result = await merge_handler.execute(node, ctx);

      expect(Object.keys(result.output.merged)).not.toContain("nonexistent");
      expect(result.output.merged).toEqual({
        "node-1": { name: "Alice", age: 30 },
        "node-2": [1, 2, 3],
      });
    });

    it("should return empty object if all dependencies missing", async () => {
      const node = createMockMergeNode({
        depends_on: ["missing-1", "missing-2"],
      });
      const ctx = createMockContext();

      const result = await merge_handler.execute(node, ctx);

      expect(result.output.merged).toEqual({});
    });

    it("should handle empty depends_on list", async () => {
      const node = createMockMergeNode({
        depends_on: [],
      });
      const ctx = createMockContext();

      const result = await merge_handler.execute(node, ctx);

      expect(result.output.merged).toEqual({});
    });
  });

  describe("execute — collect merge mode", () => {
    it("should merge multiple inputs into array", async () => {
      const node = createMockMergeNode({
        depends_on: ["node-1", "node-2", "node-3"],
        merge_mode: "collect",
      });
      const ctx = createMockContext();

      const result = await merge_handler.execute(node, ctx);

      expect(Array.isArray(result.output.merged)).toBe(true);
      expect(result.output.merged).toEqual([
        { name: "Alice", age: 30 },
        [1, 2, 3],
        "result from node 3",
      ]);
    });

    it("should preserve order in collect mode", async () => {
      const node = createMockMergeNode({
        depends_on: ["node-3", "node-1", "node-2"],
        merge_mode: "collect",
      });
      const ctx = createMockContext();

      const result = await merge_handler.execute(node, ctx);

      expect(result.output.merged[0]).toBe("result from node 3");
      expect(result.output.merged[1]).toEqual({ name: "Alice", age: 30 });
      expect(result.output.merged[2]).toEqual([1, 2, 3]);
    });

    it("should skip undefined items in collect mode", async () => {
      const node = createMockMergeNode({
        depends_on: ["node-1", "missing", "node-2"],
        merge_mode: "collect",
      });
      const ctx = createMockContext();

      const result = await merge_handler.execute(node, ctx);

      expect(result.output.merged).toHaveLength(2);
      expect(result.output.merged).toEqual([
        { name: "Alice", age: 30 },
        [1, 2, 3],
      ]);
    });

    it("should return empty array if all missing in collect mode", async () => {
      const node = createMockMergeNode({
        depends_on: ["missing-1", "missing-2"],
        merge_mode: "collect",
      });
      const ctx = createMockContext();

      const result = await merge_handler.execute(node, ctx);

      expect(result.output.merged).toEqual([]);
    });
  });

  describe("execute — merge modes comparison", () => {
    it("should handle wait_all with single input", async () => {
      const node = createMockMergeNode({
        depends_on: ["node-1"],
        merge_mode: "wait_all",
      });
      const ctx = createMockContext();

      const result = await merge_handler.execute(node, ctx);

      expect(result.output.merged).toEqual({
        "node-1": { name: "Alice", age: 30 },
      });
    });

    it("should handle collect with single input", async () => {
      const node = createMockMergeNode({
        depends_on: ["node-1"],
        merge_mode: "collect",
      });
      const ctx = createMockContext();

      const result = await merge_handler.execute(node, ctx);

      expect(result.output.merged).toEqual([{ name: "Alice", age: 30 }]);
    });
  });

  describe("execute — complex data types", () => {
    it("should merge nested objects", async () => {
      const node = createMockMergeNode({
        depends_on: ["complex-obj"],
      });
      const ctx = createMockContext({
        memory: {
          ...createMockContext().memory,
          "complex-obj": {
            user: { name: "Bob", address: { city: "NYC" } },
            scores: [95, 87, 92],
          },
        },
      });

      const result = await merge_handler.execute(node, ctx);

      expect(result.output.merged["complex-obj"].user.address.city).toBe("NYC");
    });

    it("should merge arrays", async () => {
      const node = createMockMergeNode({
        depends_on: ["arr-1", "arr-2"],
      });
      const ctx = createMockContext({
        memory: {
          ...createMockContext().memory,
          "arr-1": [1, 2, 3],
          "arr-2": ["a", "b", "c"],
        },
      });

      const result = await merge_handler.execute(node, ctx);

      expect(result.output.merged["arr-1"]).toEqual([1, 2, 3]);
      expect(result.output.merged["arr-2"]).toEqual(["a", "b", "c"]);
    });

    it("should merge null values", async () => {
      const node = createMockMergeNode({
        depends_on: ["null-node", "node-1"],
      });
      const ctx = createMockContext({
        memory: {
          ...createMockContext().memory,
          "null-node": null,
        },
      });

      const result = await merge_handler.execute(node, ctx);

      // null is not undefined, so it should be included
      expect("null-node" in result.output.merged).toBe(true);
      expect(result.output.merged["null-node"]).toBe(null);
    });

    it("should skip false values only if they are undefined", async () => {
      const node = createMockMergeNode({
        depends_on: ["false-node", "zero-node", "empty-str"],
      });
      const ctx = createMockContext({
        memory: {
          ...createMockContext().memory,
          "false-node": false,
          "zero-node": 0,
          "empty-str": "",
        },
      });

      const result = await merge_handler.execute(node, ctx);

      // All falsy values should be included (not undefined)
      expect(result.output.merged["false-node"]).toBe(false);
      expect(result.output.merged["zero-node"]).toBe(0);
      expect(result.output.merged["empty-str"]).toBe("");
    });
  });

  describe("test (validation)", () => {
    it("should return no warnings when all dependencies available", () => {
      const node = createMockMergeNode({
        depends_on: ["node-1", "node-2"],
      });
      const ctx = createMockContext();

      const result = merge_handler.test(node, ctx);

      expect(result.warnings).toEqual([]);
    });

    it("should warn about missing upstream data", () => {
      const node = createMockMergeNode({
        depends_on: ["node-1", "missing"],
      });
      const ctx = createMockContext();

      const result = merge_handler.test(node, ctx);

      expect(result.warnings).toContain("missing upstream data: missing");
    });

    it("should warn about multiple missing inputs", () => {
      const node = createMockMergeNode({
        depends_on: ["node-1", "missing-1", "missing-2"],
      });
      const ctx = createMockContext();

      const result = merge_handler.test(node, ctx);

      expect(result.warnings[0]).toContain("missing-1");
      expect(result.warnings[0]).toContain("missing-2");
    });

    it("should return preview with available and missing inputs", () => {
      const node = createMockMergeNode({
        depends_on: ["node-1", "missing-1", "node-2"],
      });
      const ctx = createMockContext();

      const result = merge_handler.test(node, ctx);

      expect(result.preview.available_inputs).toEqual(["node-1", "node-2"]);
      expect(result.preview.missing_inputs).toEqual(["missing-1"]);
    });

    it("should show merge_mode in preview", () => {
      const node = createMockMergeNode({
        merge_mode: "collect",
      });
      const ctx = createMockContext();

      const result = merge_handler.test(node, ctx);

      expect(result.preview.merge_mode).toBe("collect");
    });

    it("should return empty preview when no dependencies", () => {
      const node = createMockMergeNode({
        depends_on: [],
      });
      const ctx = createMockContext();

      const result = merge_handler.test(node, ctx);

      expect(result.preview.available_inputs).toEqual([]);
      expect(result.preview.missing_inputs).toEqual([]);
      expect(result.warnings).toEqual([]);
    });
  });

  describe("integration scenarios", () => {
    it("should merge results from multiple workflow branches", async () => {
      const node = createMockMergeNode({
        depends_on: ["branch-a", "branch-b", "branch-c"],
        merge_mode: "wait_all",
      });
      const ctx = createMockContext({
        memory: {
          ...createMockContext().memory,
          "branch-a": { result: "success", time: 100 },
          "branch-b": { result: "pending", time: 50 },
          "branch-c": { result: "failed", error: "timeout" },
        },
      });

      const result = await merge_handler.execute(node, ctx);

      expect(Object.keys(result.output.merged)).toHaveLength(3);
      expect(result.output.merged["branch-a"].result).toBe("success");
      expect(result.output.merged["branch-b"].result).toBe("pending");
      expect(result.output.merged["branch-c"].error).toBe("timeout");
    });

    it("should collect numeric results from parallel tasks", async () => {
      const node = createMockMergeNode({
        depends_on: ["task-1", "task-2", "task-3"],
        merge_mode: "collect",
      });
      const ctx = createMockContext({
        memory: {
          ...createMockContext().memory,
          "task-1": 42,
          "task-2": 100,
          "task-3": 75,
        },
      });

      const result = await merge_handler.execute(node, ctx);

      expect(result.output.merged).toEqual([42, 100, 75]);
    });

    it("should gracefully handle partial result collection", async () => {
      const node = createMockMergeNode({
        depends_on: ["api-1", "api-2", "api-3"],
        merge_mode: "wait_all",
      });
      const ctx = createMockContext({
        memory: {
          ...createMockContext().memory,
          "api-1": { status: 200, data: [1, 2] },
          "api-3": { status: 200, data: [5, 6] },
          // api-2 missing
        },
      });

      const result = await merge_handler.execute(node, ctx);

      expect(Object.keys(result.output.merged)).toHaveLength(2);
      expect("api-2" in result.output.merged).toBe(false);
    });
  });
});
