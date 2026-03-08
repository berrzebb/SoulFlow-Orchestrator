/** Set (변수 할당) 노드 핸들러 테스트
 *
 * 목표: set_handler를 통한 메모리 변수 할당 및 경로 기반 설정 검증
 *       - execute: assignments를 메모리에 설정 + 출력으로 반환
 *       - set_nested: dot-notation 경로를 따라 깊은 객체에 값 설정
 *       - resolve_deep: 값 내 템플릿 변수 해석
 *       - output: 할당된 모든 키-값 쌍을 포함
 */

import { describe, it, expect, vi } from "vitest";
import { set_handler } from "@src/agent/nodes/set.js";
import type { SetNodeDefinition, OrcheNodeDefinition } from "@src/agent/workflow-node.types.js";
import type { OrcheNodeExecutorContext } from "@src/agent/node-registry.js";

/* ── Mock Data ── */

const createMockSetNode = (overrides?: Partial<SetNodeDefinition>): SetNodeDefinition => ({
  node_id: "set-1",
  title: "Test Set Node",
  node_type: "set",
  assignments: [
    { key: "var1", value: "hello" },
    { key: "var2", value: 42 },
  ],
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

describe("Set Node Handler", () => {
  describe("metadata", () => {
    it("should have correct node_type", () => {
      expect(set_handler.node_type).toBe("set");
    });

    it("should have empty output_schema", () => {
      const schema = set_handler.output_schema || [];
      expect(schema).toEqual([]);
    });

    it("should have create_default returning valid node template", () => {
      const defaultNode = set_handler.create_default?.();
      expect(defaultNode?.assignments).toEqual([]);
    });
  });

  describe("execute — basic assignment", () => {
    it("should set single variable in memory", async () => {
      const node = createMockSetNode({
        assignments: [{ key: "x", value: 10 }],
      });
      const ctx = createMockContext();

      const result = await set_handler.execute(node, ctx);

      expect(ctx.memory["x"]).toBe(10);
      expect(result.output["x"]).toBe(10);
    });

    it("should set multiple variables in single execution", async () => {
      const node = createMockSetNode({
        assignments: [
          { key: "a", value: 1 },
          { key: "b", value: 2 },
          { key: "c", value: 3 },
        ],
      });
      const ctx = createMockContext();

      const result = await set_handler.execute(node, ctx);

      expect(ctx.memory["a"]).toBe(1);
      expect(ctx.memory["b"]).toBe(2);
      expect(ctx.memory["c"]).toBe(3);
      expect(result.output).toEqual({ a: 1, b: 2, c: 3 });
    });

    it("should return assignment results in output", async () => {
      const node = createMockSetNode({
        assignments: [
          { key: "name", value: "Alice" },
          { key: "age", value: 30 },
        ],
      });
      const ctx = createMockContext();

      const result = await set_handler.execute(node, ctx);

      expect(result.output).toEqual({ name: "Alice", age: 30 });
    });

    it("should overwrite existing variables", async () => {
      const node = createMockSetNode({
        assignments: [{ key: "x", value: 100 }],
      });
      const ctx = createMockContext({
        memory: { x: 50 },
      });

      const result = await set_handler.execute(node, ctx);

      expect(ctx.memory["x"]).toBe(100);
      expect(result.output["x"]).toBe(100);
    });

    it("should handle empty assignments array", async () => {
      const node = createMockSetNode({
        assignments: [],
      });
      const ctx = createMockContext();

      const result = await set_handler.execute(node, ctx);

      expect(result.output).toEqual({});
    });
  });

  describe("execute — nested path assignment", () => {
    it("should set value at nested path", async () => {
      const node = createMockSetNode({
        assignments: [{ key: "user.name", value: "Bob" }],
      });
      const ctx = createMockContext();

      const result = await set_handler.execute(node, ctx);

      expect(ctx.memory["user"]).toEqual({ name: "Bob" });
      expect(result.output["user.name"]).toBe("Bob");
    });

    it("should create intermediate objects automatically", async () => {
      const node = createMockSetNode({
        assignments: [{ key: "a.b.c.d", value: "deep" }],
      });
      const ctx = createMockContext();

      const result = await set_handler.execute(node, ctx);

      expect((ctx.memory["a"] as any).b.c.d).toBe("deep");
      expect(result.output["a.b.c.d"]).toBe("deep");
    });

    it("should overwrite intermediate objects when needed", async () => {
      const node = createMockSetNode({
        assignments: [{ key: "data.value", value: 99 }],
      });
      const ctx = createMockContext({
        memory: {
          data: { old: "value" },
        },
      });

      const result = await set_handler.execute(node, ctx);

      expect(ctx.memory["data"]).toEqual({ old: "value", value: 99 });
    });

    it("should preserve existing sibling values in nested path", async () => {
      const node = createMockSetNode({
        assignments: [
          { key: "config.db.host", value: "localhost" },
          { key: "config.db.port", value: 5432 },
        ],
      });
      const ctx = createMockContext();

      const result = await set_handler.execute(node, ctx);

      const config = ctx.memory["config"] as any;
      expect(config.db.host).toBe("localhost");
      expect(config.db.port).toBe(5432);
      expect(result.output).toEqual({
        "config.db.host": "localhost",
        "config.db.port": 5432,
      });
    });

    it("should handle numeric keys in paths", async () => {
      const node = createMockSetNode({
        assignments: [{ key: "items.0.id", value: 1 }],
      });
      const ctx = createMockContext();

      const result = await set_handler.execute(node, ctx);

      expect((ctx.memory["items"] as any)[0].id).toBe(1);
    });
  });

  describe("execute — template variable resolution", () => {
    it("should resolve template variables in string values", async () => {
      const node = createMockSetNode({
        assignments: [{ key: "greeting", value: "{{memory.name}}" }],
      });
      const ctx = createMockContext({
        memory: { name: "Charlie" },
      });

      const result = await set_handler.execute(node, ctx);

      expect(ctx.memory["greeting"]).toBe("Charlie");
      expect(result.output["greeting"]).toBe("Charlie");
    });

    it("should resolve nested memory references", async () => {
      const node = createMockSetNode({
        assignments: [{ key: "result", value: "User: {{memory.user.name}}, Age: {{memory.user.age}}" }],
      });
      const ctx = createMockContext({
        memory: {
          user: { name: "Diana", age: 28 },
        },
      });

      const result = await set_handler.execute(node, ctx);

      expect(result.output["result"]).toBe("User: Diana, Age: 28");
    });

    it("should handle objects with template values", async () => {
      const node = createMockSetNode({
        assignments: [
          {
            key: "person",
            value: {
              name: "{{memory.greeting}}",
              status: "active",
            },
          },
        ],
      });
      const ctx = createMockContext({
        memory: { greeting: "Eve" },
      });

      const result = await set_handler.execute(node, ctx);

      const person = ctx.memory["person"] as any;
      expect(person.name).toBe("Eve");
      expect(person.status).toBe("active");
    });

    it("should handle arrays with template values", async () => {
      const node = createMockSetNode({
        assignments: [
          {
            key: "tags",
            value: ["{{memory.tag1}}", "{{memory.tag2}}", "static"],
          },
        ],
      });
      const ctx = createMockContext({
        memory: { tag1: "first", tag2: "second" },
      });

      const result = await set_handler.execute(node, ctx);

      expect(ctx.memory["tags"]).toEqual(["first", "second", "static"]);
    });

    it("should handle missing template variables as empty string", async () => {
      const node = createMockSetNode({
        assignments: [{ key: "msg", value: "Value: {{memory.missing}}" }],
      });
      const ctx = createMockContext();

      const result = await set_handler.execute(node, ctx);

      expect(result.output["msg"]).toBe("Value: ");
    });

    it("should resolve complex nested structures", async () => {
      const node = createMockSetNode({
        assignments: [
          {
            key: "config",
            value: {
              user: { id: "{{memory.id}}", name: "{{memory.name}}" },
              settings: { theme: "{{memory.theme}}", lang: "en" },
              permissions: ["{{memory.perm1}}", "{{memory.perm2}}"],
            },
          },
        ],
      });
      const ctx = createMockContext({
        memory: {
          id: 123,
          name: "Frank",
          theme: "dark",
          perm1: "read",
          perm2: "write",
        },
      });

      const result = await set_handler.execute(node, ctx);

      const config = ctx.memory["config"] as any;
      expect(config.user).toEqual({ id: "123", name: "Frank" });
      expect(config.settings).toEqual({ theme: "dark", lang: "en" });
      expect(config.permissions).toEqual(["read", "write"]);
    });
  });

  describe("execute — value type handling", () => {
    it("should preserve numeric values", async () => {
      const node = createMockSetNode({
        assignments: [
          { key: "int", value: 42 },
          { key: "float", value: 3.14 },
          { key: "negative", value: -10 },
        ],
      });
      const ctx = createMockContext();

      const result = await set_handler.execute(node, ctx);

      expect(ctx.memory["int"]).toBe(42);
      expect(ctx.memory["float"]).toBe(3.14);
      expect(ctx.memory["negative"]).toBe(-10);
    });

    it("should preserve boolean values", async () => {
      const node = createMockSetNode({
        assignments: [
          { key: "is_active", value: true },
          { key: "is_deleted", value: false },
        ],
      });
      const ctx = createMockContext();

      const result = await set_handler.execute(node, ctx);

      expect(ctx.memory["is_active"]).toBe(true);
      expect(ctx.memory["is_deleted"]).toBe(false);
    });

    it("should handle null values", async () => {
      const node = createMockSetNode({
        assignments: [{ key: "value", value: null }],
      });
      const ctx = createMockContext();

      const result = await set_handler.execute(node, ctx);

      expect(ctx.memory["value"]).toBeNull();
    });

    it("should handle undefined values", async () => {
      const node = createMockSetNode({
        assignments: [{ key: "value", value: undefined }],
      });
      const ctx = createMockContext();

      const result = await set_handler.execute(node, ctx);

      expect(ctx.memory["value"]).toBeUndefined();
    });

    it("should handle array values", async () => {
      const node = createMockSetNode({
        assignments: [{ key: "items", value: [1, "two", { three: 3 }, null] }],
      });
      const ctx = createMockContext();

      const result = await set_handler.execute(node, ctx);

      expect(ctx.memory["items"]).toEqual([1, "two", { three: 3 }, null]);
    });

    it("should handle object values", async () => {
      const node = createMockSetNode({
        assignments: [
          {
            key: "data",
            value: {
              nested: { deep: { value: 42 } },
              array: [1, 2, 3],
            },
          },
        ],
      });
      const ctx = createMockContext();

      const result = await set_handler.execute(node, ctx);

      const data = ctx.memory["data"] as any;
      expect(data.nested.deep.value).toBe(42);
      expect(data.array).toEqual([1, 2, 3]);
    });
  });

  describe("test (validation)", () => {
    it("should return no warnings for valid config", () => {
      const node = createMockSetNode({
        assignments: [{ key: "x", value: 10 }],
      });
      const ctx = createMockContext();

      const result = set_handler.test(node, ctx);

      expect(result.warnings).toEqual([]);
    });

    it("should include all assignments in preview", () => {
      const node = createMockSetNode({
        assignments: [
          { key: "a", value: 1 },
          { key: "b", value: 2 },
        ],
      });
      const ctx = createMockContext();

      const result = set_handler.test(node, ctx);

      expect(result.preview.assignments).toHaveLength(2);
      expect(result.preview.assignments[0]).toEqual({
        key: "a",
        resolved_value: 1,
      });
      expect(result.preview.assignments[1]).toEqual({
        key: "b",
        resolved_value: 2,
      });
    });

    it("should show resolved template values in preview", () => {
      const node = createMockSetNode({
        assignments: [{ key: "greeting", value: "Hello {{memory.name}}" }],
      });
      const ctx = createMockContext({
        memory: { name: "Grace" },
      });

      const result = set_handler.test(node, ctx);

      expect(result.preview.assignments[0].resolved_value).toBe("Hello Grace");
    });

    it("should handle missing template variables in preview", () => {
      const node = createMockSetNode({
        assignments: [{ key: "msg", value: "Value is {{memory.missing}}" }],
      });
      const ctx = createMockContext();

      const result = set_handler.test(node, ctx);

      expect(result.preview.assignments[0].resolved_value).toBe("Value is ");
    });

    it("should show complex structures in preview", () => {
      const node = createMockSetNode({
        assignments: [
          {
            key: "config",
            value: { host: "{{memory.host}}", port: 3000 },
          },
        ],
      });
      const ctx = createMockContext({
        memory: { host: "localhost" },
      });

      const result = set_handler.test(node, ctx);

      const preview = result.preview.assignments[0].resolved_value as any;
      expect(preview.host).toBe("localhost");
      expect(preview.port).toBe(3000);
    });
  });

  describe("integration scenarios", () => {
    it("should set user profile data", async () => {
      const node = createMockSetNode({
        assignments: [
          {
            key: "user.profile",
            value: {
              username: "{{memory.input.username}}",
              email: "{{memory.input.email}}",
              created_at: "{{memory.timestamp}}",
            },
          },
        ],
      });
      const ctx = createMockContext({
        memory: {
          input: { username: "henry", email: "henry@example.com" },
          timestamp: "2024-01-01T00:00:00Z",
        },
      });

      const result = await set_handler.execute(node, ctx);

      const profile = (ctx.memory["user"] as any).profile;
      expect(profile.username).toBe("henry");
      expect(profile.email).toBe("henry@example.com");
      expect(profile.created_at).toBe("2024-01-01T00:00:00Z");
    });

    it("should aggregate results from multiple sources", async () => {
      const node = createMockSetNode({
        assignments: [
          { key: "results.api_response", value: { data: "from_api", count: 3 } },
          { key: "results.db_query", value: { rows: 2, status: "ok" } },
          { key: "results.status", value: "success" },
        ],
      });
      const ctx = createMockContext();

      const result = await set_handler.execute(node, ctx);

      const results = ctx.memory["results"] as any;
      expect(results.api_response).toEqual({ data: "from_api", count: 3 });
      expect(results.db_query).toEqual({ rows: 2, status: "ok" });
      expect(results.status).toBe("success");
    });

    it("should support pipeline-style data transformation", async () => {
      const node = createMockSetNode({
        assignments: [
          { key: "step1", value: "{{memory.input}}" },
          { key: "step2", value: "processed: {{memory.step1}}" },
          { key: "step3", value: "final: {{memory.step2}}" },
        ],
      });
      const ctx = createMockContext({
        memory: { input: "data" },
      });

      await set_handler.execute(node, ctx);

      expect(ctx.memory["step1"]).toBe("data");
      expect(ctx.memory["step2"]).toBe("processed: data");
      expect(ctx.memory["step3"]).toBe("final: processed: data");
    });

    it("should handle configuration inheritance", async () => {
      const node = createMockSetNode({
        assignments: [
          {
            key: "app.config",
            value: {
              ...{ env: "production", debug: false }, // base config
              name: "{{memory.app_name}}",
              version: "{{memory.version}}",
            },
          },
        ],
      });
      const ctx = createMockContext({
        memory: {
          app_name: "MyApp",
          version: "1.0.0",
        },
      });

      await set_handler.execute(node, ctx);

      const config = (ctx.memory["app"] as any).config;
      expect(config.env).toBe("production");
      expect(config.debug).toBe(false);
      expect(config.name).toBe("MyApp");
      expect(config.version).toBe("1.0.0");
    });
  });
});
