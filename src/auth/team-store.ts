/**
 * TeamStore — 팀별 team.db 관리.
 * memberships(멤버·역할), team_providers(팀 공용 프로바이더), team_policies(팀 정책) 담당.
 * 파일 위치: tenants/<team_id>/team.db
 */

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { with_sqlite, with_sqlite_strict } from "../utils/sqlite-helper.js";

const PRAGMAS = ["journal_mode=WAL"];

const INIT_SQL = `
  PRAGMA journal_mode=WAL;

  CREATE TABLE IF NOT EXISTS memberships (
    team_id   TEXT NOT NULL,
    user_id   TEXT NOT NULL,
    role      TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('owner','manager','member','viewer')),
    joined_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (team_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS team_providers (
    id          TEXT PRIMARY KEY,
    team_id     TEXT NOT NULL,
    name        TEXT NOT NULL,
    type        TEXT NOT NULL,
    model       TEXT NOT NULL DEFAULT '',
    config_json TEXT NOT NULL DEFAULT '{}',
    api_key_ref TEXT NOT NULL DEFAULT '',
    enabled     INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS team_policies (
    key        TEXT PRIMARY KEY,
    value_json TEXT NOT NULL
  );
`;

export type TeamRole = "owner" | "manager" | "member" | "viewer";

export interface MembershipRecord {
  team_id: string;
  user_id: string;
  role: TeamRole;
  joined_at: string;
}

export interface TeamProviderRecord {
  id: string;
  team_id: string;
  name: string;
  type: string;
  model: string;
  config: Record<string, unknown>;
  api_key_ref: string;
  enabled: boolean;
  created_at: string;
}

export interface TeamPolicyRecord {
  key: string;
  value: unknown;
}

interface MembershipRow {
  team_id: string; user_id: string; role: string; joined_at: string;
}

interface TeamProviderRow {
  id: string; team_id: string; name: string; type: string; model: string;
  config_json: string; api_key_ref: string; enabled: number; created_at: string;
}

interface TeamPolicyRow {
  key: string; value_json: string;
}

function row_to_membership(r: MembershipRow): MembershipRecord {
  return { ...r, role: r.role as TeamRole };
}

function row_to_team_provider(r: TeamProviderRow): TeamProviderRecord {
  return {
    id: r.id, team_id: r.team_id, name: r.name, type: r.type, model: r.model,
    config: JSON.parse(r.config_json) as Record<string, unknown>,
    api_key_ref: r.api_key_ref, enabled: r.enabled === 1, created_at: r.created_at,
  };
}

export class TeamStore {
  private readonly db_path: string;
  readonly team_id: string;

  constructor(db_path: string, team_id: string) {
    this.db_path = db_path;
    this.team_id = team_id;
    mkdirSync(dirname(db_path), { recursive: true });
    with_sqlite_strict(db_path, (db) => { db.exec(INIT_SQL); return true; }, { pragmas: PRAGMAS });
  }

  // ── 멤버십 ──

  list_members(): MembershipRecord[] {
    return with_sqlite(this.db_path, (db) => {
      return (db.prepare("SELECT * FROM memberships WHERE team_id = ? ORDER BY joined_at").all(this.team_id) as MembershipRow[]).map(row_to_membership);
    }, { pragmas: PRAGMAS }) ?? [];
  }

  get_membership(user_id: string): MembershipRecord | null {
    return with_sqlite(this.db_path, (db) => {
      const row = db.prepare("SELECT * FROM memberships WHERE team_id = ? AND user_id = ?").get(this.team_id, user_id) as MembershipRow | undefined;
      return row ? row_to_membership(row) : null;
    }, { pragmas: PRAGMAS }) ?? null;
  }

  upsert_member(user_id: string, role: TeamRole): MembershipRecord {
    with_sqlite_strict(this.db_path, (db) => {
      db.prepare(
        "INSERT INTO memberships (team_id, user_id, role) VALUES (?, ?, ?) ON CONFLICT(team_id, user_id) DO UPDATE SET role = excluded.role"
      ).run(this.team_id, user_id, role);
      return true;
    }, { pragmas: PRAGMAS });
    return this.get_membership(user_id)!;
  }

  remove_member(user_id: string): boolean {
    return with_sqlite_strict(this.db_path, (db) => {
      const r = db.prepare("DELETE FROM memberships WHERE team_id = ? AND user_id = ?").run(this.team_id, user_id);
      return r.changes > 0;
    }, { pragmas: PRAGMAS });
  }

  // ── 팀 프로바이더 ──

  list_providers(enabled_only = false): TeamProviderRecord[] {
    return with_sqlite(this.db_path, (db) => {
      const sql = enabled_only
        ? "SELECT * FROM team_providers WHERE team_id = ? AND enabled = 1 ORDER BY created_at"
        : "SELECT * FROM team_providers WHERE team_id = ? ORDER BY created_at";
      return (db.prepare(sql).all(this.team_id) as TeamProviderRow[]).map(row_to_team_provider);
    }, { pragmas: PRAGMAS }) ?? [];
  }

  get_provider(id: string): TeamProviderRecord | null {
    return with_sqlite(this.db_path, (db) => {
      const row = db.prepare("SELECT * FROM team_providers WHERE id = ? AND team_id = ?").get(id, this.team_id) as TeamProviderRow | undefined;
      return row ? row_to_team_provider(row) : null;
    }, { pragmas: PRAGMAS }) ?? null;
  }

  create_provider(input: Omit<TeamProviderRecord, "id" | "created_at" | "team_id">): TeamProviderRecord {
    const id = randomUUID();
    with_sqlite_strict(this.db_path, (db) => {
      db.prepare(
        "INSERT INTO team_providers (id, team_id, name, type, model, config_json, api_key_ref, enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(id, this.team_id, input.name, input.type, input.model, JSON.stringify(input.config), input.api_key_ref, input.enabled ? 1 : 0);
      return true;
    }, { pragmas: PRAGMAS });
    return this.get_provider(id)!;
  }

  update_provider(id: string, patch: Partial<Pick<TeamProviderRecord, "name" | "model" | "config" | "enabled" | "api_key_ref">>): boolean {
    if (!this.get_provider(id)) return false;
    const fields: string[] = [];
    const values: unknown[] = [];
    if (patch.name !== undefined) { fields.push("name = ?"); values.push(patch.name); }
    if (patch.model !== undefined) { fields.push("model = ?"); values.push(patch.model); }
    if (patch.config !== undefined) { fields.push("config_json = ?"); values.push(JSON.stringify(patch.config)); }
    if (patch.enabled !== undefined) { fields.push("enabled = ?"); values.push(patch.enabled ? 1 : 0); }
    if (patch.api_key_ref !== undefined) { fields.push("api_key_ref = ?"); values.push(patch.api_key_ref); }
    if (fields.length === 0) return true;
    values.push(id, this.team_id);
    with_sqlite_strict(this.db_path, (db) => {
      db.prepare(`UPDATE team_providers SET ${fields.join(", ")} WHERE id = ? AND team_id = ?`).run(...values);
      return true;
    }, { pragmas: PRAGMAS });
    return true;
  }

  delete_provider(id: string): boolean {
    return with_sqlite_strict(this.db_path, (db) => {
      const r = db.prepare("DELETE FROM team_providers WHERE id = ? AND team_id = ?").run(id, this.team_id);
      return r.changes > 0;
    }, { pragmas: PRAGMAS });
  }

  // ── 팀 정책 ──

  get_policy(key: string): unknown | null {
    return with_sqlite(this.db_path, (db) => {
      const row = db.prepare("SELECT value_json FROM team_policies WHERE key = ?").get(key) as TeamPolicyRow | undefined;
      if (!row) return null;
      try { return JSON.parse(row.value_json) as unknown; } catch { return null; }
    }, { pragmas: PRAGMAS }) ?? null;
  }

  set_policy(key: string, value: unknown): void {
    with_sqlite_strict(this.db_path, (db) => {
      db.prepare("INSERT INTO team_policies (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json")
        .run(key, JSON.stringify(value));
      return true;
    }, { pragmas: PRAGMAS });
  }

  list_policies(): TeamPolicyRecord[] {
    return with_sqlite(this.db_path, (db) => {
      return (db.prepare("SELECT * FROM team_policies").all() as TeamPolicyRow[]).map((r) => ({
        key: r.key,
        value: JSON.parse(r.value_json) as unknown,
      }));
    }, { pragmas: PRAGMAS }) ?? [];
  }
}
