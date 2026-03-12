/**
 * AdminStore — 전역 admin.db 관리.
 * users 테이블, shared_providers 테이블, settings 테이블(jwt_secret 등)을 담당.
 */

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { with_sqlite, with_sqlite_strict } from "../utils/sqlite-helper.js";

const PRAGMAS = ["journal_mode=WAL"];

const INIT_SQL = `
  PRAGMA journal_mode=WAL;

  CREATE TABLE IF NOT EXISTS teams (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS users (
    id              TEXT PRIMARY KEY,
    username        TEXT NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL,
    system_role     TEXT NOT NULL DEFAULT 'user',
    default_team_id TEXT REFERENCES teams(id),
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    last_login_at   TEXT,
    disabled_at     TEXT
  );

  CREATE TABLE IF NOT EXISTS shared_providers (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    type        TEXT NOT NULL,
    model       TEXT NOT NULL DEFAULT '',
    config_json TEXT NOT NULL DEFAULT '{}',
    api_key_ref TEXT NOT NULL,
    enabled     INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`;

export interface UserRecord {
  id: string;
  username: string;
  password_hash: string;
  system_role: "superadmin" | "user";
  default_team_id: string | null;
  created_at: string;
  last_login_at: string | null;
  disabled_at: string | null;
}

export interface TeamRecord {
  id: string;
  name: string;
  created_at: string;
}

export interface SharedProviderRecord {
  id: string;
  name: string;
  type: string;
  model: string;
  config: Record<string, unknown>;
  api_key_ref: string;
  enabled: boolean;
  created_at: string;
}

interface TeamRow { id: string; name: string; created_at: string; }

interface UserRow {
  id: string; username: string; password_hash: string; system_role: string;
  default_team_id: string | null; created_at: string;
  last_login_at: string | null; disabled_at: string | null;
}

interface SharedProviderRow {
  id: string; name: string; type: string; model: string;
  config_json: string; api_key_ref: string; enabled: number; created_at: string;
}

function row_to_team(r: TeamRow): TeamRecord {
  return { id: r.id, name: r.name, created_at: r.created_at };
}

function row_to_user(r: UserRow): UserRecord {
  return { ...r, system_role: r.system_role as "superadmin" | "user" };
}

function row_to_shared_provider(r: SharedProviderRow): SharedProviderRecord {
  return {
    id: r.id, name: r.name, type: r.type, model: r.model,
    config: JSON.parse(r.config_json) as Record<string, unknown>,
    api_key_ref: r.api_key_ref, enabled: r.enabled === 1, created_at: r.created_at,
  };
}

export class AdminStore {
  private readonly db_path: string;

  constructor(db_path: string) {
    this.db_path = db_path;
    mkdirSync(dirname(db_path), { recursive: true });
    with_sqlite_strict(db_path, (db) => { db.exec(INIT_SQL); return true; }, { pragmas: PRAGMAS });
  }

  // ── 초기화 여부 ──

  is_initialized(): boolean {
    return with_sqlite(this.db_path, (db) => {
      const row = db.prepare("SELECT COUNT(*) as cnt FROM users WHERE system_role = 'superadmin'").get() as { cnt: number };
      return row.cnt > 0;
    }, { pragmas: PRAGMAS }) ?? false;
  }

  // ── 설정 (jwt_secret 등) ──

  get_setting(key: string): string | null {
    return with_sqlite(this.db_path, (db) => {
      const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
      return row?.value ?? null;
    }, { pragmas: PRAGMAS }) ?? null;
  }

  set_setting(key: string, value: string): void {
    with_sqlite_strict(this.db_path, (db) => {
      db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .run(key, value);
      return true;
    }, { pragmas: PRAGMAS });
  }

  // ── 사용자 ──

  list_users(): UserRecord[] {
    return with_sqlite(this.db_path, (db) => {
      return (db.prepare("SELECT * FROM users ORDER BY created_at").all() as UserRow[]).map(row_to_user);
    }, { pragmas: PRAGMAS }) ?? [];
  }

  get_user_by_id(id: string): UserRecord | null {
    return with_sqlite(this.db_path, (db) => {
      const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
      return row ? row_to_user(row) : null;
    }, { pragmas: PRAGMAS }) ?? null;
  }

  get_user_by_username(username: string): UserRecord | null {
    return with_sqlite(this.db_path, (db) => {
      const row = db.prepare("SELECT * FROM users WHERE username = ?").get(username) as UserRow | undefined;
      return row ? row_to_user(row) : null;
    }, { pragmas: PRAGMAS }) ?? null;
  }

  create_user(input: {
    username: string;
    password_hash: string;
    system_role: "superadmin" | "user";
    default_team_id?: string | null;
  }): UserRecord {
    const id = randomUUID();
    with_sqlite_strict(this.db_path, (db) => {
      db.prepare(
        "INSERT INTO users (id, username, password_hash, system_role, default_team_id) VALUES (?, ?, ?, ?, ?)"
      ).run(id, input.username, input.password_hash, input.system_role, input.default_team_id ?? null);
      return true;
    }, { pragmas: PRAGMAS });
    return this.get_user_by_id(id)!;
  }

  update_user(id: string, patch: Partial<Pick<UserRecord, "password_hash" | "system_role" | "last_login_at" | "default_team_id" | "disabled_at">>): boolean {
    const user = this.get_user_by_id(id);
    if (!user) return false;
    const fields: string[] = [];
    const values: unknown[] = [];
    if (patch.password_hash !== undefined) { fields.push("password_hash = ?"); values.push(patch.password_hash); }
    if (patch.system_role !== undefined) { fields.push("system_role = ?"); values.push(patch.system_role); }
    if (patch.last_login_at !== undefined) { fields.push("last_login_at = ?"); values.push(patch.last_login_at); }
    if (patch.default_team_id !== undefined) { fields.push("default_team_id = ?"); values.push(patch.default_team_id); }
    if (patch.disabled_at !== undefined) { fields.push("disabled_at = ?"); values.push(patch.disabled_at); }
    if (fields.length === 0) return true;
    values.push(id);
    with_sqlite_strict(this.db_path, (db) => {
      db.prepare(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`).run(...values);
      return true;
    }, { pragmas: PRAGMAS });
    return true;
  }

  delete_user(id: string): boolean {
    return with_sqlite_strict(this.db_path, (db) => {
      const r = db.prepare("DELETE FROM users WHERE id = ?").run(id);
      return r.changes > 0;
    }, { pragmas: PRAGMAS });
  }

  // ── 팀 ──

  list_teams(): TeamRecord[] {
    return with_sqlite(this.db_path, (db) => {
      return (db.prepare("SELECT * FROM teams ORDER BY created_at").all() as TeamRow[]).map(row_to_team);
    }, { pragmas: PRAGMAS }) ?? [];
  }

  get_team(id: string): TeamRecord | null {
    return with_sqlite(this.db_path, (db) => {
      const row = db.prepare("SELECT * FROM teams WHERE id = ?").get(id) as TeamRow | undefined;
      return row ? row_to_team(row) : null;
    }, { pragmas: PRAGMAS }) ?? null;
  }

  ensure_team(id: string, name: string): TeamRecord {
    with_sqlite_strict(this.db_path, (db) => {
      db.prepare("INSERT INTO teams (id, name) VALUES (?, ?) ON CONFLICT(id) DO NOTHING").run(id, name);
      return true;
    }, { pragmas: PRAGMAS });
    return this.get_team(id)!;
  }

  // ── 공유 프로바이더 ──

  list_shared_providers(enabled_only = false): SharedProviderRecord[] {
    return with_sqlite(this.db_path, (db) => {
      const sql = enabled_only
        ? "SELECT * FROM shared_providers WHERE enabled = 1 ORDER BY created_at"
        : "SELECT * FROM shared_providers ORDER BY created_at";
      return (db.prepare(sql).all() as SharedProviderRow[]).map(row_to_shared_provider);
    }, { pragmas: PRAGMAS }) ?? [];
  }

  get_shared_provider(id: string): SharedProviderRecord | null {
    return with_sqlite(this.db_path, (db) => {
      const row = db.prepare("SELECT * FROM shared_providers WHERE id = ?").get(id) as SharedProviderRow | undefined;
      return row ? row_to_shared_provider(row) : null;
    }, { pragmas: PRAGMAS }) ?? null;
  }

  create_shared_provider(input: Omit<SharedProviderRecord, "id" | "created_at">): SharedProviderRecord {
    const id = randomUUID();
    with_sqlite_strict(this.db_path, (db) => {
      db.prepare(
        "INSERT INTO shared_providers (id, name, type, model, config_json, api_key_ref, enabled) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(id, input.name, input.type, input.model, JSON.stringify(input.config), input.api_key_ref, input.enabled ? 1 : 0);
      return true;
    }, { pragmas: PRAGMAS });
    return this.get_shared_provider(id)!;
  }

  update_shared_provider(id: string, patch: Partial<Pick<SharedProviderRecord, "name" | "model" | "config" | "enabled">>): boolean {
    if (!this.get_shared_provider(id)) return false;
    const fields: string[] = [];
    const values: unknown[] = [];
    if (patch.name !== undefined) { fields.push("name = ?"); values.push(patch.name); }
    if (patch.model !== undefined) { fields.push("model = ?"); values.push(patch.model); }
    if (patch.config !== undefined) { fields.push("config_json = ?"); values.push(JSON.stringify(patch.config)); }
    if (patch.enabled !== undefined) { fields.push("enabled = ?"); values.push(patch.enabled ? 1 : 0); }
    if (fields.length === 0) return true;
    values.push(id);
    with_sqlite_strict(this.db_path, (db) => {
      db.prepare(`UPDATE shared_providers SET ${fields.join(", ")} WHERE id = ?`).run(...values);
      return true;
    }, { pragmas: PRAGMAS });
    return true;
  }

  delete_shared_provider(id: string): boolean {
    return with_sqlite_strict(this.db_path, (db) => {
      const r = db.prepare("DELETE FROM shared_providers WHERE id = ?").run(id);
      return r.changes > 0;
    }, { pragmas: PRAGMAS });
  }
}
