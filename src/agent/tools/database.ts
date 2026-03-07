/** Database 도구 — SQLite 데이터소스 쿼리 실행 + 스키마 조회. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";
import { error_message } from "../../utils/common.js";
import { with_sqlite } from "../../utils/sqlite-helper.js";
import { join } from "node:path";
import { existsSync } from "node:fs";

const MAX_ROWS = 1000;
const SAFE_NAME = /^[a-zA-Z0-9_-]+$/;

export class DatabaseTool extends Tool {
  readonly name = "database";
  readonly category = "memory" as const;
  readonly policy_flags = { write: true } as const;
  readonly description = "Execute SQL queries against SQLite datasources. Supports SELECT, schema inspection, and DML with write policy.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      operation: {
        type: "string",
        enum: ["query", "tables", "schema", "explain"],
        description: "query: run SQL, tables: list tables, schema: describe table, explain: query plan",
      },
      datasource: { type: "string", description: "Datasource name (alphanumeric + underscore/hyphen)" },
      sql: { type: "string", description: "SQL query (for query/explain)" },
      table: { type: "string", description: "Table name (for schema)" },
      max_rows: { type: "integer", minimum: 1, maximum: 1000, description: "Max rows to return (default 100)" },
    },
    required: ["operation", "datasource"],
    additionalProperties: false,
  };

  private readonly data_dir: string;
  constructor(opts: { workspace: string }) {
    super();
    this.data_dir = join(opts.workspace, "runtime", "datasources");
  }

  protected async run(params: Record<string, unknown>): Promise<string> {
    const op = String(params.operation || "query");
    const datasource = String(params.datasource || "").trim();

    if (!datasource) return "Error: datasource is required";
    if (!SAFE_NAME.test(datasource)) return "Error: datasource name must be alphanumeric (with _ or -)";

    const db_path = join(this.data_dir, `${datasource}.db`);
    if (!existsSync(db_path)) return `Error: datasource "${datasource}" not found at ${db_path}`;

    try {
      const max_rows = Math.min(MAX_ROWS, Math.max(1, Number(params.max_rows || 100)));

      switch (op) {
        case "query": {
          const sql = String(params.sql || "").trim();
          if (!sql) return "Error: sql is required";
          const result = with_sqlite(db_path, (db) => {
            const is_select = /^\s*(SELECT|PRAGMA|EXPLAIN|WITH)\b/i.test(sql);
            if (is_select) {
              const rows = db.prepare(sql).all();
              const limited = rows.slice(0, max_rows);
              return JSON.stringify({ rows: limited, total: rows.length, truncated: rows.length > max_rows }, null, 2);
            }
            const r = db.prepare(sql).run();
            return JSON.stringify({ affected_rows: r.changes, last_id: r.lastInsertRowid }, null, 2);
          });
          return result ?? "Error: database operation failed";
        }

        case "tables": {
          const result = with_sqlite(db_path, (db) => {
            const rows = db.prepare("SELECT name, type FROM sqlite_master WHERE type IN ('table','view') ORDER BY name").all();
            return JSON.stringify({ datasource, tables: rows }, null, 2);
          });
          return result ?? "Error: failed to list tables";
        }

        case "schema": {
          const table = String(params.table || "").trim();
          if (!table) return "Error: table name is required";
          if (!SAFE_NAME.test(table)) return "Error: invalid table name";
          const result = with_sqlite(db_path, (db) => {
            const cols = db.prepare(`PRAGMA table_info("${table}")`).all();
            const indexes = db.prepare(`PRAGMA index_list("${table}")`).all();
            return JSON.stringify({ table, columns: cols, indexes }, null, 2);
          });
          return result ?? "Error: failed to get schema";
        }

        case "explain": {
          const sql = String(params.sql || "").trim();
          if (!sql) return "Error: sql is required";
          const result = with_sqlite(db_path, (db) => {
            const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all();
            return JSON.stringify({ query: sql, plan }, null, 2);
          });
          return result ?? "Error: failed to explain query";
        }

        default:
          return `Error: unsupported operation "${op}"`;
      }
    } catch (err) {
      return `Error: ${error_message(err)}`;
    }
  }
}
