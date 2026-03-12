/**
 * AgentDefinitionStore — SQLite 기반 에이전트 정의 영속 저장소.
 * provider-store.ts와 동일한 open-per-call 패턴 사용.
 * is_builtin=true 레코드는 update/delete에서 보호.
 */

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { with_sqlite, with_sqlite_strict } from "../utils/sqlite-helper.js";
import type { AgentDefinition, CreateAgentDefinitionInput, UpdateAgentDefinitionInput } from "./agent-definition.types.js";
import { BUILTIN_AGENT_DEFINITIONS } from "./agent-definition-builtin.js";

const INIT_SQL = `
  PRAGMA journal_mode=WAL;
  CREATE TABLE IF NOT EXISTS agent_definitions (
    id                  TEXT PRIMARY KEY,
    name                TEXT NOT NULL,
    description         TEXT NOT NULL DEFAULT '',
    icon                TEXT NOT NULL DEFAULT '🤖',
    role_skill          TEXT,
    soul                TEXT NOT NULL DEFAULT '',
    heart               TEXT NOT NULL DEFAULT '',
    tools_json          TEXT NOT NULL DEFAULT '[]',
    shared_protocols_json TEXT NOT NULL DEFAULT '[]',
    skills_json         TEXT NOT NULL DEFAULT '[]',
    use_when            TEXT NOT NULL DEFAULT '',
    not_use_for         TEXT NOT NULL DEFAULT '',
    extra_instructions  TEXT NOT NULL DEFAULT '',
    preferred_providers_json TEXT NOT NULL DEFAULT '[]',
    model               TEXT,
    is_builtin          INTEGER NOT NULL DEFAULT 0,
    use_count           INTEGER NOT NULL DEFAULT 0,
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

const PRAGMAS = ["journal_mode=WAL"];

interface DefinitionRow {
  id: string;
  name: string;
  description: string;
  icon: string;
  role_skill: string | null;
  soul: string;
  heart: string;
  tools_json: string;
  shared_protocols_json: string;
  skills_json: string;
  use_when: string;
  not_use_for: string;
  extra_instructions: string;
  preferred_providers_json: string;
  model: string | null;
  is_builtin: number;
  use_count: number;
  created_at: string;
  updated_at: string;
}

function row_to_definition(r: DefinitionRow): AgentDefinition {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    icon: r.icon,
    role_skill: r.role_skill,
    soul: r.soul,
    heart: r.heart,
    tools: JSON.parse(r.tools_json),
    shared_protocols: JSON.parse(r.shared_protocols_json),
    skills: JSON.parse(r.skills_json),
    use_when: r.use_when,
    not_use_for: r.not_use_for,
    extra_instructions: r.extra_instructions,
    preferred_providers: JSON.parse(r.preferred_providers_json),
    model: r.model,
    is_builtin: r.is_builtin === 1,
    use_count: r.use_count,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export class AgentDefinitionStore {
  private readonly db_path: string;

  constructor(db_path: string) {
    this.db_path = db_path;
    mkdirSync(dirname(db_path), { recursive: true });
    this._ensure_initialized();
    this._seed_builtins();
  }

  private _ensure_initialized(): void {
    with_sqlite_strict(this.db_path, (db) => {
      db.exec(INIT_SQL);
      return true;
    }, { pragmas: PRAGMAS });
  }

  /** 빌트인 정의가 없으면 시드. 이름 충돌 시 is_builtin=true인 기존 레코드 갱신. */
  private _seed_builtins(): void {
    with_sqlite_strict(this.db_path, (db) => {
      const stmt = db.prepare(`
        INSERT INTO agent_definitions
          (id, name, description, icon, role_skill, soul, heart,
           tools_json, shared_protocols_json, skills_json,
           use_when, not_use_for, extra_instructions,
           preferred_providers_json, model, is_builtin, use_count,
           created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, datetime('now'), datetime('now'))
        ON CONFLICT(id) DO NOTHING
      `);

      // role_skill 기준으로 기존 빌트인 id 조회해 재사용
      const id_by_role = db.prepare(
        "SELECT id FROM agent_definitions WHERE role_skill = ? AND is_builtin = 1 LIMIT 1",
      );

      for (const def of BUILTIN_AGENT_DEFINITIONS) {
        const existing = def.role_skill
          ? (id_by_role.get(def.role_skill) as { id: string } | undefined)
          : undefined;
        const id = existing?.id ?? `builtin:${def.role_skill ?? def.name.toLowerCase()}`;
        stmt.run(
          id,
          def.name,
          def.description,
          def.icon,
          def.role_skill,
          def.soul,
          def.heart,
          JSON.stringify(def.tools),
          JSON.stringify(def.shared_protocols),
          JSON.stringify(def.skills),
          def.use_when,
          def.not_use_for,
          def.extra_instructions,
          JSON.stringify(def.preferred_providers),
          def.model,
        );
      }
      return true;
    }, { pragmas: PRAGMAS });
  }

  // ── 조회 ──

  list(): AgentDefinition[] {
    return with_sqlite(this.db_path, (db) => {
      const rows = db.prepare(
        "SELECT * FROM agent_definitions ORDER BY is_builtin DESC, use_count DESC, created_at ASC",
      ).all() as DefinitionRow[];
      return rows.map(row_to_definition);
    }, { pragmas: PRAGMAS }) ?? [];
  }

  get(id: string): AgentDefinition | null {
    return with_sqlite(this.db_path, (db) => {
      const row = db.prepare("SELECT * FROM agent_definitions WHERE id = ?").get(id) as DefinitionRow | undefined;
      return row ? row_to_definition(row) : null;
    }, { pragmas: PRAGMAS }) ?? null;
  }

  // ── 쓰기 ──

  create(input: CreateAgentDefinitionInput): AgentDefinition {
    const id = randomUUID();
    with_sqlite_strict(this.db_path, (db) => {
      db.prepare(`
        INSERT INTO agent_definitions
          (id, name, description, icon, role_skill, soul, heart,
           tools_json, shared_protocols_json, skills_json,
           use_when, not_use_for, extra_instructions,
           preferred_providers_json, model, is_builtin, use_count,
           created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, datetime('now'), datetime('now'))
      `).run(
        id,
        input.name,
        input.description,
        input.icon,
        input.role_skill,
        input.soul,
        input.heart,
        JSON.stringify(input.tools),
        JSON.stringify(input.shared_protocols),
        JSON.stringify(input.skills),
        input.use_when,
        input.not_use_for,
        input.extra_instructions,
        JSON.stringify(input.preferred_providers),
        input.model,
        input.is_builtin ? 1 : 0,
      );
      return true;
    }, { pragmas: PRAGMAS });
    return this.get(id)!;
  }

  /** custom 정의만 수정 가능. is_builtin=true 시 false 반환. */
  update(id: string, patch: UpdateAgentDefinitionInput): boolean {
    const existing = this.get(id);
    if (!existing || existing.is_builtin) return false;

    with_sqlite_strict(this.db_path, (db) => {
      db.prepare(`
        UPDATE agent_definitions SET
          name                    = ?,
          description             = ?,
          icon                    = ?,
          role_skill              = ?,
          soul                    = ?,
          heart                   = ?,
          tools_json              = ?,
          shared_protocols_json   = ?,
          skills_json             = ?,
          use_when                = ?,
          not_use_for             = ?,
          extra_instructions      = ?,
          preferred_providers_json = ?,
          model                   = ?,
          updated_at              = datetime('now')
        WHERE id = ?
      `).run(
        patch.name ?? existing.name,
        patch.description ?? existing.description,
        patch.icon ?? existing.icon,
        patch.role_skill !== undefined ? patch.role_skill : existing.role_skill,
        patch.soul ?? existing.soul,
        patch.heart ?? existing.heart,
        JSON.stringify(patch.tools ?? existing.tools),
        JSON.stringify(patch.shared_protocols ?? existing.shared_protocols),
        JSON.stringify(patch.skills ?? existing.skills),
        patch.use_when ?? existing.use_when,
        patch.not_use_for ?? existing.not_use_for,
        patch.extra_instructions ?? existing.extra_instructions,
        JSON.stringify(patch.preferred_providers ?? existing.preferred_providers),
        patch.model !== undefined ? patch.model : existing.model,
        id,
      );
      return true;
    }, { pragmas: PRAGMAS });
    return true;
  }

  /** custom 정의만 삭제 가능. is_builtin=true 시 false 반환. */
  delete(id: string): boolean {
    const existing = this.get(id);
    if (!existing || existing.is_builtin) return false;

    with_sqlite_strict(this.db_path, (db) => {
      db.prepare("DELETE FROM agent_definitions WHERE id = ? AND is_builtin = 0").run(id);
      return true;
    }, { pragmas: PRAGMAS });
    return true;
  }

  /** 빌트인을 복사해 커스텀 정의 생성. */
  fork(id: string): AgentDefinition | null {
    const source = this.get(id);
    if (!source) return null;

    const { is_builtin: _, use_count: __, created_at: ___, updated_at: ____, id: _id, ...fields } = source;
    return this.create({
      ...fields,
      name: `${source.name} (복사본)`,
      is_builtin: false,
    });
  }

  /** 사용 횟수 증가. */
  increment_use_count(id: string): void {
    with_sqlite_strict(this.db_path, (db) => {
      db.prepare("UPDATE agent_definitions SET use_count = use_count + 1 WHERE id = ?").run(id);
      return true;
    }, { pragmas: PRAGMAS });
  }
}
