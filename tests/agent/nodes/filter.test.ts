/** Filter 노드 핸들러 테스트
 *
 * 목표: filter_handler를 통한 배열 필터링 검증
 *       - execute: 조건 기반 배열 항목 필터링
 *       - array_field: 메모리에서 배열 경로 접근 (dot notation)
 *       - condition: VM 컨텍스트에서 item과 memory 접근 가능
 *       - error handling: 유효하지 않은 조건, 타임아웃, 빈 배열
 */

import { describe, it, expect } from "vitest";
import { filter_handler } from "@src/agent/nodes/filter.js";
import type { FilterNodeDefinition, OrcheNodeDefinition } from "@src/agent/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "@src/agent/node-registry.js";

/* ── Mock Data ── */

const createMockFilterNode = (overrides?: Partial<FilterNodeDefinition>): FilterNodeDefinition => ({
  node_id: "filter-1",
  title: "Test Filter Node",
  node_type: "filter",
  condition: "true",
  array_field: "items",
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

describe("Filter Node Handler", () => {
  describe("metadata", () => {
    it("should have correct node_type", () => {
      expect(filter_handler.node_type).toBe("filter");
    });

    it("should have output_schema with items, count, rejected", () => {
      const schema = filter_handler.output_schema || [];
      const fields = schema.map((f) => f.name);
      expect(fields).toContain("items");
      expect(fields).toContain("count");
      expect(fields).toContain("rejected");
    });

    it("should have create_default returning valid node template", () => {
      const defaultNode = filter_handler.create_default?.();
      expect(defaultNode?.condition).toBe("true");
      expect(defaultNode?.array_field).toBe("items");
    });
  });

  describe("execute — basic filtering", () => {
    it("should filter array by simple condition", async () => {
      const node = createMockFilterNode({
        condition: "item > 5",
        array_field: "numbers",
      });
      const ctx = createMockContext({
        memory: { numbers: [1, 5, 10, 15, 3, 8] },
      });

      const result = await filter_handler.execute(node, ctx);

      expect(result.output.items).toEqual([10, 15, 8]);
      expect(result.output.count).toBe(3);
      expect(result.output.rejected).toBe(3);
    });

    it("should keep all items when condition is true", async () => {
      const node = createMockFilterNode({
        condition: "true",
        array_field: "items",
      });
      const ctx = createMockContext({
        memory: { items: [1, 2, 3, 4] },
      });

      const result = await filter_handler.execute(node, ctx);

      expect(result.output.items).toEqual([1, 2, 3, 4]);
      expect(result.output.count).toBe(4);
      expect(result.output.rejected).toBe(0);
    });

    it("should remove all items when condition is false", async () => {
      const node = createMockFilterNode({
        condition: "false",
        array_field: "items",
      });
      const ctx = createMockContext({
        memory: { items: [1, 2, 3, 4] },
      });

      const result = await filter_handler.execute(node, ctx);

      expect(result.output.items).toEqual([]);
      expect(result.output.count).toBe(0);
      expect(result.output.rejected).toBe(4);
    });
  });

  describe("execute — item property access", () => {
    it("should access object properties in condition", async () => {
      const node = createMockFilterNode({
        condition: "item.age >= 18",
        array_field: "users",
      });
      const ctx = createMockContext({
        memory: {
          users: [
            { name: "Alice", age: 25 },
            { name: "Bob", age: 17 },
            { name: "Charlie", age: 30 },
          ],
        },
      });

      const result = await filter_handler.execute(node, ctx);

      expect(result.output.items).toHaveLength(2);
      expect(result.output.count).toBe(2);
      expect(result.output.rejected).toBe(1);
    });

    it("should filter by nested object properties", async () => {
      const node = createMockFilterNode({
        condition: "item.address.city === 'NYC'",
        array_field: "users",
      });
      const ctx = createMockContext({
        memory: {
          users: [
            { name: "Alice", address: { city: "NYC" } },
            { name: "Bob", address: { city: "LA" } },
            { name: "Charlie", address: { city: "NYC" } },
          ],
        },
      });

      const result = await filter_handler.execute(node, ctx);

      expect(result.output.items).toHaveLength(2);
      expect(result.output.count).toBe(2);
    });

    it("should filter by array property length", async () => {
      const node = createMockFilterNode({
        condition: "item.tags.length > 0",
        array_field: "posts",
      });
      const ctx = createMockContext({
        memory: {
          posts: [
            { title: "Post 1", tags: ["a", "b"] },
            { title: "Post 2", tags: [] },
            { title: "Post 3", tags: ["c"] },
          ],
        },
      });

      const result = await filter_handler.execute(node, ctx);

      expect(result.output.items).toHaveLength(2);
    });

    it("should filter by string property methods", async () => {
      const node = createMockFilterNode({
        condition: "item.email.includes('@')",
        array_field: "contacts",
      });
      const ctx = createMockContext({
        memory: {
          contacts: [
            { email: "user@example.com" },
            { email: "invalid-email" },
            { email: "another@test.com" },
          ],
        },
      });

      const result = await filter_handler.execute(node, ctx);

      expect(result.output.items).toHaveLength(2);
    });
  });

  describe("execute — complex conditions", () => {
    it("should support logical operators", async () => {
      const node = createMockFilterNode({
        condition: "item.active && item.verified",
        array_field: "users",
      });
      const ctx = createMockContext({
        memory: {
          users: [
            { name: "Alice", active: true, verified: true },
            { name: "Bob", active: true, verified: false },
            { name: "Charlie", active: false, verified: true },
          ],
        },
      });

      const result = await filter_handler.execute(node, ctx);

      expect(result.output.items).toHaveLength(1);
      expect(result.output.items[0]).toHaveProperty("name", "Alice");
    });

    it("should support OR conditions", async () => {
      const node = createMockFilterNode({
        condition: "item.status === 'active' || item.status === 'pending'",
        array_field: "tasks",
      });
      const ctx = createMockContext({
        memory: {
          tasks: [
            { id: 1, status: "active" },
            { id: 2, status: "completed" },
            { id: 3, status: "pending" },
          ],
        },
      });

      const result = await filter_handler.execute(node, ctx);

      expect(result.output.items).toHaveLength(2);
    });

    it("should support mathematical expressions", async () => {
      const node = createMockFilterNode({
        condition: "item.price > 100 && item.price < 500",
        array_field: "products",
      });
      const ctx = createMockContext({
        memory: {
          products: [
            { id: 1, price: 50 },
            { id: 2, price: 200 },
            { id: 3, price: 600 },
          ],
        },
      });

      const result = await filter_handler.execute(node, ctx);

      expect(result.output.items).toHaveLength(1);
    });

    it("should support array methods", async () => {
      const node = createMockFilterNode({
        condition: "item.scores.some(s => s > 90)",
        array_field: "students",
      });
      const ctx = createMockContext({
        memory: {
          students: [
            { name: "Alice", scores: [85, 88, 92] },
            { name: "Bob", scores: [70, 75, 80] },
            { name: "Charlie", scores: [95, 88] },
          ],
        },
      });

      const result = await filter_handler.execute(node, ctx);

      expect(result.output.items).toHaveLength(2);
    });
  });

  describe("execute — nested array field paths", () => {
    it("should access top-level array", async () => {
      const node = createMockFilterNode({
        condition: "item > 5",
        array_field: "numbers",
      });
      const ctx = createMockContext({
        memory: { numbers: [1, 10, 3, 8] },
      });

      const result = await filter_handler.execute(node, ctx);

      expect(result.output.items).toEqual([10, 8]);
    });

    it("should access nested object array", async () => {
      const node = createMockFilterNode({
        condition: "item.completed",
        array_field: "project.tasks",
      });
      const ctx = createMockContext({
        memory: {
          project: {
            tasks: [
              { id: 1, completed: true },
              { id: 2, completed: false },
              { id: 3, completed: true },
            ],
          },
        },
      });

      const result = await filter_handler.execute(node, ctx);

      expect(result.output.items).toHaveLength(2);
    });

    it("should handle non-existent array path", async () => {
      const node = createMockFilterNode({
        condition: "true",
        array_field: "nonexistent.path",
      });
      const ctx = createMockContext();

      const result = await filter_handler.execute(node, ctx);

      expect(result.output.items).toEqual([]);
      expect(result.output.count).toBe(0);
    });

    it("should handle non-array field", async () => {
      const node = createMockFilterNode({
        condition: "true",
        array_field: "scalar_value",
      });
      const ctx = createMockContext({
        memory: { scalar_value: "not an array" },
      });

      const result = await filter_handler.execute(node, ctx);

      expect(result.output.items).toEqual([]);
      expect(result.output.count).toBe(0);
    });
  });

  describe("execute — memory access in condition", () => {
    it("should access memory variables in condition", async () => {
      const node = createMockFilterNode({
        condition: "item.score > memory.min_score",
        array_field: "results",
      });
      const ctx = createMockContext({
        memory: {
          min_score: 75,
          results: [
            { id: 1, score: 80 },
            { id: 2, score: 70 },
            { id: 3, score: 85 },
          ],
        },
      });

      const result = await filter_handler.execute(node, ctx);

      expect(result.output.items).toHaveLength(2);
    });

    it("should access nested memory variables", async () => {
      const node = createMockFilterNode({
        condition: "item.category === memory.filter.category",
        array_field: "items",
      });
      const ctx = createMockContext({
        memory: {
          filter: { category: "active" },
          items: [
            { id: 1, category: "active" },
            { id: 2, category: "archived" },
            { id: 3, category: "active" },
          ],
        },
      });

      const result = await filter_handler.execute(node, ctx);

      expect(result.output.items).toHaveLength(2);
    });

    it("should support memory array access", async () => {
      const node = createMockFilterNode({
        condition: "memory.allowed_ids.includes(item.id)",
        array_field: "users",
      });
      const ctx = createMockContext({
        memory: {
          allowed_ids: [1, 3],
          users: [
            { id: 1, name: "Alice" },
            { id: 2, name: "Bob" },
            { id: 3, name: "Charlie" },
          ],
        },
      });

      const result = await filter_handler.execute(node, ctx);

      expect(result.output.items).toHaveLength(2);
    });
  });

  describe("execute — error handling", () => {
    it("should handle syntax errors in condition gracefully", async () => {
      const node = createMockFilterNode({
        condition: "item.value >", // Incomplete expression
        array_field: "items",
      });
      const ctx = createMockContext({
        memory: { items: [1, 2, 3] },
      });

      const result = await filter_handler.execute(node, ctx);

      // Items with syntax errors are rejected
      expect(result.output.items).toEqual([]);
      expect(result.output.count).toBe(0);
      expect(result.output.rejected).toBe(3);
    });

    it("should handle timeout in condition", async () => {
      const node = createMockFilterNode({
        condition: "while(true) {}",
        array_field: "items",
      });
      const ctx = createMockContext({
        memory: { items: [1, 2] },
      });

      const result = await filter_handler.execute(node, ctx);

      // Timeout items are rejected
      expect(result.output.items).toEqual([]);
      expect(result.output.count).toBe(0);
      expect(result.output.rejected).toBe(2);
    });

    it("should handle undefined property access", async () => {
      const node = createMockFilterNode({
        condition: "item.nonexistent === undefined",
        array_field: "items",
      });
      const ctx = createMockContext({
        memory: { items: [{ a: 1 }, { b: 2 }] },
      });

      const result = await filter_handler.execute(node, ctx);

      expect(result.output.items).toHaveLength(2);
    });

    it("should handle empty array", async () => {
      const node = createMockFilterNode({
        condition: "true",
        array_field: "items",
      });
      const ctx = createMockContext({
        memory: { items: [] },
      });

      const result = await filter_handler.execute(node, ctx);

      expect(result.output.items).toEqual([]);
      expect(result.output.count).toBe(0);
      expect(result.output.rejected).toBe(0);
    });

    it("should handle type mismatches gracefully", async () => {
      const node = createMockFilterNode({
        condition: "item.length > 2", // items are not strings
        array_field: "numbers",
      });
      const ctx = createMockContext({
        memory: { numbers: [1, 2, 3] },
      });

      const result = await filter_handler.execute(node, ctx);

      // Items without .length are rejected
      expect(result.output.items).toEqual([]);
    });
  });

  describe("execute — preserving item types", () => {
    it("should preserve object structure", async () => {
      const node = createMockFilterNode({
        condition: "item.active === true",
        array_field: "users",
      });
      const ctx = createMockContext({
        memory: {
          users: [
            { id: 1, name: "Alice", active: true, roles: ["admin"] },
            { id: 2, name: "Bob", active: false, roles: [] },
          ],
        },
      });

      const result = await filter_handler.execute(node, ctx);

      expect(result.output.items).toHaveLength(1);
      expect(result.output.items[0]).toEqual({ id: 1, name: "Alice", active: true, roles: ["admin"] });
    });

    it("should preserve primitive types", async () => {
      const node = createMockFilterNode({
        condition: "item > 5",
        array_field: "numbers",
      });
      const ctx = createMockContext({
        memory: { numbers: [1, 10, 3, 8] },
      });

      const result = await filter_handler.execute(node, ctx);

      expect(result.output.items).toEqual([10, 8]);
    });

    it("should preserve array items", async () => {
      const node = createMockFilterNode({
        condition: "item.length > 1",
        array_field: "arrays",
      });
      const ctx = createMockContext({
        memory: { arrays: [[1], [1, 2], [1, 2, 3]] },
      });

      const result = await filter_handler.execute(node, ctx);

      expect(result.output.items).toEqual([[1, 2], [1, 2, 3]]);
    });
  });

  describe("test (validation)", () => {
    it("should return no warnings for valid condition", () => {
      const node = createMockFilterNode({
        condition: "item > 5",
        array_field: "numbers",
      });
      const ctx = createMockContext();

      const result = filter_handler.test(node, ctx);

      expect(result.warnings).toEqual([]);
    });

    it("should warn for syntax errors in condition", () => {
      const node = createMockFilterNode({
        condition: "item >",
        array_field: "numbers",
      });
      const ctx = createMockContext();

      const result = filter_handler.test(node, ctx);

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain("condition syntax error");
    });

    it("should include preview with condition and array_field", () => {
      const node = createMockFilterNode({
        condition: "item.active === true",
        array_field: "users",
      });
      const ctx = createMockContext();

      const result = filter_handler.test(node, ctx);

      expect(result.preview.condition).toBe("item.active === true");
      expect(result.preview.array_field).toBe("users");
    });
  });

  describe("integration scenarios", () => {
    it("should filter users by multiple criteria", async () => {
      const node = createMockFilterNode({
        condition: "item.age >= memory.min_age && item.status === 'active'",
        array_field: "users",
      });
      const ctx = createMockContext({
        memory: {
          min_age: 18,
          users: [
            { name: "Alice", age: 25, status: "active" },
            { name: "Bob", age: 17, status: "active" },
            { name: "Charlie", age: 30, status: "inactive" },
            { name: "Diana", age: 22, status: "active" },
          ],
        },
      });

      const result = await filter_handler.execute(node, ctx);

      expect(result.output.items).toHaveLength(2);
      expect(result.output.count).toBe(2);
    });

    it("should filter products by price range", async () => {
      const node = createMockFilterNode({
        condition: "item.price >= memory.price_range.min && item.price <= memory.price_range.max",
        array_field: "products",
      });
      const ctx = createMockContext({
        memory: {
          price_range: { min: 100, max: 500 },
          products: [
            { id: 1, name: "Item A", price: 50 },
            { id: 2, name: "Item B", price: 250 },
            { id: 3, name: "Item C", price: 600 },
          ],
        },
      });

      const result = await filter_handler.execute(node, ctx);

      expect(result.output.items).toHaveLength(1);
    });

    it("should filter tasks by tags", async () => {
      const node = createMockFilterNode({
        condition: "item.tags.some(t => memory.selected_tags.includes(t))",
        array_field: "tasks",
      });
      const ctx = createMockContext({
        memory: {
          selected_tags: ["urgent", "bug"],
          tasks: [
            { id: 1, title: "Task 1", tags: ["feature"] },
            { id: 2, title: "Task 2", tags: ["bug", "performance"] },
            { id: 3, title: "Task 3", tags: ["urgent"] },
          ],
        },
      });

      const result = await filter_handler.execute(node, ctx);

      expect(result.output.items).toHaveLength(2);
    });

    it("should filter and count results", async () => {
      const node = createMockFilterNode({
        condition: "item.score > 80",
        array_field: "exam_results",
      });
      const ctx = createMockContext({
        memory: {
          exam_results: [
            { student: "Alice", score: 95 },
            { student: "Bob", score: 70 },
            { student: "Charlie", score: 88 },
            { student: "Diana", score: 75 },
          ],
        },
      });

      const result = await filter_handler.execute(node, ctx);

      expect(result.output.count).toBe(2);
      expect(result.output.rejected).toBe(2);
      expect(result.output.items).toHaveLength(2);
    });
  });
});
