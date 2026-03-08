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

describe("SqlBuilderTool — create_table", () => {
  it("CREATE TABLE 쿼리 생성", async () => {
    const columns = JSON.stringify([
      { name: "id", type: "INTEGER", primary_key: true },
      { name: "name", type: "TEXT", not_null: true },
      { name: "score", type: "REAL", default: "0.0" },
    ]);
    const r = await exec({ action: "create_table", table: "scores", columns }) as Record<string, unknown>;
    expect(String(r.sql)).toContain("CREATE TABLE IF NOT EXISTS");
    expect(String(r.sql)).toContain("scores");
    expect(String(r.sql)).toContain("PRIMARY KEY");
    expect(String(r.sql)).toContain("NOT NULL");
    expect(String(r.sql)).toContain("DEFAULT 0.0");
  });

  it("table 없음 → Error", async () => {
    const r = await exec({ action: "create_table" });
    expect(String(r)).toContain("Error");
  });

  it("잘못된 columns JSON → Error", async () => {
    const r = await exec({ action: "create_table", table: "t", columns: "bad json" });
    expect(String(r)).toContain("Error");
  });
});

describe("SqlBuilderTool — validate", () => {
  it("유효한 SQL → valid=true", async () => {
    const r = await exec({ action: "validate", sql: "SELECT id FROM users WHERE active = 1" }) as Record<string, unknown>;
    expect(r.valid).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it("빈 SQL → issues 반환", async () => {
    const r = await exec({ action: "validate", sql: "   " }) as Record<string, unknown>;
    expect(r.valid).toBe(false);
    expect((r.issues as string[]).some(i => i.includes("empty"))).toBe(true);
  });

  it("복수 구문 감지", async () => {
    const r = await exec({ action: "validate", sql: "SELECT 1; DROP TABLE users" }) as Record<string, unknown>;
    expect(r.valid).toBe(false);
    expect((r.issues as string[]).some(i => i.includes("multiple"))).toBe(true);
  });

  it("주석 감지 (--)", async () => {
    const r = await exec({ action: "validate", sql: "SELECT 1 -- comment" }) as Record<string, unknown>;
    expect(r.valid).toBe(false);
    expect((r.issues as string[]).some(i => i.includes("comment"))).toBe(true);
  });

  it("주석 감지 (/* */)", async () => {
    const r = await exec({ action: "validate", sql: "SELECT /* hack */ 1" }) as Record<string, unknown>;
    expect(r.valid).toBe(false);
    expect((r.issues as string[]).some(i => i.includes("comment"))).toBe(true);
  });

  it("DROP TABLE 위험 연산 감지", async () => {
    const r = await exec({ action: "validate", sql: "DROP TABLE users" }) as Record<string, unknown>;
    expect(r.valid).toBe(false);
    expect((r.issues as string[]).some(i => i.includes("DROP TABLE"))).toBe(true);
  });

  it("TRUNCATE 위험 연산 감지", async () => {
    const r = await exec({ action: "validate", sql: "TRUNCATE users" }) as Record<string, unknown>;
    expect(r.valid).toBe(false);
    expect((r.issues as string[]).some(i => i.includes("TRUNCATE"))).toBe(true);
  });
});

describe("SqlBuilderTool — parameterize", () => {
  it("문자열 리터럴을 플레이스홀더로 교체 (sqlite)", async () => {
    const r = await exec({ action: "parameterize", sql: "SELECT * FROM t WHERE name = 'Alice' AND city = 'Seoul'" }) as Record<string, unknown>;
    expect(String(r.sql)).toContain("?");
    expect(r.params).toEqual(["Alice", "Seoul"]);
    expect(r.count).toBe(2);
  });

  it("postgres 방언 → $1, $2 플레이스홀더", async () => {
    const r = await exec({ action: "parameterize", sql: "INSERT INTO t (n) VALUES ('hello')", dialect: "postgres" }) as Record<string, unknown>;
    expect(String(r.sql)).toContain("$1");
    expect(r.params).toEqual(["hello"]);
  });

  it("리터럴 없음 → 그대로 반환", async () => {
    const r = await exec({ action: "parameterize", sql: "SELECT * FROM t WHERE id = 1" }) as Record<string, unknown>;
    expect(r.count).toBe(0);
    expect(r.params).toEqual([]);
  });
});

describe("SqlBuilderTool — select 추가 브랜치", () => {
  it("JOIN 포함 SELECT", async () => {
    const joins = JSON.stringify([{ type: "LEFT", table: "orders", on: "users.id = orders.user_id" }]);
    const r = await exec({ action: "select", table: "users", joins }) as Record<string, unknown>;
    expect(String(r.sql)).toContain("LEFT JOIN");
    expect(String(r.sql)).toContain("orders");
  });

  it("JOIN type 없음 → INNER JOIN 기본값", async () => {
    const joins = JSON.stringify([{ table: "orders", on: "users.id = orders.user_id" }]);
    const r = await exec({ action: "select", table: "users", joins }) as Record<string, unknown>;
    expect(String(r.sql)).toContain("INNER JOIN");
  });

  it("GROUP BY 포함", async () => {
    const r = await exec({ action: "select", table: "orders", group_by: "user_id" }) as Record<string, unknown>;
    expect(String(r.sql)).toContain("GROUP BY user_id");
  });

  it("WHERE null 값 → IS NULL", async () => {
    const r = await exec({ action: "select", table: "users", where: JSON.stringify({ deleted_at: null }) }) as Record<string, unknown>;
    expect(String(r.sql)).toContain("IS NULL");
  });

  it("테이블명 특수문자 → 따옴표 처리 (mysql)", async () => {
    const r = await exec({ action: "select", table: "my-table", dialect: "mysql" }) as Record<string, unknown>;
    expect(String(r.sql)).toContain("`my-table`");
  });

  it("테이블명 특수문자 → 따옴표 처리 (sqlite/postgres)", async () => {
    const r = await exec({ action: "select", table: "my-table", dialect: "sqlite" }) as Record<string, unknown>;
    expect(String(r.sql)).toContain('"my-table"');
  });

  it("잘못된 columns JSON → * 폴백", async () => {
    const r = await exec({ action: "select", table: "t", columns: "bad" }) as Record<string, unknown>;
    expect(String(r.sql)).toContain("*");
  });

  it("잘못된 joins JSON → 무시됨", async () => {
    const r = await exec({ action: "select", table: "t", joins: "bad json" }) as Record<string, unknown>;
    expect(String(r.sql)).not.toContain("JOIN");
  });
});

describe("SqlBuilderTool — update 추가 브랜치", () => {
  it("잘못된 values JSON → Error", async () => {
    const r = await exec({ action: "update", table: "t", values: "bad" });
    expect(String(r)).toContain("Error");
  });
});

describe("SqlBuilderTool — insert 추가 브랜치", () => {
  it("잘못된 values JSON → Error", async () => {
    const r = await exec({ action: "insert", table: "t", values: "bad" });
    expect(String(r)).toContain("Error");
  });
});

describe("SqlBuilderTool — unknown action", () => {
  it("지원하지 않는 action → Error", async () => {
    const r = await exec({ action: "bogus_action" });
    expect(String(r)).toContain("Error");
  });
});
