import { createHash } from "node:crypto";
import { mkdirSync, statSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { with_sqlite, with_sqlite_strict } from "../../utils/sqlite-helper.js";
import type { DynamicToolManifestEntry } from "./dynamic.js";

type ToolRow = {
  name: string;
  description: string;
  enabled: number;
  kind: string;
  parameters_json: string;
  command_template: string;
  working_dir: string | null;
  requires_approval: number;
  updated_at_ms: number;
};

function normalize_entry(row: ToolRow): DynamicToolManifestEntry | null {
  const name = String(row.name || "").trim();
  if (!name) return null;
  const kind = String(row.kind || "").trim().toLowerCase();
  if (kind !== "shell") return null;
  let parameters: DynamicToolManifestEntry["parameters"] = { type: "object" };
  try {
    const parsed = JSON.parse(String(row.parameters_json || "{}")) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      parameters = parsed as DynamicToolManifestEntry["parameters"];
    }
  } catch {
    parameters = { type: "object" };
  }
  return {
    name,
    description: String(row.description || "").trim() || name,
    enabled: Number(row.enabled || 0) !== 0,
    kind: "shell",
    parameters,
    command_template: String(row.command_template || ""),
    working_dir: row.working_dir ? String(row.working_dir) : undefined,
    requires_approval: Number(row.requires_approval || 0) !== 0,
  };
}

export interface DynamicToolStoreLike {
  get_path(): string;
  list_tools(): DynamicToolManifestEntry[];
  upsert_tool(entry: DynamicToolManifestEntry): boolean;
  remove_tool(name: string): boolean;
  signature(): string;
}

export class SqliteDynamicToolStore implements DynamicToolStoreLike {
  readonly sqlite_path: string;

  constructor(workspace: string, sqlite_path_override?: string) {
    this.sqlite_path = resolve(String(sqlite_path_override || join(workspace, "runtime", "custom-tools", "tools.db")));
    mkdirSync(dirname(this.sqlite_path), { recursive: true });
    this.remove_if_empty();
    this.ensure_initialized();
  }

  /** 0바이트 파일이 남아있으면 삭제 — 이전 초기화 실패의 잔해. */
  private remove_if_empty(): void {
    try {
      const stat = statSync(this.sqlite_path);
      if (stat.size === 0) unlinkSync(this.sqlite_path);
    } catch { /* 파일 없음 — 정상 */ }
  }

  get_path(): string {
    return this.sqlite_path;
  }

  private ensure_initialized(): void {
    with_sqlite_strict(this.sqlite_path, (db) => {
      db.exec(`
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS dynamic_tools (
          name TEXT PRIMARY KEY,
          description TEXT NOT NULL,
          enabled INTEGER NOT NULL,
          kind TEXT NOT NULL,
          parameters_json TEXT NOT NULL,
          command_template TEXT NOT NULL,
          working_dir TEXT,
          requires_approval INTEGER NOT NULL,
          updated_at_ms INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_dynamic_tools_updated_at
          ON dynamic_tools(updated_at_ms DESC);
      `);
      return true;
    });
  }

  list_tools(): DynamicToolManifestEntry[] {
    const rows = with_sqlite(this.sqlite_path,(db) => db.prepare(`
      SELECT name, description, enabled, kind, parameters_json, command_template, working_dir, requires_approval, updated_at_ms
      FROM dynamic_tools
      ORDER BY name ASC
    `).all() as ToolRow[]) || [];
    const out: DynamicToolManifestEntry[] = [];
    for (const row of rows) {
      const normalized = normalize_entry(row);
      if (normalized) out.push(normalized);
    }
    return out;
  }

  upsert_tool(entry: DynamicToolManifestEntry): boolean {
    const name = String(entry.name || "").trim();
    if (!name) return false;
    return with_sqlite_strict(this.sqlite_path,(db) => {
      const now = Date.now();
      const result = db.prepare(`
        INSERT INTO dynamic_tools (
          name, description, enabled, kind, parameters_json, command_template, working_dir, requires_approval, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET
          description = excluded.description,
          enabled = excluded.enabled,
          kind = excluded.kind,
          parameters_json = excluded.parameters_json,
          command_template = excluded.command_template,
          working_dir = excluded.working_dir,
          requires_approval = excluded.requires_approval,
          updated_at_ms = excluded.updated_at_ms
      `).run(
        name,
        String(entry.description || "").trim() || name,
        entry.enabled !== false ? 1 : 0,
        "shell",
        JSON.stringify(entry.parameters || { type: "object" }),
        String(entry.command_template || ""),
        entry.working_dir ? String(entry.working_dir) : null,
        entry.requires_approval === true ? 1 : 0,
        now,
      );
      return Number(result.changes || 0) > 0;
    });
  }

  remove_tool(name_raw: string): boolean {
    const name = String(name_raw || "").trim();
    if (!name) return false;
    return with_sqlite_strict(this.sqlite_path,(db) => {
      const result = db.prepare("DELETE FROM dynamic_tools WHERE name = ?").run(name);
      return Number(result.changes || 0) > 0;
    });
  }

  signature(): string {
    const rows = this.list_tools();
    const payload = JSON.stringify(rows);
    const hash = createHash("sha1").update(payload).digest("hex");
    return `${rows.length}:${hash}`;
  }
}

