/** SQLite datasource 쿼리 서비스. 워크플로우 노드에서 DB 조회/조작 지원. */

import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { with_sqlite } from "../utils/sqlite-helper.js";
import { create_logger } from "../logger.js";

const log = create_logger("query-db");

/** 허용된 datasource 이름 → DB 파일 경로 매핑. */
export function create_query_db_service(data_dir: string) {
  const db_dir = join(data_dir, "datasources");
  mkdirSync(db_dir, { recursive: true });

  function resolve_db_path(datasource: string): string {
    // 경로 탈출 방지: 영숫자/하이픈/언더스코어만 허용
    const safe = datasource.replace(/[^a-zA-Z0-9_-]/g, "_");
    return join(db_dir, `${safe}.db`);
  }

  return async (
    datasource: string,
    query: string,
    params?: Record<string, unknown>,
  ): Promise<{ rows: unknown[]; affected_rows: number }> => {
    if (!datasource) throw new Error("datasource is required");
    if (!query.trim()) throw new Error("query is required");

    const db_path = resolve_db_path(datasource);

    // SELECT vs DML 판별
    const trimmed = query.trim().toUpperCase();
    const is_select = trimmed.startsWith("SELECT") || trimmed.startsWith("PRAGMA") || trimmed.startsWith("EXPLAIN");

    const result = with_sqlite(db_path, (db) => {
      db.pragma("journal_mode=WAL");

      if (is_select) {
        const stmt = db.prepare(query);
        const rows = params ? stmt.all(params) : stmt.all();
        return { rows: rows as unknown[], affected_rows: 0 };
      }

      // DML: INSERT, UPDATE, DELETE, CREATE TABLE, etc.
      const stmt = db.prepare(query);
      const info = params ? stmt.run(params) : stmt.run();
      return { rows: [], affected_rows: info.changes };
    });

    if (!result) throw new Error(`query_db failed for datasource "${datasource}"`);

    log.info("query", {
      datasource,
      type: is_select ? "select" : "dml",
      rows: result.rows.length,
      affected: result.affected_rows,
    });

    return result;
  };
}
