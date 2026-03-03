/**
 * AgentProviderStore — SQLite 기반 에이전트 프로바이더 인스턴스 영속 저장소.
 * 각 인스턴스의 provider_type, label, enabled, priority, supported_modes, settings 관리.
 * 토큰 등 민감값은 SecretVault에 위임 (키: agent.{instance_id}.apiKey).
 */

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { with_sqlite } from "../utils/sqlite-helper.js";
import type { SecretVaultLike } from "../security/secret-vault.js";
import type { AgentProviderConfig, CreateAgentProviderInput } from "./agent.types.js";
import type { ExecutionMode } from "../orchestration/types.js";

const INIT_SQL = `
  PRAGMA journal_mode=WAL;
  CREATE TABLE IF NOT EXISTS agent_providers (
    instance_id     TEXT PRIMARY KEY,
    provider_type   TEXT NOT NULL,
    label           TEXT NOT NULL DEFAULT '',
    enabled         INTEGER NOT NULL DEFAULT 1,
    priority        INTEGER NOT NULL DEFAULT 100,
    supported_modes TEXT NOT NULL DEFAULT '["once","agent","task"]',
    settings_json   TEXT NOT NULL DEFAULT '{}',
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

const PRAGMAS = ["journal_mode=WAL"];

interface ProviderRow {
  instance_id: string;
  provider_type: string;
  label: string;
  enabled: number;
  priority: number;
  supported_modes: string;
  settings_json: string;
  created_at: string;
  updated_at: string;
}

function row_to_config(r: ProviderRow): AgentProviderConfig {
  return {
    instance_id: r.instance_id,
    provider_type: r.provider_type,
    label: r.label,
    enabled: r.enabled === 1,
    priority: r.priority,
    supported_modes: safe_parse_modes(r.supported_modes),
    settings: JSON.parse(r.settings_json),
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
    with_sqlite(this.db_path, (db) => { db.exec(INIT_SQL); return true; }, { pragmas: PRAGMAS });
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

  count(): number {
    return with_sqlite(this.db_path, (db) => {
      const row = db.prepare("SELECT COUNT(*) as cnt FROM agent_providers").get() as { cnt: number };
      return row.cnt;
    }, { pragmas: PRAGMAS }) ?? 0;
  }

  // ── 쓰기 ──

  upsert(input: CreateAgentProviderInput): void {
    with_sqlite(this.db_path, (db) => {
      db.prepare(`
        INSERT INTO agent_providers (instance_id, provider_type, label, enabled, priority, supported_modes, settings_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        ON CONFLICT(instance_id) DO UPDATE SET
          provider_type = excluded.provider_type,
          label = excluded.label,
          enabled = excluded.enabled,
          priority = excluded.priority,
          supported_modes = excluded.supported_modes,
          settings_json = excluded.settings_json,
          updated_at = datetime('now')
      `).run(
        input.instance_id,
        input.provider_type,
        input.label,
        input.enabled ? 1 : 0,
        input.priority,
        JSON.stringify(input.supported_modes),
        JSON.stringify(input.settings),
      );
      return true;
    }, { pragmas: PRAGMAS });
  }

  update_settings(
    instance_id: string,
    patch: Partial<Pick<AgentProviderConfig, "label" | "enabled" | "priority" | "supported_modes" | "settings">>,
  ): boolean {
    const existing = this.get(instance_id);
    if (!existing) return false;

    const label = patch.label ?? existing.label;
    const enabled = patch.enabled ?? existing.enabled;
    const priority = patch.priority ?? existing.priority;
    const supported_modes = patch.supported_modes ?? existing.supported_modes;
    const settings = patch.settings ? { ...existing.settings, ...patch.settings } : existing.settings;

    with_sqlite(this.db_path, (db) => {
      db.prepare(`
        UPDATE agent_providers
        SET label = ?, enabled = ?, priority = ?, supported_modes = ?, settings_json = ?, updated_at = datetime('now')
        WHERE instance_id = ?
      `).run(label, enabled ? 1 : 0, priority, JSON.stringify(supported_modes), JSON.stringify(settings), instance_id);
      return true;
    }, { pragmas: PRAGMAS });
    return true;
  }

  remove(instance_id: string): boolean {
    const result = with_sqlite(this.db_path, (db) => {
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
}
