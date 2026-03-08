/** Split 노드 핸들러 테스트
 *
 * 목표: split_handler를 통한 배열 분해 검증
 *       - execute: 스텁 구현 (실제 구현은 phase-loop-runner)
 *       - test: array_field 템플릿 해석
 *       - batch_size 옵션 검증
 *       - output_schema: item/index/total 반환
 */

import { describe, it, expect } from "vitest";
import { split_handler } from "@src/agent/nodes/split.js";
import type { SplitNodeDefinition, OrcheNodeDefinition } from "@src/agent/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "@src/agent/node-registry.js";

/* ── Mock Data ── */

const createMockSplitNode = (overrides?: Partial<SplitNodeDefinition>): SplitNodeDefinition => ({
  node_id: "split-1",
  label: "Test Split",
  node_type: "split",
  array_field: "{{memory.items}}",
  batch_size: 1,
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
      { id: "u1", name: "Alice" },
      { id: "u2", name: "Bob" },
    ],
  },
  ...overrides,
});

/* ── Tests ── */

describe("Split Node Handler", () => {
  describe("metadata", () => {
    it("should have correct node_type", () => {
      expect(split_handler.node_type).toBe("split");
    });

    it("should have output_schema with item, index, total", () => {
      const schema = split_handler.output_schema || [];
      const fields = schema.map((f) => f.name);
      expect(fields).toContain("item");
      expect(fields).toContain("index");
      expect(fields).toContain("total");
    });

    it("should have input_schema with array", () => {
      const schema = split_handler.input_schema || [];
      const fields = schema.map((f) => f.name);
      expect(fields).toContain("array");
    });

    it("should have create_default returning array_field template", () => {
      const defaultNode = split_handler.create_default?.();
      expect(defaultNode?.array_field).toBe("");
    });

    it("should have icon and color metadata", () => {
      expect(split_handler.icon).toBeDefined();
      expect(split_handler.color).toBeDefined();
      expect(split_handler.shape).toBe("diamond");
    });
  });

  describe("execute — stub implementation", () => {
    it("should return stub output", async () => {
      const node = createMockSplitNode();
      const ctx = createMockContext();

      const result = await split_handler.execute(node, ctx);

      expect(result.output.item).toBeNull();
      expect(result.output.index).toBe(0);
      expect(result.output.total).toBe(0);
    });

    it("should return stub output regardless of node config", async () => {
      const node = createMockSplitNode({
        array_field: "{{memory.users}}",
        batch_size: 5,
      });
      const ctx = createMockContext();

      const result = await split_handler.execute(node, ctx);

      expect(result.output.item).toBeNull();
      expect(result.output.index).toBe(0);
      expect(result.output.total).toBe(0);
    });

    it("should return stub output regardless of context", async () => {
      const node = createMockSplitNode();
      const ctx = createMockContext({ memory: {} });

      const result = await split_handler.execute(node, ctx);

      expect(result.output.item).toBeNull();
      expect(result.output.index).toBe(0);
      expect(result.output.total).toBe(0);
    });
  });

  describe("test (validation)", () => {
    it("should return no warnings for valid array_field", () => {
      const node = createMockSplitNode({ array_field: "{{memory.items}}" });
      const ctx = createMockContext();

      const result = split_handler.test(node, ctx);

      expect(result.warnings).toEqual([]);
    });

    it("should resolve array_field template in preview", () => {
      const node = createMockSplitNode({ array_field: "{{memory.items}}" });
      const ctx = createMockContext();

      const result = split_handler.test(node, ctx);

      expect(result.preview.array_field).toBeDefined();
    });

    it("should handle template resolution with nested paths", () => {
      const node = createMockSplitNode({ array_field: "{{memory.users}}" });
      const ctx = createMockContext({
        memory: {
          users: [{ id: "1", name: "Alice" }, { id: "2", name: "Bob" }],
        },
      });

      const result = split_handler.test(node, ctx);

      expect(result.preview.array_field).toBeDefined();
    });

    it("should include batch_size in preview (default 1)", () => {
      const node = createMockSplitNode({ batch_size: 1 });
      const ctx = createMockContext();

      const result = split_handler.test(node, ctx);

      expect(result.preview.batch_size).toBe(1);
    });

    it("should include custom batch_size in preview", () => {
      const node = createMockSplitNode({ batch_size: 5 });
      const ctx = createMockContext();

      const result = split_handler.test(node, ctx);

      expect(result.preview.batch_size).toBe(5);
    });

    it("should use default batch_size of 1 when undefined", () => {
      const node = createMockSplitNode({ batch_size: undefined as any });
      const ctx = createMockContext();

      const result = split_handler.test(node, ctx);

      expect(result.preview.batch_size).toBe(1);
    });

    it("should handle empty array_field template", () => {
      const node = createMockSplitNode({ array_field: "" });
      const ctx = createMockContext();

      const result = split_handler.test(node, ctx);

      // Should not crash, returns preview with resolved template
      expect(result.preview.array_field).toBeDefined();
      expect(result.warnings).toEqual([]);
    });

    it("should handle non-template array_field", () => {
      const node = createMockSplitNode({ array_field: "plain-text" });
      const ctx = createMockContext();

      const result = split_handler.test(node, ctx);

      expect(result.preview.array_field).toBe("plain-text");
    });
  });

  describe("template resolution", () => {
    it("should resolve simple memory variable", () => {
      const node = createMockSplitNode({ array_field: "{{memory.items}}" });
      const ctx = createMockContext({ memory: { items: "resolved" } });

      const result = split_handler.test(node, ctx);

      expect(result.preview.array_field).toBe("resolved");
    });

    it("should resolve nested object paths", () => {
      const node = createMockSplitNode({ array_field: "{{memory.user.name}}" });
      const ctx = createMockContext({ memory: { user: { name: "Alice" } } });

      const result = split_handler.test(node, ctx);

      expect(result.preview.array_field).toBe("Alice");
    });

    it("should handle undefined variables", () => {
      const node = createMockSplitNode({ array_field: "{{memory.undefined}}" });
      const ctx = createMockContext();

      const result = split_handler.test(node, ctx);

      // Template resolution with undefined returns the template as-is or empty
      expect(result.preview.array_field).toBeDefined();
    });

    it("should preserve non-template strings", () => {
      const node = createMockSplitNode({ array_field: "items" });
      const ctx = createMockContext();

      const result = split_handler.test(node, ctx);

      expect(result.preview.array_field).toBe("items");
    });

    it("should resolve multiple templates in one string", () => {
      const node = createMockSplitNode({ array_field: "prefix_{{memory.field}}_suffix" });
      const ctx = createMockContext({ memory: { field: "value" } });

      const result = split_handler.test(node, ctx);

      expect(result.preview.array_field).toBe("prefix_value_suffix");
    });
  });

  describe("batch_size variations", () => {
    it("should support batch_size of 1", () => {
      const node = createMockSplitNode({ batch_size: 1 });
      const ctx = createMockContext();

      const result = split_handler.test(node, ctx);

      expect(result.preview.batch_size).toBe(1);
    });

    it("should support large batch_size", () => {
      const node = createMockSplitNode({ batch_size: 1000 });
      const ctx = createMockContext();

      const result = split_handler.test(node, ctx);

      expect(result.preview.batch_size).toBe(1000);
    });

    it("should default batch_size to 1 when 0 is provided", () => {
      const node = createMockSplitNode({ batch_size: 0 });
      const ctx = createMockContext();

      const result = split_handler.test(node, ctx);

      // batch_size 0 defaults to 1 (n.batch_size || 1)
      expect(result.preview.batch_size).toBe(1);
      expect(result.warnings).toEqual([]);
    });

    it("should support negative batch_size (no validation error)", () => {
      const node = createMockSplitNode({ batch_size: -5 });
      const ctx = createMockContext();

      const result = split_handler.test(node, ctx);

      expect(result.preview.batch_size).toBe(-5);
    });
  });

  describe("integration scenarios", () => {
    it("should handle split of numeric array (converted to string)", () => {
      const node = createMockSplitNode({
        array_field: "{{memory.numbers}}",
        batch_size: 2,
      });
      const ctx = createMockContext({
        memory: { numbers: [10, 20, 30, 40, 50] },
      });

      const result = split_handler.test(node, ctx);

      // resolve_templates converts arrays to strings
      expect(result.preview.array_field).toBe("10,20,30,40,50");
      expect(result.preview.batch_size).toBe(2);
    });

    it("should handle split of object array (converted to string)", () => {
      const users = [
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" },
        { id: 3, name: "Charlie" },
      ];
      const node = createMockSplitNode({ array_field: "{{memory.users}}" });
      const ctx = createMockContext({ memory: { users } });

      const result = split_handler.test(node, ctx);

      // resolve_templates converts objects to strings
      expect(result.preview.array_field).toBe(users.toString());
    });

    it("should handle split with dynamic batch_size", () => {
      const node = createMockSplitNode({
        array_field: "{{memory.data}}",
        batch_size: 3,
      });
      const ctx = createMockContext({ memory: { data: [1, 2, 3, 4, 5, 6, 7] } });

      const result = split_handler.test(node, ctx);

      expect(result.preview.batch_size).toBe(3);
    });

    it("should provide preview information for UI rendering", () => {
      const node = createMockSplitNode({
        array_field: "{{memory.items}}",
        batch_size: 5,
      });
      const ctx = createMockContext();

      const result = split_handler.test(node, ctx);

      expect(result.preview).toBeDefined();
      expect(result.preview.array_field).toBeDefined();
      expect(result.preview.batch_size).toBe(5);
    });
  });

  describe("edge cases", () => {
    it("should handle empty array_field", () => {
      const node = createMockSplitNode({ array_field: "" });
      const ctx = createMockContext();

      const result = split_handler.test(node, ctx);

      expect(result.warnings).toEqual([]);
    });

    it("should handle array_field with only whitespace", () => {
      const node = createMockSplitNode({ array_field: "   " });
      const ctx = createMockContext();

      const result = split_handler.test(node, ctx);

      expect(result.preview.array_field).toBe("   ");
    });

    it("should handle array_field with special characters", () => {
      const node = createMockSplitNode({ array_field: "data[0].items" });
      const ctx = createMockContext();

      const result = split_handler.test(node, ctx);

      expect(result.preview.array_field).toBe("data[0].items");
    });

    it("should handle very long array_field", () => {
      const longField = "{{memory." + "a".repeat(100) + "}}";
      const node = createMockSplitNode({ array_field: longField });
      const ctx = createMockContext();

      const result = split_handler.test(node, ctx);

      expect(result.preview.array_field).toBeDefined();
    });

    it("should handle batch_size as float (no conversion)", () => {
      const node = createMockSplitNode({ batch_size: 2.5 as any });
      const ctx = createMockContext();

      const result = split_handler.test(node, ctx);

      expect(result.preview.batch_size).toBe(2.5);
    });

    it("should handle null/undefined in memory (converted to string)", () => {
      const node = createMockSplitNode({ array_field: "{{memory.nullable}}" });
      const ctx = createMockContext({
        memory: { nullable: null },
      });

      const result = split_handler.test(node, ctx);

      // resolve_templates converts null to "null" string
      expect(result.preview.array_field).toBe("null");
    });
  });

  describe("validation warnings", () => {
    it("should not produce warnings for normal configuration", () => {
      const node = createMockSplitNode({
        array_field: "{{memory.data}}",
        batch_size: 10,
      });
      const ctx = createMockContext();

      const result = split_handler.test(node, ctx);

      expect(result.warnings).toHaveLength(0);
    });

    it("should handle context without required memory fields", () => {
      const node = createMockSplitNode({ array_field: "{{memory.missing}}" });
      const ctx = createMockContext({ memory: {} });

      const result = split_handler.test(node, ctx);

      // Should not throw or warn, just handle gracefully
      expect(result.preview).toBeDefined();
    });

    it("should handle context with empty memory", () => {
      const node = createMockSplitNode();
      const ctx = createMockContext({ memory: {} });

      const result = split_handler.test(node, ctx);

      expect(result.preview).toBeDefined();
    });
  });
});
