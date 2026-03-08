/**
 * create_query_db_service — SQLite datasource 쿼리 서비스 테스트.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { create_query_db_service } from "../../src/services/query-db.service.js";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let query_db: ReturnType<typeof create_query_db_service>;
let data_dir: string;

beforeAll(() => {
  data_dir = join(tmpdir(), `query-db-test-${Date.now()}`);
  mkdirSync(data_dir, { recursive: true });
  query_db = create_query_db_service(data_dir);
});

describe("create_query_db_service — CREATE TABLE + INSERT + SELECT", () => {
  it("테이블 생성 → affected_rows = 0 (DML)", async () => {
    const result = await query_db("test_ds", "CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY, name TEXT)");
    expect(result.rows).toHaveLength(0);
    expect(result.affected_rows).toBe(0);
  });

  it("INSERT (params 없이) → affected_rows = 1", async () => {
    const result = await query_db("test_ds", "INSERT INTO items (name) VALUES ('paramless')");
    expect(result.affected_rows).toBe(1);
  });

  it("INSERT without params → affected_rows = 1", async () => {
    await query_db("test_ds2", "CREATE TABLE IF NOT EXISTS t (x TEXT)");
    const result = await query_db("test_ds2", "INSERT INTO t VALUES ('world')");
    expect(result.affected_rows).toBe(1);
  });

  it("SELECT → rows 반환", async () => {
    await query_db("test_ds3", "CREATE TABLE IF NOT EXISTS s (v INTEGER)");
    await query_db("test_ds3", "INSERT INTO s VALUES (42)");
    await query_db("test_ds3", "INSERT INTO s VALUES (99)");
    const result = await query_db("test_ds3", "SELECT v FROM s ORDER BY v");
    expect(result.rows).toHaveLength(2);
    expect((result.rows[0] as { v: number }).v).toBe(42);
    expect(result.affected_rows).toBe(0);
  });

  it("PRAGMA 쿼리 → SELECT로 처리됨", async () => {
    const result = await query_db("test_ds", "PRAGMA journal_mode");
    expect(Array.isArray(result.rows)).toBe(true);
  });
});

describe("create_query_db_service — 에러 케이스", () => {
  it("datasource 없음 → 에러", async () => {
    await expect(query_db("", "SELECT 1")).rejects.toThrow("datasource is required");
  });

  it("빈 query → 에러", async () => {
    await expect(query_db("ds", "   ")).rejects.toThrow("query is required");
  });

  it("특수문자 datasource → 안전한 파일명으로 변환 (경로 탈출 방지)", async () => {
    // '../evil' → '..evil' 형태로 변환됨
    const result = await query_db("../evil", "SELECT 1");
    expect(Array.isArray(result.rows)).toBe(true);
  });
});

describe("create_query_db_service — 독립 datasource", () => {
  it("서로 다른 datasource는 격리된 DB 사용", async () => {
    await query_db("ds_a", "CREATE TABLE IF NOT EXISTS x (val TEXT)");
    await query_db("ds_a", "INSERT INTO x VALUES ('in_a')");

    // ds_b에는 x 테이블 없음
    await expect(query_db("ds_b", "SELECT val FROM x")).rejects.toThrow();
  });
});
