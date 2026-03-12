/**
 * TeamStore — tenants/<team_id>/team.db 관리.
 * Team, Membership, TeamProvider, TeamPolicy 테이블을 담당.
 */

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { with_sqlite, with_sqlite_strict } from "../utils/sqlite-helper.js";

const PRAGMAS = ["journal_mode=WAL"];

const INIT_SQL = `
  PRAGMA journal_mode=WAL;

  CREATE TABLE IF NOT EXISTS teams (
    id          TEXT PRIMARY KEY,
    slug        TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    disabled_at TEXT
  );

  CREATE TABLE IF NOT EXISTS memberships (
    team_id   TEXT NOT NULL,
    user_id   TEXT NOT NULL,
    role      TEXT NOT NULL DEFAULT 'member',
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
    api_key_ref TEXT NOT NULL,
    enabled     INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS team_policies (
    key        TEXT PRIMARY KEY,
    value_json TEXT NOT NULL
  );
`;

export interface TeamRecord {
  id: string;
  slug: string;
  name: string;
  created_at: string;
  disabled_at: string | null;
}

export interface MembershipRecord {
  team_id: string;
  user_id: string;
  role: "owner" | "manager" | "member" | "viewer";
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

interface TeamRow {
  id: string; slug: string; name: string; created_at: string; disabled_at: string | null;
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

function row_to_team(r: TeamRow): TeamRecord {
  return { ...r };
}

function row_to_membership(r: MembershipRow): MembershipRecord {
  return { ...r, role: r.role as MembershipRecord["role"] };
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

  constructor(db_path: string) {
    this.db_path = db_path;
    mkdirSync(dirname(db_path), { recursive: true });
    with_sqlite_strict(db_path, (db) => { db.exec(INIT_SQL); return true; }, { pragmas: PRAGMAS });
  }

  // ── 팀 ──

  list_teams(): TeamRecord[] {
    return with_sqlite(this.db_path, (db) =>
      (db.prepare("SELECT * FROM teams ORDER BY created_at").all() as TeamRow[]).map(row_to_team),
    { pragmas: PRAGMAS }) ?? [];
  }

  get_team(id: string): TeamRecord | null {
    return with_sqlite(this.db_path, (db) => {
      const row = db.prepare("SELECT * FROM teams WHERE id = ?").get(id) as TeamRow | undefined;
      return row ? row_to_team(row) : null;
    }, { pragmas: PRAGMAS }) ?? null;
  }

  get_team_by_slug(slug: string): TeamRecord | null {
    return with_sqlite(this.db_path, (db) => {
      const row = db.prepare("SELECT * FROM teams WHERE slug = ?").get(slug) as TeamRow | undefined;
      return row ? row_to_team(row) : null;
    }, { pragmas: PRAGMAS }) ?? null;
  }

  create_team(input: { slug: string; name: string }): TeamRecord {
    const id = randomUUID();
    with_sqlite_strict(this.db_path, (db) => {
      db.prepare("INSERT INTO teams (id, slug, name) VALUES (?, ?, ?)").run(id, input.slug, input.name);
      return true;
    }, { pragmas: PRAGMAS });
    return this.get_team(id)!;
  }

  update_team(id: string, patch: Partial<Pick<TeamRecord, "name" | "disabled_at">>): boolean {
    if (!this.get_team(id)) return false;
    const fields: string[] = [];
    const values: unknown[] = [];
    if (patch.name !== undefined) { fields.push("name = ?"); values.push(patch.name); }
    if (patch.disabled_at !== undefined) { fields.push("disabled_at = ?"); values.push(patch.disabled_at); }
    if (fields.length === 0) return true;
    values.push(id);
    with_sqlite_strict(this.db_path, (db) => {
      db.prepare(`UPDATE teams SET ${fields.join(", ")} WHERE id = ?`).run(...values);
      return true;
    }, { pragmas: PRAGMAS });
    return true;
  }

  delete_team(id: string): boolean {
    return with_sqlite_strict(this.db_path, (db) => {
      const r = db.prepare("DELETE FROM teams WHERE id = ?").run(id);
      return r.changes > 0;
    }, { pragmas: PRAGMAS });
  }

  // ── 멤버십 ──

  list_members(team_id: string): MembershipRecord[] {
    return with_sqlite(this.db_path, (db) =>
      (db.prepare("SELECT * FROM memberships WHERE team_id = ? ORDER BY joined_at").all(team_id) as MembershipRow[]).map(row_to_membership),
    { pragmas: PRAGMAS }) ?? [];
  }

  get_membership(team_id: string, user_id: string): MembershipRecord | null {
    return with_sqlite(this.db_path, (db) => {
      const row = db.prepare("SELECT * FROM memberships WHERE team_id = ? AND user_id = ?").get(team_id, user_id) as MembershipRow | undefined;
      return row ? row_to_membership(row) : null;
    }, { pragmas: PRAGMAS }) ?? null;
  }

  add_member(input: { team_id: string; user_id: string; role: MembershipRecord["role"] }): MembershipRecord {
    with_sqlite_strict(this.db_path, (db) => {
      db.prepare(
        "INSERT INTO memberships (team_id, user_id, role) VALUES (?, ?, ?)"
      ).run(input.team_id, input.user_id, input.role);
      return true;
    }, { pragmas: PRAGMAS });
    return this.get_membership(input.team_id, input.user_id)!;
  }

  update_member_role(team_id: string, user_id: string, role: MembershipRecord["role"]): boolean {
    return with_sqlite_strict(this.db_path, (db) => {
      const r = db.prepare("UPDATE memberships SET role = ? WHERE team_id = ? AND user_id = ?").run(role, team_id, user_id);
      return r.changes > 0;
    }, { pragmas: PRAGMAS });
  }

  remove_member(team_id: string, user_id: string): boolean {
    return with_sqlite_strict(this.db_path, (db) => {
      const r = db.prepare("DELETE FROM memberships WHERE team_id = ? AND user_id = ?").run(team_id, user_id);
      return r.changes > 0;
    }, { pragmas: PRAGMAS });
  }

  // ── 팀 프로바이더 ──

  list_team_providers(team_id: string, enabled_only = false): TeamProviderRecord[] {
    return with_sqlite(this.db_path, (db) => {
      const sql = enabled_only
        ? "SELECT * FROM team_providers WHERE team_id = ? AND enabled = 1 ORDER BY created_at"
        : "SELECT * FROM team_providers WHERE team_id = ? ORDER BY created_at";
      return (db.prepare(sql).all(team_id) as TeamProviderRow[]).map(row_to_team_provider);
    }, { pragmas: PRAGMAS }) ?? [];
  }

  get_team_provider(id: string): TeamProviderRecord | null {
    return with_sqlite(this.db_path, (db) => {
      const row = db.prepare("SELECT * FROM team_providers WHERE id = ?").get(id) as TeamProviderRow | undefined;
      return row ? row_to_team_provider(row) : null;
    }, { pragmas: PRAGMAS }) ?? null;
  }

  create_team_provider(input: Omit<TeamProviderRecord, "id" | "created_at">): TeamProviderRecord {
    const id = randomUUID();
    with_sqlite_strict(this.db_path, (db) => {
      db.prepare(
        "INSERT INTO team_providers (id, team_id, name, type, model, config_json, api_key_ref, enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(id, input.team_id, input.name, input.type, input.model, JSON.stringify(input.config), input.api_key_ref, input.enabled ? 1 : 0);
      return true;
    }, { pragmas: PRAGMAS });
    return this.get_team_provider(id)!;
  }

  update_team_provider(id: string, patch: Partial<Pick<TeamProviderRecord, "name" | "model" | "config" | "enabled">>): boolean {
    if (!this.get_team_provider(id)) return false;
    const fields: string[] = [];
    const values: unknown[] = [];
    if (patch.name !== undefined) { fields.push("name = ?"); values.push(patch.name); }
    if (patch.model !== undefined) { fields.push("model = ?"); values.push(patch.model); }
    if (patch.config !== undefined) { fields.push("config_json = ?"); values.push(JSON.stringify(patch.config)); }
    if (patch.enabled !== undefined) { fields.push("enabled = ?"); values.push(patch.enabled ? 1 : 0); }
    if (fields.length === 0) return true;
    values.push(id);
    with_sqlite_strict(this.db_path, (db) => {
      db.prepare(`UPDATE team_providers SET ${fields.join(", ")} WHERE id = ?`).run(...values);
      return true;
    }, { pragmas: PRAGMAS });
    return true;
  }

  delete_team_provider(id: string): boolean {
    return with_sqlite_strict(this.db_path, (db) => {
      const r = db.prepare("DELETE FROM team_providers WHERE id = ?").run(id);
      return r.changes > 0;
    }, { pragmas: PRAGMAS });
  }

  // ── 팀 정책 ──

  get_policy(key: string): unknown | null {
    return with_sqlite(this.db_path, (db) => {
      const row = db.prepare("SELECT value_json FROM team_policies WHERE key = ?").get(key) as TeamPolicyRow | undefined;
      return row ? JSON.parse(row.value_json) as unknown : null;
    }, { pragmas: PRAGMAS }) ?? null;
  }

  set_policy(key: string, value: unknown): void {
    with_sqlite_strict(this.db_path, (db) => {
      db.prepare(
        "INSERT INTO team_policies (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json"
      ).run(key, JSON.stringify(value));
      return true;
    }, { pragmas: PRAGMAS });
  }

  delete_policy(key: string): boolean {
    return with_sqlite_strict(this.db_path, (db) => {
      const r = db.prepare("DELETE FROM team_policies WHERE key = ?").run(key);
      return r.changes > 0;
    }, { pragmas: PRAGMAS });
  }
}
