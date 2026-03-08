/** Aggregate (집계) 노드 핸들러 테스트
 *
 * 목표: aggregate_handler를 통한 배열 집계 검증
 *       - operations: count, sum, avg, min, max, join, unique, flatten
 *       - nested paths: get_nested_value로 경로 접근
 *       - 다양한 데이터 타입 처리
 */

import { describe, it, expect } from "vitest";
import { aggregate_handler } from "@src/agent/nodes/aggregate.js";
import type { AggregateNodeDefinition, OrcheNodeDefinition } from "@src/agent/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "@src/agent/node-registry.js";

/* ── Mock Data ── */

const createMockAggregateNode = (overrides?: Partial<AggregateNodeDefinition>): AggregateNodeDefinition => ({
  node_id: "aggregate-1",
  title: "Test Aggregate Node",
  node_type: "aggregate",
  operation: "collect",
  array_field: "items",
  separator: "\n",
  ...overrides,
});

const createMockContext = (overrides?: Partial<OrcheNodeExecutorContext>): OrcheNodeExecutorContext => ({
  memory: {
    agent_id: "agent-1",
    user_id: "user-1",
    workspace_id: "workspace-1",
    items: [1, 2, 3, 4, 5],
    previous_output: {},
  },
  ...overrides,
});

/* ── Tests ── */

describe("Aggregate Node Handler", () => {
  describe("metadata", () => {
    it("should have correct node_type", () => {
      expect(aggregate_handler.node_type).toBe("aggregate");
    });

    it("should have output_schema with result and count", () => {
      const schema = aggregate_handler.output_schema || [];
      const fields = schema.map((f) => f.name);
      expect(fields).toContain("result");
      expect(fields).toContain("count");
    });

    it("should have create_default returning valid node template", () => {
      const defaultNode = aggregate_handler.create_default?.();
      expect(defaultNode?.operation).toBe("collect");
    });
  });

  describe("execute — collect operation (default)", () => {
    it("should return items as array", async () => {
      const node = createMockAggregateNode({
        operation: "collect",
        array_field: "items",
      });
      const ctx = createMockContext();

      const result = await aggregate_handler.execute(node, ctx);

      expect(result.output.result).toEqual([1, 2, 3, 4, 5]);
      expect(result.output.count).toBe(5);
    });

    it("should return empty array for empty list", async () => {
      const node = createMockAggregateNode({
        operation: "collect",
        array_field: "empty_items",
      });
      const ctx = createMockContext({
        memory: { empty_items: [] },
      });

      const result = await aggregate_handler.execute(node, ctx);

      expect(result.output.result).toEqual([]);
      expect(result.output.count).toBe(0);
    });
  });

  describe("execute — count operation", () => {
    it("should count array items", async () => {
      const node = createMockAggregateNode({
        operation: "count",
        array_field: "items",
      });
      const ctx = createMockContext();

      const result = await aggregate_handler.execute(node, ctx);

      expect(result.output.result).toBe(5);
      expect(result.output.count).toBe(5);
    });

    it("should return 0 for empty array", async () => {
      const node = createMockAggregateNode({
        operation: "count",
        array_field: "numbers",
      });
      const ctx = createMockContext({
        memory: { numbers: [] },
      });

      const result = await aggregate_handler.execute(node, ctx);

      expect(result.output.result).toBe(0);
    });
  });

  describe("execute — sum operation", () => {
    it("should sum numeric values", async () => {
      const node = createMockAggregateNode({
        operation: "sum",
        array_field: "numbers",
      });
      const ctx = createMockContext({
        memory: { numbers: [10, 20, 30, 40] },
      });

      const result = await aggregate_handler.execute(node, ctx);

      expect(result.output.result).toBe(100);
    });

    it("should handle string numbers", async () => {
      const node = createMockAggregateNode({
        operation: "sum",
        array_field: "str_nums",
      });
      const ctx = createMockContext({
        memory: { str_nums: ["5", "15", "25"] },
      });

      const result = await aggregate_handler.execute(node, ctx);

      expect(result.output.result).toBe(45);
    });

    it("should ignore non-numeric values", async () => {
      const node = createMockAggregateNode({
        operation: "sum",
        array_field: "mixed",
      });
      const ctx = createMockContext({
        memory: { mixed: [10, "abc", 20, null, 30] },
      });

      const result = await aggregate_handler.execute(node, ctx);

      expect(result.output.result).toBe(60);
    });
  });

  describe("execute — avg operation", () => {
    it("should calculate average", async () => {
      const node = createMockAggregateNode({
        operation: "avg",
        array_field: "scores",
      });
      const ctx = createMockContext({
        memory: { scores: [10, 20, 30, 40] },
      });

      const result = await aggregate_handler.execute(node, ctx);

      expect(result.output.result).toBe(25);
    });

    it("should return 0 for empty array", async () => {
      const node = createMockAggregateNode({
        operation: "avg",
        array_field: "empty",
      });
      const ctx = createMockContext({
        memory: { empty: [] },
      });

      const result = await aggregate_handler.execute(node, ctx);

      expect(result.output.result).toBe(0);
    });
  });

  describe("execute — min/max operations", () => {
    it("should find minimum value", async () => {
      const node = createMockAggregateNode({
        operation: "min",
        array_field: "numbers",
      });
      const ctx = createMockContext({
        memory: { numbers: [50, 10, 40, 20, 30] },
      });

      const result = await aggregate_handler.execute(node, ctx);

      expect(result.output.result).toBe(10);
    });

    it("should find maximum value", async () => {
      const node = createMockAggregateNode({
        operation: "max",
        array_field: "numbers",
      });
      const ctx = createMockContext({
        memory: { numbers: [50, 10, 40, 20, 30] },
      });

      const result = await aggregate_handler.execute(node, ctx);

      expect(result.output.result).toBe(50);
    });

    it("should return null for empty array in min/max", async () => {
      const node = createMockAggregateNode({
        operation: "min",
        array_field: "empty",
      });
      const ctx = createMockContext({
        memory: { empty: [] },
      });

      const result = await aggregate_handler.execute(node, ctx);

      expect(result.output.result).toBeNull();
    });

    it("should handle non-finite values in min/max", async () => {
      const node = createMockAggregateNode({
        operation: "min",
        array_field: "mixed",
      });
      const ctx = createMockContext({
        memory: { mixed: [Infinity, 5, "abc", 10] },
      });

      const result = await aggregate_handler.execute(node, ctx);

      expect(result.output.result).toBe(5);
    });
  });

  describe("execute — join operation", () => {
    it("should join items with newline", async () => {
      const node = createMockAggregateNode({
        operation: "join",
        array_field: "lines",
        separator: "\n",
      });
      const ctx = createMockContext({
        memory: { lines: ["line1", "line2", "line3"] },
      });

      const result = await aggregate_handler.execute(node, ctx);

      expect(result.output.result).toBe("line1\nline2\nline3");
    });

    it("should join with custom separator", async () => {
      const node = createMockAggregateNode({
        operation: "join",
        array_field: "words",
        separator: ", ",
      });
      const ctx = createMockContext({
        memory: { words: ["apple", "banana", "cherry"] },
      });

      const result = await aggregate_handler.execute(node, ctx);

      expect(result.output.result).toBe("apple, banana, cherry");
    });

    it("should convert numbers to strings in join", async () => {
      const node = createMockAggregateNode({
        operation: "join",
        array_field: "numbers",
        separator: "|",
      });
      const ctx = createMockContext({
        memory: { numbers: [1, 2, 3] },
      });

      const result = await aggregate_handler.execute(node, ctx);

      expect(result.output.result).toBe("1|2|3");
    });
  });

  describe("execute — unique operation", () => {
    it("should deduplicate items", async () => {
      const node = createMockAggregateNode({
        operation: "unique",
        array_field: "items",
      });
      const ctx = createMockContext({
        memory: { items: ["a", "b", "a", "c", "b", "a"] },
      });

      const result = await aggregate_handler.execute(node, ctx);

      expect(result.output.result).toEqual(["a", "b", "c"]);
    });

    it("should handle numeric duplicates", async () => {
      const node = createMockAggregateNode({
        operation: "unique",
        array_field: "numbers",
      });
      const ctx = createMockContext({
        memory: { numbers: [1, 2, 1, 3, 2, 1] },
      });

      const result = await aggregate_handler.execute(node, ctx);

      expect(result.output.result).toEqual(["1", "2", "3"]);
    });
  });

  describe("execute — flatten operation", () => {
    it("should flatten one level deep", async () => {
      const node = createMockAggregateNode({
        operation: "flatten",
        array_field: "nested",
      });
      const ctx = createMockContext({
        memory: { nested: [[1, 2], [3, 4], [5]] },
      });

      const result = await aggregate_handler.execute(node, ctx);

      expect(result.output.result).toEqual([1, 2, 3, 4, 5]);
    });

    it("should handle mixed nested levels", async () => {
      const node = createMockAggregateNode({
        operation: "flatten",
        array_field: "mixed",
      });
      const ctx = createMockContext({
        memory: { mixed: [1, [2, 3], [[4, 5]], 6] },
      });

      const result = await aggregate_handler.execute(node, ctx);

      expect(result.output.result).toEqual([1, 2, 3, [4, 5], 6]);
    });
  });

  describe("execute — array_field path resolution", () => {
    it("should access simple array field", async () => {
      const node = createMockAggregateNode({
        operation: "count",
        array_field: "data",
      });
      const ctx = createMockContext({
        memory: { data: [10, 20, 30] },
      });

      const result = await aggregate_handler.execute(node, ctx);

      expect(result.output.count).toBe(3);
    });

    it("should access nested array field", async () => {
      const node = createMockAggregateNode({
        operation: "count",
        array_field: "user.scores",
      });
      const ctx = createMockContext({
        memory: { user: { scores: [90, 85, 88, 92] } },
      });

      const result = await aggregate_handler.execute(node, ctx);

      expect(result.output.count).toBe(4);
    });

    it("should handle numeric array indices", async () => {
      const node = createMockAggregateNode({
        operation: "count",
        array_field: "data[0].items",
      });
      const ctx = createMockContext({
        memory: {
          data: [
            { items: [1, 2, 3, 4] },
            { items: [5, 6] },
          ],
        },
      });

      const result = await aggregate_handler.execute(node, ctx);

      expect(result.output.count).toBe(4);
    });

    it("should return 0 for non-existent path", async () => {
      const node = createMockAggregateNode({
        operation: "count",
        array_field: "nonexistent.path",
      });
      const ctx = createMockContext();

      const result = await aggregate_handler.execute(node, ctx);

      expect(result.output.count).toBe(0);
    });

    it("should return 0 when path is not an array", async () => {
      const node = createMockAggregateNode({
        operation: "count",
        array_field: "scalar",
      });
      const ctx = createMockContext({
        memory: { scalar: "not an array" },
      });

      const result = await aggregate_handler.execute(node, ctx);

      expect(result.output.count).toBe(0);
    });
  });

  describe("test (validation)", () => {
    it("should return no warnings for valid config", () => {
      const node = createMockAggregateNode({
        array_field: "items",
      });
      const ctx = createMockContext();

      const result = aggregate_handler.test(node, ctx);

      expect(result.warnings).toEqual([]);
    });

    it("should warn when array_field missing", () => {
      const node = createMockAggregateNode({
        array_field: "",
      });
      const ctx = createMockContext();

      const result = aggregate_handler.test(node, ctx);

      expect(result.warnings).toContain("array_field is required");
    });

    it("should include operation and array_field in preview", () => {
      const node = createMockAggregateNode({
        operation: "sum",
        array_field: "numbers",
      });
      const ctx = createMockContext();

      const result = aggregate_handler.test(node, ctx);

      expect(result.preview.operation).toBe("sum");
      expect(result.preview.array_field).toBe("numbers");
    });
  });

  describe("integration scenarios", () => {
    it("should aggregate user scores", async () => {
      const node = createMockAggregateNode({
        operation: "avg",
        array_field: "user.scores",
      });
      const ctx = createMockContext({
        memory: { user: { scores: [88, 92, 85, 90, 87] } },
      });

      const result = await aggregate_handler.execute(node, ctx);

      expect(result.output.result).toBe(88.4);
      expect(result.output.count).toBe(5);
    });

    it("should generate report from multiple fields", async () => {
      const ctx = createMockContext({
        memory: {
          metrics: {
            values: [100, 150, 200, 180, 160],
          },
        },
      });

      // Count
      let node = createMockAggregateNode({
        operation: "count",
        array_field: "metrics.values",
      });
      let result = await aggregate_handler.execute(node, ctx);
      expect(result.output.result).toBe(5);

      // Sum
      node.operation = "sum";
      result = await aggregate_handler.execute(node, ctx);
      expect(result.output.result).toBe(790);

      // Avg
      node.operation = "avg";
      result = await aggregate_handler.execute(node, ctx);
      expect(result.output.result).toBe(158);
    });

    it("should process log entries", async () => {
      const node = createMockAggregateNode({
        operation: "join",
        array_field: "logs",
        separator: " | ",
      });
      const ctx = createMockContext({
        memory: { logs: ["Started", "Processing", "Complete"] },
      });

      const result = await aggregate_handler.execute(node, ctx);

      expect(result.output.result).toBe("Started | Processing | Complete");
    });
  });
});
