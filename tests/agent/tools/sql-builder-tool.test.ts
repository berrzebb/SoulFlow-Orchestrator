/**
 * SqlBuilderTool — select/insert/update/delete/create_table/validate/parameterize 테스트.
 */
import { describe, it, expect } from "vitest";
import { SqlBuilderTool } from "../../../src/agent/tools/sql-builder.js";

const tool = new SqlBuilderTool();

async function exec(params: Record<string, unknown>): Promise<unknown> {
  const result = await tool.execute(params);
  try { return JSON.parse(String(result)); } catch { return result; }
}

describe("SqlBuilderTool — select", () => {
  it("기본 SELECT 생성", async () => {
    const r = await exec({ action: "select", table: "users" }) as Record<string, unknown>;
    expect(String(r.sql)).toContain("SELECT");
    expect(String(r.sql)).toContain("users");
    expect(String(r.sql)).toContain("*");
  });

  it("컬럼 지정 SELECT", async () => {
    const r = await exec({ action: "select", table: "users", columns: JSON.stringify(["id", "name"]) }) as Record<string, unknown>;
    expect(String(r.sql)).toContain("id");
    expect(String(r.sql)).toContain("name");
    expect(String(r.sql)).not.toContain("*");
  });

  it("WHERE 조건 포함", async () => {
    const r = await exec({ action: "select", table: "users", where: JSON.stringify({ active: true }) }) as Record<string, unknown>;
    expect(String(r.sql)).toContain("WHERE");
    expect(String(r.sql)).toContain("active");
    expect((r.params as unknown[]).length).toBeGreaterThan(0);
  });

  it("ORDER BY, LIMIT, OFFSET", async () => {
    const r = await exec({ action: "select", table: "users", order_by: "name ASC", limit: 10, offset: 20 }) as Record<string, unknown>;
    expect(String(r.sql)).toContain("ORDER BY name ASC");
    expect(String(r.sql)).toContain("LIMIT 10");
    expect(String(r.sql)).toContain("OFFSET 20");
  });

  it("table 없음 → Error", async () => {
    const r = await exec({ action: "select" });
    expect(String(r)).toContain("Error");
  });
});

describe("SqlBuilderTool — insert", () => {
  it("INSERT 쿼리 생성", async () => {
    const values = JSON.stringify({ name: "Alice", age: 30 });
    const r = await exec({ action: "insert", table: "users", values }) as Record<string, unknown>;
    expect(String(r.sql)).toContain("INSERT INTO");
    expect(String(r.sql)).toContain("users");
    expect(String(r.sql)).toContain("name");
    expect((r.params as unknown[])[0]).toBe("Alice");
    expect((r.params as unknown[])[1]).toBe(30);
  });

  it("PostgreSQL 플레이스홀더 ($1, $2)", async () => {
    const r = await exec({ action: "insert", table: "t", values: JSON.stringify({ a: 1 }), dialect: "postgres" }) as Record<string, unknown>;
    expect(String(r.sql)).toContain("$1");
  });

  it("table 없음 → Error", async () => {
    const r = await exec({ action: "insert", values: JSON.stringify({ a: 1 }) });
    expect(String(r)).toContain("Error");
  });
});

describe("SqlBuilderTool — update", () => {
  it("UPDATE 쿼리 생성", async () => {
    const r = await exec({
      action: "update",
      table: "users",
      values: JSON.stringify({ name: "Bob" }),
      where: JSON.stringify({ id: 1 }),
    }) as Record<string, unknown>;
    expect(String(r.sql)).toContain("UPDATE");
    expect(String(r.sql)).toContain("SET");
    expect(String(r.sql)).toContain("WHERE");
    expect((r.params as unknown[]).length).toBeGreaterThan(0);
  });

  it("table 없음 → Error", async () => {
    const r = await exec({ action: "update", values: JSON.stringify({ a: 1 }) });
    expect(String(r)).toContain("Error");
  });
});

describe("SqlBuilderTool — delete", () => {
  it("DELETE 쿼리 생성", async () => {
    const r = await exec({ action: "delete", table: "users", where: JSON.stringify({ id: 5 }) }) as Record<string, unknown>;
    expect(String(r.sql)).toContain("DELETE FROM");
    expect(String(r.sql)).toContain("WHERE");
    expect(String(r.sql)).toContain("id");
  });

  it("WHERE 없으면 안전 에러 반환", async () => {
    const r = await exec({ action: "delete", table: "users" });
    expect(String(r)).toContain("Error");
  });
});
