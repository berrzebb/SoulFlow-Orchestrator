/** Database 노드 핸들러 테스트
 *
 * 목표: db_handler를 통한 데이터베이스 쿼리 검증
 *       - execute: 스텁 구현 (메타데이터)
 *       - runner_execute: query_db 서비스 호출
 *       - query/datasource: 템플릿 해석
 *       - operation: query/insert/update/delete 타입
 *       - validation: 필수 필드, DELETE WHERE 경고
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { db_handler } from "@src/agent/nodes/db.js";
import type { DbNodeDefinition, OrcheNodeDefinition } from "@src/agent/workflow-node.types.js";
import type { OrcheNodeExecutorContext, RunnerContext } from "@src/agent/node-registry.js";

/* ── Mock Data ── */

const createMockDbNode = (overrides?: Partial<DbNodeDefinition>): DbNodeDefinition => ({
  node_id: "db-1",
  label: "Test DB",
  node_type: "db",
  operation: "query",
  datasource: "primary",
  query: "SELECT * FROM users",
  params: {},
  ...overrides,
});

const createMockContext = (overrides?: Partial<OrcheNodeExecutorContext>): OrcheNodeExecutorContext => ({
  memory: {
    agent_id: "agent-1",
    user_id: "user-1",
    workspace_id: "workspace-1",
    previous_output: {},
    table: "users",
    id: "123",
  },
  ...overrides,
});

const createMockRunner = (overrides?: Partial<RunnerContext>): RunnerContext => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  ...overrides,
});

/* ── Tests ── */

describe("DB Node Handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("metadata", () => {
    it("should have correct node_type", () => {
      expect(db_handler.node_type).toBe("db");
    });

    it("should have output_schema with rows and affected_rows", () => {
      const schema = db_handler.output_schema || [];
      const fields = schema.map((f) => f.name);
      expect(fields).toContain("rows");
      expect(fields).toContain("affected_rows");
    });

    it("should have input_schema with query, datasource, params", () => {
      const schema = db_handler.input_schema || [];
      const fields = schema.map((f) => f.name);
      expect(fields).toContain("query");
      expect(fields).toContain("datasource");
      expect(fields).toContain("params");
    });

    it("should have create_default returning query operation", () => {
      const defaultNode = db_handler.create_default?.();
      expect(defaultNode?.operation).toBe("query");
      expect(defaultNode?.datasource).toBe("");
      expect(defaultNode?.query).toBe("");
    });

    it("should have icon and color metadata", () => {
      expect(db_handler.icon).toBeDefined();
      expect(db_handler.color).toBeDefined();
      expect(db_handler.shape).toBe("rect");
    });
  });

  describe("execute — stub implementation", () => {
    it("should return empty rows with metadata", async () => {
      const node = createMockDbNode();
      const ctx = createMockContext();

      const result = await db_handler.execute(node, ctx);

      expect(result.output.rows).toEqual([]);
      expect(result.output.affected_rows).toBe(0);
    });

    it("should include resolved query and datasource in metadata", async () => {
      const node = createMockDbNode({
        query: "SELECT * FROM {{memory.table}}",
        datasource: "{{memory.table}}-db",
      });
      const ctx = createMockContext();

      const result = await db_handler.execute(node, ctx);

      expect((result.output as any)._meta.query).toBe("SELECT * FROM users");
      expect((result.output as any)._meta.datasource).toBe("users-db");
    });

    it("should include operation in metadata", async () => {
      const node = createMockDbNode({ operation: "insert" });
      const ctx = createMockContext();

      const result = await db_handler.execute(node, ctx);

      expect((result.output as any)._meta.operation).toBe("insert");
    });
  });

  describe("runner_execute — query_db service", () => {
    it("should call query_db with datasource and query", async () => {
      const queryDb = vi.fn().mockResolvedValue({
        rows: [{ id: 1, name: "Alice" }],
        affected_rows: 1,
      });

      const node = createMockDbNode();
      const ctx = createMockContext();
      const runner = createMockRunner({ services: { query_db: queryDb } });

      const result = await db_handler.runner_execute?.(node, ctx, runner) || { output: {} };

      expect(queryDb).toHaveBeenCalledWith("primary", "SELECT * FROM users", {});
      expect(result.output.rows).toEqual([{ id: 1, name: "Alice" }]);
      expect(result.output.affected_rows).toBe(1);
    });

    it("should pass resolved query to query_db", async () => {
      const queryDb = vi.fn().mockResolvedValue({ rows: [], affected_rows: 0 });

      const node = createMockDbNode({
        query: "SELECT * FROM {{memory.table}} WHERE id = {{memory.id}}",
      });
      const ctx = createMockContext();
      const runner = createMockRunner({ services: { query_db: queryDb } });

      await db_handler.runner_execute?.(node, ctx, runner);

      expect(queryDb).toHaveBeenCalledWith(
        "primary",
        "SELECT * FROM users WHERE id = 123",
        {}
      );
    });

    it("should pass query parameters to query_db", async () => {
      const queryDb = vi.fn().mockResolvedValue({ rows: [], affected_rows: 0 });

      const node = createMockDbNode({
        query: "SELECT * FROM users WHERE id = $1",
        params: { id: "123" },
      });
      const ctx = createMockContext();
      const runner = createMockRunner({ services: { query_db: queryDb } });

      await db_handler.runner_execute?.(node, ctx, runner);

      expect(queryDb).toHaveBeenCalled();
      // Parameters are passed as Record<string, unknown>
      expect(queryDb.mock.calls[0][2]).toEqual({ id: "123" });
    });

    it("should handle multiple result rows", async () => {
      const queryDb = vi.fn().mockResolvedValue({
        rows: [
          { id: 1, name: "Alice" },
          { id: 2, name: "Bob" },
          { id: 3, name: "Charlie" },
        ],
        affected_rows: 3,
      });

      const node = createMockDbNode();
      const ctx = createMockContext();
      const runner = createMockRunner({ services: { query_db: queryDb } });

      const result = await db_handler.runner_execute?.(node, ctx, runner) || { output: {} };

      expect(result.output.rows).toHaveLength(3);
      expect(result.output.affected_rows).toBe(3);
    });

    it("should fallback to execute when query_db unavailable", async () => {
      const node = createMockDbNode();
      const ctx = createMockContext();
      const runner = createMockRunner({ services: {} });

      const result = await db_handler.runner_execute?.(node, ctx, runner) || { output: {} };

      expect(result.output.rows).toEqual([]);
      expect(result.output.affected_rows).toBe(0);
    });

    it("should handle query_db errors gracefully", async () => {
      const queryDb = vi.fn().mockRejectedValue(new Error("Connection refused"));

      const node = createMockDbNode({ node_id: "db-error" });
      const ctx = createMockContext();
      const runner = createMockRunner({ services: { query_db: queryDb } });

      const result = await db_handler.runner_execute?.(node, ctx, runner) || { output: {} };

      expect((result.output as any).error).toContain("Connection refused");
      expect(result.output.rows).toEqual([]);
      expect(runner.logger.warn).toHaveBeenCalledWith("db_node_error", expect.any(Object));
    });

    it("should handle syntax errors", async () => {
      const queryDb = vi.fn().mockRejectedValue(new Error("Syntax error in query"));

      const node = createMockDbNode();
      const ctx = createMockContext();
      const runner = createMockRunner({ services: { query_db: queryDb } });

      const result = await db_handler.runner_execute?.(node, ctx, runner) || { output: {} };

      expect((result.output as any).error).toBeDefined();
    });
  });

  describe("test (validation)", () => {
    it("should return no warnings for valid query", () => {
      const node = createMockDbNode({
        datasource: "primary",
        query: "SELECT * FROM users",
      });
      const ctx = createMockContext();

      const result = db_handler.test(node, ctx);

      expect(result.warnings).toEqual([]);
    });

    it("should warn when datasource is empty", () => {
      const node = createMockDbNode({ datasource: "" });
      const ctx = createMockContext();

      const result = db_handler.test(node, ctx);

      expect(result.warnings).toContain("datasource is empty");
    });

    it("should warn when query is empty", () => {
      const node = createMockDbNode({ query: "" });
      const ctx = createMockContext();

      const result = db_handler.test(node, ctx);

      expect(result.warnings).toContain("query is empty");
    });

    it("should warn on DELETE without WHERE", () => {
      const node = createMockDbNode({
        operation: "delete",
        query: "DELETE FROM users",
      });
      const ctx = createMockContext();

      const result = db_handler.test(node, ctx);

      expect(result.warnings.some((w) => w.includes("WHERE"))).toBe(true);
    });

    it("should not warn on DELETE with WHERE", () => {
      const node = createMockDbNode({
        operation: "delete",
        query: "DELETE FROM users WHERE id = 1",
      });
      const ctx = createMockContext();

      const result = db_handler.test(node, ctx);

      expect(result.warnings.filter((w) => w.includes("WHERE"))).toEqual([]);
    });

    it("should include preview with operation, datasource, query", () => {
      const node = createMockDbNode({
        operation: "insert",
        datasource: "primary",
        query: "INSERT INTO users VALUES (1, 'Alice')",
      });
      const ctx = createMockContext();

      const result = db_handler.test(node, ctx);

      expect(result.preview.operation).toBe("insert");
      expect(result.preview.datasource).toBe("primary");
      expect(result.preview.query).toBe("INSERT INTO users VALUES (1, 'Alice')");
    });

    it("should warn for multiple issues", () => {
      const node = createMockDbNode({
        datasource: "",
        query: "DELETE FROM users",
        operation: "delete",
      });
      const ctx = createMockContext();

      const result = db_handler.test(node, ctx);

      expect(result.warnings.length).toBeGreaterThanOrEqual(2);
      expect(result.warnings).toContain("datasource is empty");
    });
  });

  describe("operations — different types", () => {
    it("should support query operation", () => {
      const node = createMockDbNode({ operation: "query" });
      const ctx = createMockContext();

      const result = db_handler.test(node, ctx);

      expect(result.preview.operation).toBe("query");
    });

    it("should support insert operation", () => {
      const node = createMockDbNode({
        operation: "insert",
        query: "INSERT INTO users (name) VALUES ('Alice')",
      });
      const ctx = createMockContext();

      const result = db_handler.test(node, ctx);

      expect(result.preview.operation).toBe("insert");
    });

    it("should support update operation", () => {
      const node = createMockDbNode({
        operation: "update",
        query: "UPDATE users SET name = 'Bob' WHERE id = 1",
      });
      const ctx = createMockContext();

      const result = db_handler.test(node, ctx);

      expect(result.preview.operation).toBe("update");
    });

    it("should support delete operation", () => {
      const node = createMockDbNode({
        operation: "delete",
        query: "DELETE FROM users WHERE id = 1",
      });
      const ctx = createMockContext();

      const result = db_handler.test(node, ctx);

      expect(result.preview.operation).toBe("delete");
    });
  });

  describe("integration scenarios", () => {
    it("should query with template resolution", async () => {
      const queryDb = vi.fn().mockResolvedValue({
        rows: [{ id: 123, name: "Alice" }],
        affected_rows: 1,
      });

      const node = createMockDbNode({
        query: "SELECT * FROM users WHERE id = {{memory.id}}",
      });
      const ctx = createMockContext();
      const runner = createMockRunner({ services: { query_db: queryDb } });

      const result = await db_handler.runner_execute?.(node, ctx, runner) || { output: {} };

      expect(queryDb).toHaveBeenCalledWith(
        "primary",
        "SELECT * FROM users WHERE id = 123",
        {}
      );
      expect(result.output.rows[0].id).toBe(123);
    });

    it("should handle insert with affected_rows", async () => {
      const queryDb = vi.fn().mockResolvedValue({
        rows: [],
        affected_rows: 1,
      });

      const node = createMockDbNode({
        operation: "insert",
        query: "INSERT INTO users (name) VALUES ('New User')",
      });
      const ctx = createMockContext();
      const runner = createMockRunner({ services: { query_db: queryDb } });

      const result = await db_handler.runner_execute?.(node, ctx, runner) || { output: {} };

      expect(result.output.affected_rows).toBe(1);
      expect(result.output.rows).toEqual([]);
    });

    it("should handle update with multiple affected rows", async () => {
      const queryDb = vi.fn().mockResolvedValue({
        rows: [],
        affected_rows: 5,
      });

      const node = createMockDbNode({
        operation: "update",
        query: "UPDATE users SET active = 1",
      });
      const ctx = createMockContext();
      const runner = createMockRunner({ services: { query_db: queryDb } });

      const result = await db_handler.runner_execute?.(node, ctx, runner) || { output: {} };

      expect(result.output.affected_rows).toBe(5);
    });

    it("should handle delete with WHERE", async () => {
      const queryDb = vi.fn().mockResolvedValue({
        rows: [],
        affected_rows: 2,
      });

      const node = createMockDbNode({
        operation: "delete",
        query: "DELETE FROM users WHERE status = 'inactive'",
      });
      const ctx = createMockContext();
      const runner = createMockRunner({ services: { query_db: queryDb } });

      const result = await db_handler.runner_execute?.(node, ctx, runner) || { output: {} };

      expect(result.output.affected_rows).toBe(2);
    });
  });

  describe("edge cases", () => {
    it("should handle empty query result", async () => {
      const queryDb = vi.fn().mockResolvedValue({
        rows: [],
        affected_rows: 0,
      });

      const node = createMockDbNode({
        query: "SELECT * FROM users WHERE id = 999",
      });
      const ctx = createMockContext();
      const runner = createMockRunner({ services: { query_db: queryDb } });

      const result = await db_handler.runner_execute?.(node, ctx, runner) || { output: {} };

      expect(result.output.rows).toEqual([]);
      expect(result.output.affected_rows).toBe(0);
    });

    it("should handle large result sets", async () => {
      const largeRows = Array.from({ length: 1000 }, (_, i) => ({
        id: i + 1,
        name: `User ${i + 1}`,
      }));

      const queryDb = vi.fn().mockResolvedValue({
        rows: largeRows,
        affected_rows: 1000,
      });

      const node = createMockDbNode();
      const ctx = createMockContext();
      const runner = createMockRunner({ services: { query_db: queryDb } });

      const result = await db_handler.runner_execute?.(node, ctx, runner) || { output: {} };

      expect(result.output.rows).toHaveLength(1000);
      expect(result.output.affected_rows).toBe(1000);
    });

    it("should handle complex query templates", async () => {
      const queryDb = vi.fn().mockResolvedValue({
        rows: [],
        affected_rows: 0,
      });

      const node = createMockDbNode({
        query: "SELECT * FROM {{memory.table}} WHERE created > '{{memory.date}}' AND status = '{{memory.status}}'",
      });
      const ctx = createMockContext({
        memory: {
          ...createMockContext().memory,
          date: "2024-01-01",
          status: "active",
        },
      });
      const runner = createMockRunner({ services: { query_db: queryDb } });

      await db_handler.runner_execute?.(node, ctx, runner);

      expect(queryDb).toHaveBeenCalledWith(
        "primary",
        "SELECT * FROM users WHERE created > '2024-01-01' AND status = 'active'",
        {}
      );
    });

    it("should handle undefined params gracefully", async () => {
      const queryDb = vi.fn().mockResolvedValue({
        rows: [],
        affected_rows: 0,
      });

      const node = createMockDbNode({ params: undefined as any });
      const ctx = createMockContext();
      const runner = createMockRunner({ services: { query_db: queryDb } });

      await db_handler.runner_execute?.(node, ctx, runner);

      // Params are coerced to Record<string, unknown>
      expect(queryDb).toHaveBeenCalled();
      expect(queryDb.mock.calls[0][0]).toBe("primary");
      expect(queryDb.mock.calls[0][1]).toBe("SELECT * FROM users");
    });

    it("should handle DELETE case insensitivity", () => {
      const node = createMockDbNode({
        operation: "delete",
        query: "delete from users",
      });
      const ctx = createMockContext();

      const result = db_handler.test(node, ctx);

      expect(result.warnings.some((w) => w.includes("WHERE"))).toBe(true);
    });
  });
});
