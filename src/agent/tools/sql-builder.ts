/** SQL Builder 도구 — SQL 쿼리 빌드/검증/파라미터 바인딩. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

export class SqlBuilderTool extends Tool {
  readonly name = "sql_builder";
  readonly category = "data" as const;
  readonly description = "SQL query builder: select, insert, update, delete, create_table, validate, parameterize.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["select", "insert", "update", "delete", "create_table", "validate", "parameterize"], description: "SQL operation" },
      table: { type: "string", description: "Table name" },
      columns: { type: "string", description: "JSON array of column names or column definitions" },
      where: { type: "string", description: "JSON object of where conditions {col: value}" },
      values: { type: "string", description: "JSON object of column:value pairs (insert/update)" },
      order_by: { type: "string", description: "ORDER BY clause (e.g. 'name ASC')" },
      limit: { type: "integer", description: "LIMIT value" },
      offset: { type: "integer", description: "OFFSET value" },
      joins: { type: "string", description: "JSON array of join specs [{type, table, on}]" },
      group_by: { type: "string", description: "GROUP BY columns (comma-separated)" },
      sql: { type: "string", description: "Raw SQL for validate/parameterize" },
      dialect: { type: "string", enum: ["sqlite", "postgres", "mysql"], description: "SQL dialect (default: sqlite)" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "select");
    const table = String(params.table || "");
    const dialect = String(params.dialect || "sqlite");

    switch (action) {
      case "select": {
        if (!table) return "Error: table is required";
        let cols: string[];
        try { cols = params.columns ? JSON.parse(String(params.columns)) : ["*"]; } catch { cols = ["*"]; }
        const parts: string[] = [`SELECT ${cols.join(", ")} FROM ${this.quote_id(table, dialect)}`];
        if (params.joins) {
          try {
            const joins: { type?: string; table: string; on: string }[] = JSON.parse(String(params.joins));
            for (const j of joins) parts.push(`${(j.type || "INNER").toUpperCase()} JOIN ${this.quote_id(j.table, dialect)} ON ${j.on}`);
          } catch { /* ignore */ }
        }
        const { clause, bind_params } = this.build_where(params.where, dialect);
        if (clause) parts.push(clause);
        if (params.group_by) parts.push(`GROUP BY ${params.group_by}`);
        if (params.order_by) parts.push(`ORDER BY ${params.order_by}`);
        if (params.limit) parts.push(`LIMIT ${Number(params.limit)}`);
        if (params.offset) parts.push(`OFFSET ${Number(params.offset)}`);
        return JSON.stringify({ sql: parts.join(" "), params: bind_params });
      }
      case "insert": {
        if (!table) return "Error: table is required";
        let values: Record<string, unknown>;
        try { values = JSON.parse(String(params.values || "{}")); } catch { return "Error: values must be valid JSON"; }
        const keys = Object.keys(values);
        const placeholders = keys.map((_, i) => this.placeholder(i + 1, dialect));
        const sql = `INSERT INTO ${this.quote_id(table, dialect)} (${keys.join(", ")}) VALUES (${placeholders.join(", ")})`;
        return JSON.stringify({ sql, params: Object.values(values) });
      }
      case "update": {
        if (!table) return "Error: table is required";
        let values: Record<string, unknown>;
        try { values = JSON.parse(String(params.values || "{}")); } catch { return "Error: values must be valid JSON"; }
        const keys = Object.keys(values);
        let idx = 1;
        const sets = keys.map((k) => `${k} = ${this.placeholder(idx++, dialect)}`);
        const bind: unknown[] = Object.values(values);
        const { clause, bind_params } = this.build_where(params.where, dialect, idx);
        bind.push(...bind_params);
        const sql = `UPDATE ${this.quote_id(table, dialect)} SET ${sets.join(", ")}${clause ? ` ${clause}` : ""}`;
        return JSON.stringify({ sql, params: bind });
      }
      case "delete": {
        if (!table) return "Error: table is required";
        const { clause, bind_params } = this.build_where(params.where, dialect);
        if (!clause) return "Error: WHERE clause required for DELETE (safety)";
        const sql = `DELETE FROM ${this.quote_id(table, dialect)} ${clause}`;
        return JSON.stringify({ sql, params: bind_params });
      }
      case "create_table": {
        if (!table) return "Error: table is required";
        let columns: { name: string; type: string; primary_key?: boolean; not_null?: boolean; default?: string }[];
        try { columns = JSON.parse(String(params.columns || "[]")); } catch { return "Error: columns must be valid JSON array"; }
        const col_defs = columns.map((c) => {
          let def = `${c.name} ${c.type}`;
          if (c.primary_key) def += " PRIMARY KEY";
          if (c.not_null) def += " NOT NULL";
          if (c.default !== undefined) def += ` DEFAULT ${c.default}`;
          return def;
        });
        const sql = `CREATE TABLE IF NOT EXISTS ${this.quote_id(table, dialect)} (\n  ${col_defs.join(",\n  ")}\n)`;
        return JSON.stringify({ sql });
      }
      case "validate": {
        const sql = String(params.sql || "");
        const issues: string[] = [];
        if (!sql.trim()) issues.push("empty SQL");
        if (/;\s*\S/.test(sql)) issues.push("multiple statements detected");
        if (/--/.test(sql) || /\/\*/.test(sql)) issues.push("comment detected");
        const dangerous = ["DROP TABLE", "DROP DATABASE", "TRUNCATE", "ALTER TABLE"];
        for (const d of dangerous) {
          if (sql.toUpperCase().includes(d)) issues.push(`dangerous operation: ${d}`);
        }
        return JSON.stringify({ valid: issues.length === 0, issues });
      }
      case "parameterize": {
        const sql = String(params.sql || "");
        const extracted: string[] = [];
        const parameterized = sql.replace(/'([^']*?)'/g, (_, val: string) => {
          extracted.push(val);
          return this.placeholder(extracted.length, dialect);
        });
        return JSON.stringify({ sql: parameterized, params: extracted, count: extracted.length });
      }
      default:
        return `Error: unsupported action "${action}"`;
    }
  }

  private build_where(where_str: unknown, dialect: string, start_idx = 1): { clause: string; bind_params: unknown[] } {
    if (!where_str) return { clause: "", bind_params: [] };
    let where: Record<string, unknown>;
    try { where = JSON.parse(String(where_str)); } catch { return { clause: "", bind_params: [] }; }
    const conditions: string[] = [];
    const bind: unknown[] = [];
    let idx = start_idx;
    for (const [key, value] of Object.entries(where)) {
      if (value === null) { conditions.push(`${key} IS NULL`); }
      else { conditions.push(`${key} = ${this.placeholder(idx++, dialect)}`); bind.push(value); }
    }
    return { clause: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", bind_params: bind };
  }

  private placeholder(idx: number, dialect: string): string {
    if (dialect === "postgres") return `$${idx}`;
    return "?";
  }

  private quote_id(name: string, dialect: string): string {
    if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) return name;
    if (dialect === "mysql") return `\`${name}\``;
    return `"${name}"`;
  }
}
