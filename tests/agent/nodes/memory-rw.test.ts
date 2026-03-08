/** Memory R/W 노드 핸들러 테스트
 *
 * 목표: memory_rw_handler를 통한 메모리 읽기/쓰기 검증
 *       - execute: get/set/delete/list 액션
 *       - template resolution: key/value 변수 치환
 *       - memory state: 메모리 업데이트 추적
 */

import { describe, it, expect } from "vitest";
import { memory_rw_handler } from "@src/agent/nodes/memory-rw.js";
import type { MemoryRwNodeDefinition, OrcheNodeDefinition } from "@src/agent/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "@src/agent/orche-node-executor.js";

const createMockMemoryRwNode = (overrides?: Partial<MemoryRwNodeDefinition>): MemoryRwNodeDefinition => ({
  node_id: "mem-1",
  label: "Test Memory",
  node_type: "memory_rw",
  action: "get",
  key: "test-key",
  ...overrides,
});

const createMockContext = (overrides?: Partial<OrcheNodeExecutorContext>): OrcheNodeExecutorContext => ({
  memory: {
    agent_id: "agent-1",
    user_id: "user-1",
    existing: "data",
    count: 42,
    nested: { value: "deep" },
  },
  ...overrides,
});

describe("Memory R/W Node Handler", () => {
  describe("metadata", () => {
    it("should have correct node_type", () => {
      expect(memory_rw_handler.node_type).toBe("memory_rw");
    });

    it("should have output_schema with value and success", () => {
      const schema = memory_rw_handler.output_schema || [];
      const fields = schema.map((f) => f.name);
      expect(fields).toContain("value");
      expect(fields).toContain("success");
    });

    it("should have create_default with get action", () => {
      const defaultNode = memory_rw_handler.create_default?.();
      expect(defaultNode?.action).toBe("get");
    });
  });

  describe("execute — get action", () => {
    it("should get existing value from memory", async () => {
      const node = createMockMemoryRwNode({
        action: "get",
        key: "existing",
      });
      const ctx = createMockContext();

      const result = await memory_rw_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.value).toBe("data");
    });

    it("should return empty string for missing key", async () => {
      const node = createMockMemoryRwNode({
        action: "get",
        key: "nonexistent",
      });
      const ctx = createMockContext();

      const result = await memory_rw_handler.execute(node, ctx);

      expect(result.output.success).toBe(false);
      expect(result.output.value).toBe("");
    });

    it("should convert number to string", async () => {
      const node = createMockMemoryRwNode({
        action: "get",
        key: "count",
      });
      const ctx = createMockContext();

      const result = await memory_rw_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.value).toBe("42");
    });

    it("should convert objects to string representation", async () => {
      const node = createMockMemoryRwNode({
        action: "get",
        key: "nested",
      });
      const ctx = createMockContext();

      const result = await memory_rw_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.value).toBe("[object Object]");
    });

    it("should resolve template in key", async () => {
      const node = createMockMemoryRwNode({
        action: "get",
        key: "{{memory.user_id}}-data",
      });
      const ctx = createMockContext();
      ctx.memory!["user-1-data"] = "resolved";

      const result = await memory_rw_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.value).toBe("resolved");
    });
  });

  describe("execute — set action", () => {
    it("should set value in memory", async () => {
      const node = createMockMemoryRwNode({
        action: "set",
        key: "new-key",
        value: "new-value",
      });
      const ctx = createMockContext();

      const result = await memory_rw_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(result.output.value).toBe("new-value");
      expect(ctx.memory["new-key"]).toBe("new-value");
    });

    it("should overwrite existing value", async () => {
      const node = createMockMemoryRwNode({
        action: "set",
        key: "existing",
        value: "updated",
      });
      const ctx = createMockContext();

      const result = await memory_rw_handler.execute(node, ctx);

      expect(result.output.value).toBe("updated");
      expect(ctx.memory["existing"]).toBe("updated");
    });

    it("should resolve template in value", async () => {
      const node = createMockMemoryRwNode({
        action: "set",
        key: "calculated",
        value: "count={{memory.count}}",
      });
      const ctx = createMockContext();

      const result = await memory_rw_handler.execute(node, ctx);

      expect(result.output.value).toBe("count=42");
      expect(ctx.memory["calculated"]).toBe("count=42");
    });

    it("should resolve template in key during set", async () => {
      const node = createMockMemoryRwNode({
        action: "set",
        key: "{{memory.user_id}}-setting",
        value: "value123",
      });
      const ctx = createMockContext();

      const result = await memory_rw_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(ctx.memory["user-1-setting"]).toBe("value123");
    });

    it("should handle empty value", async () => {
      const node = createMockMemoryRwNode({
        action: "set",
        key: "empty",
        value: "",
      });
      const ctx = createMockContext();

      const result = await memory_rw_handler.execute(node, ctx);

      expect(result.output.value).toBe("");
      expect(ctx.memory["empty"]).toBe("");
    });
  });

  describe("execute — delete action", () => {
    it("should delete existing key", async () => {
      const node = createMockMemoryRwNode({
        action: "delete",
        key: "existing",
      });
      const ctx = createMockContext();

      const result = await memory_rw_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(ctx.memory["existing"]).toBeUndefined();
    });

    it("should return false for non-existent key", async () => {
      const node = createMockMemoryRwNode({
        action: "delete",
        key: "nonexistent",
      });
      const ctx = createMockContext();

      const result = await memory_rw_handler.execute(node, ctx);

      expect(result.output.success).toBe(false);
      expect(result.output.value).toBe("");
    });

    it("should return empty string on delete", async () => {
      const node = createMockMemoryRwNode({
        action: "delete",
        key: "existing",
      });
      const ctx = createMockContext();

      const result = await memory_rw_handler.execute(node, ctx);

      expect(result.output.value).toBe("");
    });

    it("should resolve template in key during delete", async () => {
      const node = createMockMemoryRwNode({
        action: "delete",
        key: "{{memory.user_id}}-session",
      });
      const ctx = createMockContext();
      ctx.memory!["user-1-session"] = "active";

      const result = await memory_rw_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(ctx.memory!["user-1-session"]).toBeUndefined();
    });
  });

  describe("execute — list action", () => {
    it("should list all memory keys", async () => {
      const node = createMockMemoryRwNode({
        action: "list",
      });
      const ctx = createMockContext();

      const result = await memory_rw_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      const keys = JSON.parse(result.output.value);
      expect(keys).toContain("agent_id");
      expect(keys).toContain("existing");
      expect(keys).toContain("count");
    });

    it("should return JSON array of keys", async () => {
      const node = createMockMemoryRwNode({
        action: "list",
      });
      const ctx = createMockContext({
        memory: { a: 1, b: 2, c: 3 },
      });

      const result = await memory_rw_handler.execute(node, ctx);

      const keys = JSON.parse(result.output.value);
      expect(Array.isArray(keys)).toBe(true);
      expect(keys).toHaveLength(3);
    });

    it("should handle empty memory", async () => {
      const node = createMockMemoryRwNode({
        action: "list",
      });
      const ctx = createMockContext({
        memory: {},
      });

      const result = await memory_rw_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      const keys = JSON.parse(result.output.value);
      expect(keys).toEqual([]);
    });
  });

  describe("execute — unknown action", () => {
    it("should return failure for unknown action", async () => {
      const node = createMockMemoryRwNode({
        action: "unknown" as any,
      });
      const ctx = createMockContext();

      const result = await memory_rw_handler.execute(node, ctx);

      expect(result.output.success).toBe(false);
      expect(result.output.value).toBe("");
    });
  });

  describe("execute — edge cases", () => {
    it("should handle undefined memory", async () => {
      const node = createMockMemoryRwNode({
        action: "get",
        key: "test",
      });
      const ctx = createMockContext({
        memory: undefined,
      });

      const result = await memory_rw_handler.execute(node, ctx);

      expect(result.output.success).toBe(false);
    });

    it("should handle set with undefined memory", async () => {
      const node = createMockMemoryRwNode({
        action: "set",
        key: "test",
        value: "value",
      });
      const ctx = createMockContext({
        memory: undefined,
      });

      const result = await memory_rw_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
    });

    it("should handle delete with undefined memory", async () => {
      const node = createMockMemoryRwNode({
        action: "delete",
        key: "test",
      });
      const ctx = createMockContext({
        memory: undefined,
      });

      const result = await memory_rw_handler.execute(node, ctx);

      expect(result.output.success).toBe(false);
    });

    it("should handle list with undefined memory", async () => {
      const node = createMockMemoryRwNode({
        action: "list",
      });
      const ctx = createMockContext({
        memory: undefined,
      });

      const result = await memory_rw_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      const keys = JSON.parse(result.output.value);
      expect(keys).toEqual([]);
    });

    it("should handle special characters in key", async () => {
      const node = createMockMemoryRwNode({
        action: "set",
        key: "user:123:@action",
        value: "special",
      });
      const ctx = createMockContext();

      const result = await memory_rw_handler.execute(node, ctx);

      expect(result.output.success).toBe(true);
      expect(ctx.memory["user:123:@action"]).toBe("special");
    });
  });

  describe("test (validation)", () => {
    it("should return no warnings", () => {
      const node = createMockMemoryRwNode();
      const ctx = createMockContext();

      const result = memory_rw_handler.test(node, ctx);

      expect(result.warnings).toEqual([]);
    });

    it("should include preview with action and key", () => {
      const node = createMockMemoryRwNode({
        action: "set",
        key: "my-key",
      });
      const ctx = createMockContext();

      const result = memory_rw_handler.test(node, ctx);

      expect(result.preview.action).toBe("set");
      expect(result.preview.key).toBe("my-key");
    });
  });

  describe("integration scenarios", () => {
    it("should manage user session state", async () => {
      const ctx = createMockContext();

      // Set session
      const setNode = createMockMemoryRwNode({
        action: "set",
        key: "session:user-1",
        value: '{"token":"abc123","expires":1234567890}',
      });
      const setResult = await memory_rw_handler.execute(setNode, ctx);
      expect(setResult.output.success).toBe(true);

      // Get session
      const getNode = createMockMemoryRwNode({
        action: "get",
        key: "session:user-1",
      });
      const getResult = await memory_rw_handler.execute(getNode, ctx);
      expect(getResult.output.success).toBe(true);
      expect(getResult.output.value).toContain("token");

      // Delete session
      const delNode = createMockMemoryRwNode({
        action: "delete",
        key: "session:user-1",
      });
      const delResult = await memory_rw_handler.execute(delNode, ctx);
      expect(delResult.output.success).toBe(true);
    });

    it("should track multiple counters", async () => {
      const ctx = createMockContext();

      // Set counters
      for (let i = 1; i <= 3; i++) {
        const node = createMockMemoryRwNode({
          action: "set",
          key: `counter-${i}`,
          value: String(i * 10),
        });
        await memory_rw_handler.execute(node, ctx);
      }

      // List all keys
      const listNode = createMockMemoryRwNode({ action: "list" });
      const listResult = await memory_rw_handler.execute(listNode, ctx);
      const keys = JSON.parse(listResult.output.value);
      expect(keys.filter((k: string) => k.startsWith("counter-"))).toHaveLength(3);
    });
  });
});
