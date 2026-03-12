/**
 * ChannelInstanceStore — SQLite 기반 채널 인스턴스 영속 저장소.
 * 각 인스턴스의 provider, label, enabled, settings 관리.
 * 토큰 등 민감값은 SecretVault에 위임 (키: channel.{instance_id}.botToken).
 */

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { with_sqlite, with_sqlite_strict } from "../utils/sqlite-helper.js";
import type { SecretVaultLike } from "../security/secret-vault.js";

const INIT_SQL = `
  PRAGMA journal_mode=WAL;
  CREATE TABLE IF NOT EXISTS channel_instances (
    instance_id   TEXT PRIMARY KEY,
    provider      TEXT NOT NULL,
    label         TEXT NOT NULL DEFAULT '',
    enabled       INTEGER NOT NULL DEFAULT 1,
    settings_json TEXT NOT NULL DEFAULT '{}',
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_channel_instances_provider
    ON channel_instances(provider);
`;

const PRAGMAS = ["journal_mode=WAL"];

export interface ChannelInstanceConfig {
  instance_id: string;
  provider: string;
  label: string;
  enabled: boolean;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type CreateChannelInstanceInput = Pick<ChannelInstanceConfig, "instance_id" | "provider" | "label" | "enabled" | "settings">;

interface InstanceRow {
  instance_id: string;
  provider: string;
  label: string;
  enabled: number;
  settings_json: string;
  created_at: string;
  updated_at: string;
}

function row_to_config(r: InstanceRow): ChannelInstanceConfig {
  return {
    instance_id: r.instance_id,
    provider: r.provider,
    label: r.label,
    enabled: r.enabled === 1,
    settings: JSON.parse(r.settings_json),
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export class ChannelInstanceStore {
  private readonly db_path: string;
  private readonly vault: SecretVaultLike;

  constructor(db_path: string, vault: SecretVaultLike) {
    this.db_path = db_path;
    this.vault = vault;
    mkdirSync(dirname(db_path), { recursive: true });
    this._ensure_initialized();
  }

  private _ensure_initialized(): void {
    with_sqlite_strict(this.db_path, (db) => { db.exec(INIT_SQL); return true; }, { pragmas: PRAGMAS });
  }

  // ── 조회 ──

  list(): ChannelInstanceConfig[] {
    return with_sqlite(this.db_path, (db) => {
      const rows = db.prepare("SELECT * FROM channel_instances ORDER BY created_at").all() as InstanceRow[];
      return rows.map(row_to_config);
    }, { pragmas: PRAGMAS }) ?? [];
  }

  get(instance_id: string): ChannelInstanceConfig | null {
    return with_sqlite(this.db_path, (db) => {
      const row = db.prepare("SELECT * FROM channel_instances WHERE instance_id = ?").get(instance_id) as InstanceRow | undefined;
      return row ? row_to_config(row) : null;
    }, { pragmas: PRAGMAS }) ?? null;
  }

  list_by_provider(provider: string): ChannelInstanceConfig[] {
    return with_sqlite(this.db_path, (db) => {
      const rows = db.prepare("SELECT * FROM channel_instances WHERE provider = ? ORDER BY created_at").all(provider) as InstanceRow[];
      return rows.map(row_to_config);
    }, { pragmas: PRAGMAS }) ?? [];
  }

  count(): number {
    return with_sqlite(this.db_path, (db) => {
      const row = db.prepare("SELECT COUNT(*) as cnt FROM channel_instances").get() as { cnt: number };
      return row.cnt;
    }, { pragmas: PRAGMAS }) ?? 0;
  }

  // ── 쓰기 ──

  upsert(input: CreateChannelInstanceInput): void {
    with_sqlite_strict(this.db_path, (db) => {
      db.prepare(`
        INSERT INTO channel_instances (instance_id, provider, label, enabled, settings_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        ON CONFLICT(instance_id) DO UPDATE SET
          label = excluded.label,
          enabled = excluded.enabled,
          settings_json = excluded.settings_json,
          updated_at = datetime('now')
      `).run(
        input.instance_id,
        input.provider,
        input.label,
        input.enabled ? 1 : 0,
        JSON.stringify(input.settings),
      );
      return true;
    }, { pragmas: PRAGMAS });
  }

  update_settings(instance_id: string, patch: Partial<Pick<ChannelInstanceConfig, "label" | "enabled" | "settings">>): boolean {
    const existing = this.get(instance_id);
    if (!existing) return false;

    const label = patch.label ?? existing.label;
    const enabled = patch.enabled ?? existing.enabled;
    const settings = patch.settings ? { ...existing.settings, ...patch.settings } : existing.settings;

    with_sqlite_strict(this.db_path, (db) => {
      db.prepare(`
        UPDATE channel_instances SET label = ?, enabled = ?, settings_json = ?, updated_at = datetime('now')
        WHERE instance_id = ?
      `).run(label, enabled ? 1 : 0, JSON.stringify(settings), instance_id);
      return true;
    }, { pragmas: PRAGMAS });
    return true;
  }

  remove(instance_id: string): boolean {
    return with_sqlite_strict(this.db_path, (db) => {
      const r = db.prepare("DELETE FROM channel_instances WHERE instance_id = ?").run(instance_id);
      return r.changes > 0;
    }, { pragmas: PRAGMAS });
  }

  // ── 토큰 (vault 위임) ──

  async set_token(instance_id: string, token: string): Promise<void> {
    await this.vault.put_secret(`channel.${instance_id}.botToken`, token);
  }

  async get_token(instance_id: string): Promise<string | null> {
    return this.vault.reveal_secret(`channel.${instance_id}.botToken`);
  }

  async remove_token(instance_id: string): Promise<void> {
    await this.vault.remove_secret(`channel.${instance_id}.botToken`);
  }

  async has_token(instance_id: string): Promise<boolean> {
    const cipher = await this.vault.get_secret_cipher(`channel.${instance_id}.botToken`);
    return cipher !== null;
  }
}
