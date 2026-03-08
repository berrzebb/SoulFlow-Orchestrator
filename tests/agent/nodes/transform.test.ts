/** Transform 노드 핸들러 테스트
 *
 * 목표: transform_handler를 통한 데이터 변환 검증
 *       - expression: VM 기반 아이템별 평가
 *       - array_field: 메모리 경로 해석 (도트 표기)
 *       - items/count 반환: 변환된 배열 + 카운트
 *       - 에러 처리: null 처리, 문법 오류 감지
 */

import { describe, it, expect } from "vitest";
import { transform_handler } from "@src/agent/nodes/transform.js";
import type { TransformNodeDefinition, OrcheNodeDefinition } from "@src/agent/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "@src/agent/node-registry.js";

/* ── Mock Data ── */

const createMockTransformNode = (overrides?: Partial<TransformNodeDefinition>): TransformNodeDefinition => ({
  node_id: "transform-1",
  label: "Test Transform",
  node_type: "transform",
  expression: "item * 2",
  array_field: "items",
  ...overrides,
});

const createMockContext = (overrides?: Partial<OrcheNodeExecutorContext>): OrcheNodeExecutorContext => ({
  memory: {
    agent_id: "agent-1",
    user_id: "user-1",
    workspace_id: "workspace-1",
    previous_output: {},
    items: [1, 2, 3],
    users: [
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
    ],
    nested: {
      data: {
        values: [10, 20, 30],
      },
    },
  },
  ...overrides,
});

/* ── Tests ── */

describe("Transform Node Handler", () => {
  describe("metadata", () => {
    it("should have correct node_type", () => {
      expect(transform_handler.node_type).toBe("transform");
    });

    it("should have output_schema with items and count", () => {
      const schema = transform_handler.output_schema || [];
      const fields = schema.map((f) => f.name);
      expect(fields).toContain("items");
      expect(fields).toContain("count");
    });

    it("should have input_schema with array and expression", () => {
      const schema = transform_handler.input_schema || [];
      const fields = schema.map((f) => f.name);
      expect(fields).toContain("array");
      expect(fields).toContain("expression");
    });

    it("should have create_default returning identity expression", () => {
      const defaultNode = transform_handler.create_default?.();
      expect(defaultNode?.expression).toBe("item");
      expect(defaultNode?.array_field).toBe("items");
    });

    it("should have icon and color metadata", () => {
      expect(transform_handler.icon).toBeDefined();
      expect(transform_handler.color).toBeDefined();
      expect(transform_handler.shape).toBe("rect");
    });
  });

  describe("execute — basic transformations", () => {
    it("should transform numeric array", async () => {
      const node = createMockTransformNode({
        expression: "item * 2",
        array_field: "items",
      });
      const ctx = createMockContext();

      const result = await transform_handler.execute(node, ctx);

      expect(result.output.items).toEqual([2, 4, 6]);
      expect(result.output.count).toBe(3);
    });

    it("should apply identity transformation", async () => {
      const node = createMockTransformNode({
        expression: "item",
        array_field: "items",
      });
      const ctx = createMockContext();

      const result = await transform_handler.execute(node, ctx);

      expect(result.output.items).toEqual([1, 2, 3]);
      expect(result.output.count).toBe(3);
    });

    it("should transform object array", async () => {
      const node = createMockTransformNode({
        expression: "item.name.toUpperCase()",
        array_field: "users",
      });
      const ctx = createMockContext();

      const result = await transform_handler.execute(node, ctx);

      expect(result.output.items).toEqual(["ALICE", "BOB"]);
      expect(result.output.count).toBe(2);
    });

    it("should extract nested properties", async () => {
      const node = createMockTransformNode({
        expression: "item.id",
        array_field: "users",
      });
      const ctx = createMockContext();

      const result = await transform_handler.execute(node, ctx);

      expect(result.output.items).toEqual([1, 2]);
    });

    it("should create new objects", async () => {
      const node = createMockTransformNode({
        expression: "({ double: item * 2, original: item })",
        array_field: "items",
      });
      const ctx = createMockContext();

      const result = await transform_handler.execute(node, ctx);

      expect((result.output.items as any[])[0]).toEqual({ double: 2, original: 1 });
      expect((result.output.items as any[])[1]).toEqual({ double: 4, original: 2 });
    });
  });

  describe("execute — array field resolution", () => {
    it("should resolve simple array_field", async () => {
      const node = createMockTransformNode({
        expression: "item + 10",
        array_field: "items",
      });
      const ctx = createMockContext();

      const result = await transform_handler.execute(node, ctx);

      expect(result.output.items).toEqual([11, 12, 13]);
    });

    it("should resolve nested array_field with dots", async () => {
      const node = createMockTransformNode({
        expression: "item + 100",
        array_field: "nested.data.values",
      });
      const ctx = createMockContext();

      const result = await transform_handler.execute(node, ctx);

      expect(result.output.items).toEqual([110, 120, 130]);
    });

    it("should return empty array for undefined field", async () => {
      const node = createMockTransformNode({
        array_field: "undefined_field",
      });
      const ctx = createMockContext();

      const result = await transform_handler.execute(node, ctx);

      expect(result.output.items).toEqual([]);
      expect(result.output.count).toBe(0);
    });

    it("should return empty array for non-array field", async () => {
      const node = createMockTransformNode({
        array_field: "agent_id",
      });
      const ctx = createMockContext();

      const result = await transform_handler.execute(node, ctx);

      expect(result.output.items).toEqual([]);
      expect(result.output.count).toBe(0);
    });

    it("should handle broken path chain", async () => {
      const node = createMockTransformNode({
        array_field: "nested.broken.path.items",
      });
      const ctx = createMockContext();

      const result = await transform_handler.execute(node, ctx);

      expect(result.output.items).toEqual([]);
    });

    it("should access memory in expression", async () => {
      const node = createMockTransformNode({
        expression: "item + memory.items[0]",
        array_field: "items",
      });
      const ctx = createMockContext();

      const result = await transform_handler.execute(node, ctx);

      expect(result.output.items).toEqual([2, 3, 4]);
    });
  });

  describe("execute — error handling", () => {
    it("should replace null on expression error", async () => {
      const node = createMockTransformNode({
        expression: "item.nonexistent.method()",
        array_field: "items",
      });
      const ctx = createMockContext();

      const result = await transform_handler.execute(node, ctx);

      expect(result.output.items).toEqual([null, null, null]);
    });

    it("should handle mixed valid/invalid expressions", async () => {
      const node = createMockTransformNode({
        expression: "typeof item === 'number' ? item * 2 : null",
        array_field: "items",
      });
      const ctx = createMockContext();

      const result = await transform_handler.execute(node, ctx);

      expect(result.output.items).toEqual([2, 4, 6]);
    });

    it("should handle runtime errors gracefully", async () => {
      const node = createMockTransformNode({
        expression: "throw new Error('intentional')",
        array_field: "items",
      });
      const ctx = createMockContext();

      const result = await transform_handler.execute(node, ctx);

      expect(result.output.items).toEqual([null, null, null]);
    });

    it("should timeout on infinite loop", async () => {
      const node = createMockTransformNode({
        expression: "while(true) {}",
        array_field: "items",
      });
      const ctx = createMockContext();

      const result = await transform_handler.execute(node, ctx);

      // Timeout returns null
      expect(result.output.items).toEqual([null, null, null]);
    });
  });

  describe("execute — complex expressions", () => {
    it("should support string operations", async () => {
      const node = createMockTransformNode({
        expression: "item.toUpperCase()",
        array_field: "users",
      });
      const ctx = createMockContext({
        memory: { users: ["alice", "bob"] },
      });

      const result = await transform_handler.execute(node, ctx);

      expect(result.output.items).toEqual(["ALICE", "BOB"]);
    });

    it("should support array operations", async () => {
      const node = createMockTransformNode({
        expression: "[item, item * 2, item * 3]",
        array_field: "items",
      });
      const ctx = createMockContext();

      const result = await transform_handler.execute(node, ctx);

      expect((result.output.items as any[])[0]).toEqual([1, 2, 3]);
      expect((result.output.items as any[])[1]).toEqual([2, 4, 6]);
    });

    it("should support conditional operations", async () => {
      const node = createMockTransformNode({
        expression: "item > 2 ? item : 0",
        array_field: "items",
      });
      const ctx = createMockContext();

      const result = await transform_handler.execute(node, ctx);

      expect(result.output.items).toEqual([0, 0, 3]);
    });

    it("should support ternary with objects", async () => {
      const node = createMockTransformNode({
        expression: "item.id === 1 ? { ...item, active: true } : item",
        array_field: "users",
      });
      const ctx = createMockContext();

      const result = await transform_handler.execute(node, ctx);

      expect((result.output.items as any[])[0]).toEqual({ id: 1, name: "Alice", active: true });
      expect((result.output.items as any[])[1]).toEqual({ id: 2, name: "Bob" });
    });
  });

  describe("test (validation)", () => {
    it("should return no warnings for valid expression", () => {
      const node = createMockTransformNode({
        expression: "item * 2",
      });
      const ctx = createMockContext();

      const result = transform_handler.test(node, ctx);

      expect(result.warnings).toEqual([]);
    });

    it("should warn on syntax error", () => {
      const node = createMockTransformNode({
        expression: "item *",
      });
      const ctx = createMockContext();

      const result = transform_handler.test(node, ctx);

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain("syntax error");
    });

    it("should include preview with expression and array_field", () => {
      const node = createMockTransformNode({
        expression: "item.toUpperCase()",
        array_field: "names",
      });
      const ctx = createMockContext();

      const result = transform_handler.test(node, ctx);

      expect(result.preview.expression).toBe("item.toUpperCase()");
      expect(result.preview.array_field).toBe("names");
    });

    it("should validate complex expressions", () => {
      const node = createMockTransformNode({
        expression: "item * 10 + 5",
      });
      const ctx = createMockContext();

      const result = transform_handler.test(node, ctx);

      expect(result.warnings).toEqual([]);
    });

    it("should detect incomplete expressions", () => {
      const node = createMockTransformNode({
        expression: "{ incomplete:",
      });
      const ctx = createMockContext();

      const result = transform_handler.test(node, ctx);

      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe("integration scenarios", () => {
    it("should transform and filter data", async () => {
      const ctx = createMockContext({
        memory: { items: [1, 2, 3, 4, 5] },
      });

      const node = createMockTransformNode({
        expression: "item % 2 === 0 ? item * 10 : null",
        array_field: "items",
      });

      const result = await transform_handler.execute(node, ctx);

      expect(result.output.items).toEqual([null, 20, null, 40, null]);
    });

    it("should normalize data", async () => {
      const ctx = createMockContext({
        memory: {
          users: [
            { name: "ALICE", age: 30 },
            { name: "BOB", age: 25 },
            { name: "CHARLIE", age: 35 },
          ],
        },
      });

      const node = createMockTransformNode({
        expression: "({ name: item.name.toLowerCase(), age: item.age })",
        array_field: "users",
      });

      const result = await transform_handler.execute(node, ctx);

      expect((result.output.items as any[])[0]).toEqual({ name: "alice", age: 30 });
      expect((result.output.items as any[])[2]).toEqual({ name: "charlie", age: 35 });
    });

    it("should enrich data with calculations", async () => {
      const ctx = createMockContext({
        memory: {
          products: [
            { name: "A", price: 10, quantity: 2 },
            { name: "B", price: 20, quantity: 3 },
          ],
        },
      });

      const node = createMockTransformNode({
        expression: "({ ...item, total: item.price * item.quantity })",
        array_field: "products",
      });

      const result = await transform_handler.execute(node, ctx);

      expect((result.output.items as any[])[0]).toEqual({
        name: "A",
        price: 10,
        quantity: 2,
        total: 20,
      });
      expect((result.output.items as any[])[1]).toEqual({
        name: "B",
        price: 20,
        quantity: 3,
        total: 60,
      });
    });
  });

  describe("edge cases", () => {
    it("should handle empty array", async () => {
      const node = createMockTransformNode();
      const ctx = createMockContext({
        memory: { items: [] },
      });

      const result = await transform_handler.execute(node, ctx);

      expect(result.output.items).toEqual([]);
      expect(result.output.count).toBe(0);
    });

    it("should handle single item array", async () => {
      const node = createMockTransformNode();
      const ctx = createMockContext({
        memory: { items: [42] },
      });

      const result = await transform_handler.execute(node, ctx);

      expect(result.output.items).toEqual([42 * 2]);
      expect(result.output.count).toBe(1);
    });

    it("should handle null items in array", async () => {
      const node = createMockTransformNode({
        expression: "item ? item * 2 : null",
      });
      const ctx = createMockContext({
        memory: { items: [1, null, 3] },
      });

      const result = await transform_handler.execute(node, ctx);

      expect(result.output.items).toEqual([2, null, 6]);
    });

    it("should handle array of mixed types", async () => {
      const node = createMockTransformNode({
        expression: "typeof item === 'number' ? item * 2 : item",
      });
      const ctx = createMockContext({
        memory: { items: [1, "string", 3, true] },
      });

      const result = await transform_handler.execute(node, ctx);

      expect(result.output.items).toEqual([2, "string", 6, true]);
    });

    it("should handle very large arrays", async () => {
      const largeArray = Array.from({ length: 1000 }, (_, i) => i);
      const node = createMockTransformNode({
        expression: "item * 2",
      });
      const ctx = createMockContext({
        memory: { items: largeArray },
      });

      const result = await transform_handler.execute(node, ctx);

      expect(result.output.count).toBe(1000);
      expect(result.output.items[0]).toBe(0);
      expect(result.output.items[999]).toBe(1998);
    });

    it("should handle deeply nested expressions", async () => {
      const node = createMockTransformNode({
        expression: "((item + 1) * 2 - 1) / 2 + 1",
      });
      const ctx = createMockContext();

      const result = await transform_handler.execute(node, ctx);

      expect(result.output.items.length).toBe(3);
    });
  });
});
