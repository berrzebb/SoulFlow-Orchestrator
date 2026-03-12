/**
 * AgentProviderStore — SQLite 기반 에이전트 프로바이더 인스턴스 영속 저장소.
 * 각 인스턴스의 provider_type, label, enabled, priority, supported_modes, settings 관리.
 * 토큰 등 민감값은 SecretVault에 위임 (키: agent.{instance_id}.apiKey).
 */

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { with_sqlite, with_sqlite_strict } from "../utils/sqlite-helper.js";
import type { SecretVaultLike } from "../security/secret-vault.js";
import type { AgentProviderConfig, CreateAgentProviderInput, ProviderConnection, CreateProviderConnectionInput, ModelPurpose } from "./agent.types.js";
import type { ExecutionMode } from "../orchestration/types.js";

const INIT_SQL = `
  PRAGMA journal_mode=WAL;
  CREATE TABLE IF NOT EXISTS provider_connections (
    connection_id   TEXT PRIMARY KEY,
    provider_type   TEXT NOT NULL,
    label           TEXT NOT NULL DEFAULT '',
    enabled         INTEGER NOT NULL DEFAULT 1,
    api_base        TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS agent_providers (
    instance_id     TEXT PRIMARY KEY,
    provider_type   TEXT NOT NULL,
    label           TEXT NOT NULL DEFAULT '',
    enabled         INTEGER NOT NULL DEFAULT 1,
    priority        INTEGER NOT NULL DEFAULT 100,
    model_purpose   TEXT NOT NULL DEFAULT 'chat' CHECK(model_purpose IN ('chat','embedding')),
    supported_modes TEXT NOT NULL DEFAULT '["once","agent","task"]',
    settings_json   TEXT NOT NULL DEFAULT '{}',
    connection_id   TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

const MIGRATE_MODEL_PURPOSE = `
  ALTER TABLE agent_providers ADD COLUMN model_purpose TEXT NOT NULL DEFAULT 'chat' CHECK(model_purpose IN ('chat','embedding'));
`;

const MIGRATE_CONNECTION_ID = `
  ALTER TABLE agent_providers ADD COLUMN connection_id TEXT;
`;

const PRAGMAS = ["journal_mode=WAL"];

interface ConnectionRow {
  connection_id: string;
  provider_type: string;
  label: string;
  enabled: number;
  api_base: string | null;
  created_at: string;
  updated_at: string;
}

interface ProviderRow {
  instance_id: string;
  provider_type: string;
  label: string;
  enabled: number;
  priority: number;
  model_purpose: string;
  supported_modes: string;
  settings_json: string;
  connection_id: string | null;
  created_at: string;
  updated_at: string;
}

function row_to_connection(r: ConnectionRow): ProviderConnection {
  return {
    connection_id: r.connection_id,
    provider_type: r.provider_type,
    label: r.label,
    enabled: r.enabled === 1,
    api_base: r.api_base || undefined,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function row_to_config(r: ProviderRow): AgentProviderConfig {
  return {
    instance_id: r.instance_id,
    provider_type: r.provider_type,
    label: r.label,
    enabled: r.enabled === 1,
    priority: r.priority,
    model_purpose: (r.model_purpose === "embedding" ? "embedding" : "chat") as ModelPurpose,
    supported_modes: safe_parse_modes(r.supported_modes),
    settings: JSON.parse(r.settings_json),
    connection_id: r.connection_id || undefined,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function safe_parse_modes(raw: string): ExecutionMode[] {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as ExecutionMode[];
  } catch { /* fallback */ }
  return ["once", "agent", "task"];
}

export class AgentProviderStore {
  private readonly db_path: string;
  private readonly vault: SecretVaultLike;

  constructor(db_path: string, vault: SecretVaultLike) {
    this.db_path = db_path;
    this.vault = vault;
    mkdirSync(dirname(db_path), { recursive: true });
    this._ensure_initialized();
  }

  private _ensure_initialized(): void {
    with_sqlite_strict(this.db_path, (db) => {
      db.exec(INIT_SQL);
      // 마이그레이션: model_purpose 컬럼 추가 (기존 테이블 대응)
      const has_purpose = db.prepare(
        "SELECT 1 FROM pragma_table_info('agent_providers') WHERE name='model_purpose'",
      ).get();
      if (!has_purpose) db.exec(MIGRATE_MODEL_PURPOSE);
      // 마이그레이션: connection_id 컬럼 추가
      const has_conn = db.prepare(
        "SELECT 1 FROM pragma_table_info('agent_providers') WHERE name='connection_id'",
      ).get();
      if (!has_conn) db.exec(MIGRATE_CONNECTION_ID);
      return true;
    }, { pragmas: PRAGMAS });
  }

  // ── 조회 ──

  list(): AgentProviderConfig[] {
    return with_sqlite(this.db_path, (db) => {
      const rows = db.prepare("SELECT * FROM agent_providers ORDER BY priority ASC, created_at ASC").all() as ProviderRow[];
      return rows.map(row_to_config);
    }, { pragmas: PRAGMAS }) ?? [];
  }

  get(instance_id: string): AgentProviderConfig | null {
    return with_sqlite(this.db_path, (db) => {
      const row = db.prepare("SELECT * FROM agent_providers WHERE instance_id = ?").get(instance_id) as ProviderRow | undefined;
      return row ? row_to_config(row) : null;
    }, { pragmas: PRAGMAS }) ?? null;
  }

  /** enabled + 해당 모드를 지원하는 프로바이더 목록. priority ASC 정렬. */
  list_for_mode(mode: ExecutionMode): AgentProviderConfig[] {
    return this.list().filter((c) => {
      if (!c.enabled) return false;
      if (c.supported_modes.length === 0) return true;
      return c.supported_modes.includes(mode);
    });
  }

  /** enabled + 해당 용도의 프로바이더 목록. priority ASC 정렬. */
  list_for_purpose(purpose: ModelPurpose): AgentProviderConfig[] {
    return this.list().filter((c) => c.enabled && c.model_purpose === purpose);
  }

  count(): number {
    return with_sqlite(this.db_path, (db) => {
      const row = db.prepare("SELECT COUNT(*) as cnt FROM agent_providers").get() as { cnt: number };
      return row.cnt;
    }, { pragmas: PRAGMAS }) ?? 0;
  }

  // ── 쓰기 ──

  upsert(input: CreateAgentProviderInput): void {
    with_sqlite_strict(this.db_path, (db) => {
      db.prepare(`
        INSERT INTO agent_providers (instance_id, provider_type, label, enabled, priority, model_purpose, supported_modes, settings_json, connection_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        ON CONFLICT(instance_id) DO UPDATE SET
          provider_type = excluded.provider_type,
          label = excluded.label,
          enabled = excluded.enabled,
          priority = excluded.priority,
          model_purpose = excluded.model_purpose,
          supported_modes = excluded.supported_modes,
          settings_json = excluded.settings_json,
          connection_id = excluded.connection_id,
          updated_at = datetime('now')
      `).run(
        input.instance_id,
        input.provider_type,
        input.label,
        input.enabled ? 1 : 0,
        input.priority,
        input.model_purpose || "chat",
        JSON.stringify(input.supported_modes),
        JSON.stringify(input.settings),
        input.connection_id || null,
      );
      return true;
    }, { pragmas: PRAGMAS });
  }

  update_settings(
    instance_id: string,
    patch: Partial<Pick<AgentProviderConfig, "label" | "enabled" | "priority" | "model_purpose" | "supported_modes" | "settings" | "connection_id">>,
  ): boolean {
    const existing = this.get(instance_id);
    if (!existing) return false;

    const label = patch.label ?? existing.label;
    const enabled = patch.enabled ?? existing.enabled;
    const priority = patch.priority ?? existing.priority;
    const model_purpose = patch.model_purpose ?? existing.model_purpose;
    const supported_modes = patch.supported_modes ?? existing.supported_modes;
    const settings = patch.settings ? { ...existing.settings, ...patch.settings } : existing.settings;
    const connection_id = patch.connection_id !== undefined ? (patch.connection_id || null) : (existing.connection_id || null);

    with_sqlite_strict(this.db_path, (db) => {
      db.prepare(`
        UPDATE agent_providers
        SET label = ?, enabled = ?, priority = ?, model_purpose = ?, supported_modes = ?, settings_json = ?, connection_id = ?, updated_at = datetime('now')
        WHERE instance_id = ?
      `).run(label, enabled ? 1 : 0, priority, model_purpose, JSON.stringify(supported_modes), JSON.stringify(settings), connection_id, instance_id);
      return true;
    }, { pragmas: PRAGMAS });
    return true;
  }

  remove(instance_id: string): boolean {
    const result = with_sqlite_strict(this.db_path, (db) => {
      const r = db.prepare("DELETE FROM agent_providers WHERE instance_id = ?").run(instance_id);
      return r.changes > 0;
    }, { pragmas: PRAGMAS });
    return result ?? false;
  }

  // ── 토큰 (vault 위임) ──

  async set_token(instance_id: string, token: string): Promise<void> {
    await this.vault.put_secret(`agent.${instance_id}.apiKey`, token);
  }

  async get_token(instance_id: string): Promise<string | null> {
    return this.vault.reveal_secret(`agent.${instance_id}.apiKey`);
  }

  async remove_token(instance_id: string): Promise<void> {
    await this.vault.remove_secret(`agent.${instance_id}.apiKey`);
  }

  async has_token(instance_id: string): Promise<boolean> {
    const cipher = await this.vault.get_secret_cipher(`agent.${instance_id}.apiKey`);
    return cipher !== null;
  }

  /**
   * 인스턴스의 유효 토큰 해석.
   * connection_id가 있으면 connection 토큰을 우선 사용, 없으면 인스턴스 자체 토큰.
   */
  async resolve_token(instance_id: string): Promise<string | null> {
    const config = this.get(instance_id);
    if (!config) return null;
    if (config.connection_id) {
      const conn_token = await this.get_connection_token(config.connection_id);
      if (conn_token) return conn_token;
    }
    return this.get_token(instance_id);
  }

  /** 인스턴스의 유효 api_base 해석. connection의 api_base를 우선 사용. */
  resolve_api_base(instance_id: string): string | undefined {
    const config = this.get(instance_id);
    if (!config) return undefined;
    if (config.connection_id) {
      const conn = this.get_connection(config.connection_id);
      if (conn?.api_base) return conn.api_base;
    }
    return typeof config.settings.api_base === "string" ? config.settings.api_base : undefined;
  }

  /** 인스턴스에 유효 토큰이 있는지 (connection 토큰 포함). */
  async has_resolved_token(instance_id: string): Promise<boolean> {
    const config = this.get(instance_id);
    if (!config) return false;
    if (config.connection_id) {
      const has = await this.has_connection_token(config.connection_id);
      if (has) return true;
    }
    return this.has_token(instance_id);
  }

  // ── Connection CRUD ──

  list_connections(): ProviderConnection[] {
    return with_sqlite(this.db_path, (db) => {
      const rows = db.prepare("SELECT * FROM provider_connections ORDER BY created_at ASC").all() as ConnectionRow[];
      return rows.map(row_to_connection);
    }, { pragmas: PRAGMAS }) ?? [];
  }

  get_connection(connection_id: string): ProviderConnection | null {
    return with_sqlite(this.db_path, (db) => {
      const row = db.prepare("SELECT * FROM provider_connections WHERE connection_id = ?").get(connection_id) as ConnectionRow | undefined;
      return row ? row_to_connection(row) : null;
    }, { pragmas: PRAGMAS }) ?? null;
  }

  upsert_connection(input: CreateProviderConnectionInput): void {
    with_sqlite_strict(this.db_path, (db) => {
      db.prepare(`
        INSERT INTO provider_connections (connection_id, provider_type, label, enabled, api_base, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        ON CONFLICT(connection_id) DO UPDATE SET
          provider_type = excluded.provider_type,
          label = excluded.label,
          enabled = excluded.enabled,
          api_base = excluded.api_base,
          updated_at = datetime('now')
      `).run(
        input.connection_id,
        input.provider_type,
        input.label,
        input.enabled ? 1 : 0,
        input.api_base || null,
      );
      return true;
    }, { pragmas: PRAGMAS });
  }

  update_connection(
    connection_id: string,
    patch: Partial<Pick<ProviderConnection, "label" | "enabled" | "api_base">>,
  ): boolean {
    const existing = this.get_connection(connection_id);
    if (!existing) return false;
    const label = patch.label ?? existing.label;
    const enabled = patch.enabled ?? existing.enabled;
    const api_base = patch.api_base !== undefined ? (patch.api_base || null) : (existing.api_base || null);
    with_sqlite_strict(this.db_path, (db) => {
      db.prepare(`
        UPDATE provider_connections
        SET label = ?, enabled = ?, api_base = ?, updated_at = datetime('now')
        WHERE connection_id = ?
      `).run(label, enabled ? 1 : 0, api_base, connection_id);
      return true;
    }, { pragmas: PRAGMAS });
    return true;
  }

  remove_connection(connection_id: string): boolean {
    // connection 삭제 시 참조하는 provider들의 connection_id 초기화와 삭제를 단일 트랜잭션으로 처리
    const result = with_sqlite_strict(this.db_path, (db) => {
      db.prepare("UPDATE agent_providers SET connection_id = NULL WHERE connection_id = ?").run(connection_id);
      const r = db.prepare("DELETE FROM provider_connections WHERE connection_id = ?").run(connection_id);
      return r.changes > 0;
    }, { pragmas: PRAGMAS });
    return result ?? false;
  }

  /** 해당 connection을 참조하는 프로바이더 수. */
  count_presets_for_connection(connection_id: string): number {
    return with_sqlite(this.db_path, (db) => {
      const row = db.prepare("SELECT COUNT(*) as cnt FROM agent_providers WHERE connection_id = ?").get(connection_id) as { cnt: number };
      return row.cnt;
    }, { pragmas: PRAGMAS }) ?? 0;
  }

  // ── Connection 토큰 (vault 위임) ──

  async set_connection_token(connection_id: string, token: string): Promise<void> {
    await this.vault.put_secret(`connection.${connection_id}.apiKey`, token);
  }

  async get_connection_token(connection_id: string): Promise<string | null> {
    return this.vault.reveal_secret(`connection.${connection_id}.apiKey`);
  }

  async remove_connection_token(connection_id: string): Promise<void> {
    await this.vault.remove_secret(`connection.${connection_id}.apiKey`);
  }

  async has_connection_token(connection_id: string): Promise<boolean> {
    const cipher = await this.vault.get_secret_cipher(`connection.${connection_id}.apiKey`);
    return cipher !== null;
  }
}
