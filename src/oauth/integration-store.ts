/**
 * OAuthIntegrationStore — SQLite 메타데이터 + SecretVault 토큰 저장소.
 * ChannelInstanceStore 패턴을 따름.
 */

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { with_sqlite, with_sqlite_strict } from "../utils/sqlite-helper.js";
import type { SecretVaultLike } from "../security/secret-vault.js";
import type { OAuthServicePreset } from "./presets.js";

const INIT_SQL = `
  PRAGMA journal_mode=WAL;
  CREATE TABLE IF NOT EXISTS oauth_integrations (
    instance_id   TEXT PRIMARY KEY,
    service_type  TEXT NOT NULL,
    label         TEXT NOT NULL DEFAULT '',
    enabled       INTEGER NOT NULL DEFAULT 1,
    scopes        TEXT NOT NULL DEFAULT '[]',
    auth_url      TEXT NOT NULL DEFAULT '',
    token_url     TEXT NOT NULL DEFAULT '',
    redirect_uri  TEXT NOT NULL DEFAULT '',
    expires_at    TEXT,
    settings_json TEXT NOT NULL DEFAULT '{}',
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS oauth_custom_presets (
    service_type            TEXT PRIMARY KEY,
    label                   TEXT NOT NULL,
    auth_url                TEXT NOT NULL,
    token_url               TEXT NOT NULL,
    scopes_available_json   TEXT NOT NULL DEFAULT '[]',
    default_scopes_json     TEXT NOT NULL DEFAULT '[]',
    supports_refresh        INTEGER NOT NULL DEFAULT 1,
    token_auth_method       TEXT,
    test_url                TEXT,
    extra_auth_params_json  TEXT NOT NULL DEFAULT '{}',
    created_at              TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

const PRAGMAS = ["journal_mode=WAL"];

export interface OAuthIntegrationConfig {
  instance_id: string;
  service_type: string;
  label: string;
  enabled: boolean;
  scopes: string[];
  auth_url: string;
  token_url: string;
  redirect_uri: string;
  expires_at: string | null;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type CreateOAuthIntegrationInput = Pick<
  OAuthIntegrationConfig,
  "instance_id" | "service_type" | "label" | "enabled" | "scopes" | "auth_url" | "token_url" | "redirect_uri" | "settings"
>;

interface IntegrationRow {
  instance_id: string;
  service_type: string;
  label: string;
  enabled: number;
  scopes: string;
  auth_url: string;
  token_url: string;
  redirect_uri: string;
  expires_at: string | null;
  settings_json: string;
  created_at: string;
  updated_at: string;
}

function row_to_config(r: IntegrationRow): OAuthIntegrationConfig {
  return {
    instance_id: r.instance_id,
    service_type: r.service_type,
    label: r.label,
    enabled: r.enabled === 1,
    scopes: JSON.parse(r.scopes),
    auth_url: r.auth_url,
    token_url: r.token_url,
    redirect_uri: r.redirect_uri,
    expires_at: r.expires_at,
    settings: JSON.parse(r.settings_json),
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function vault_key(instance_id: string, kind: string): string {
  return `oauth.${instance_id}.${kind}`;
}

export class OAuthIntegrationStore {
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

  list(): OAuthIntegrationConfig[] {
    return with_sqlite(this.db_path, (db) => {
      const rows = db.prepare("SELECT * FROM oauth_integrations ORDER BY created_at").all() as IntegrationRow[];
      return rows.map(row_to_config);
    }, { pragmas: PRAGMAS }) ?? [];
  }

  get(instance_id: string): OAuthIntegrationConfig | null {
    return with_sqlite(this.db_path, (db) => {
      const row = db.prepare("SELECT * FROM oauth_integrations WHERE instance_id = ?").get(instance_id) as IntegrationRow | undefined;
      return row ? row_to_config(row) : null;
    }, { pragmas: PRAGMAS }) ?? null;
  }

  // ── 쓰기 ──

  upsert(input: CreateOAuthIntegrationInput): void {
    with_sqlite_strict(this.db_path, (db) => {
      db.prepare(`
        INSERT INTO oauth_integrations (instance_id, service_type, label, enabled, scopes, auth_url, token_url, redirect_uri, settings_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        ON CONFLICT(instance_id) DO UPDATE SET
          label = excluded.label,
          enabled = excluded.enabled,
          scopes = excluded.scopes,
          auth_url = excluded.auth_url,
          token_url = excluded.token_url,
          redirect_uri = excluded.redirect_uri,
          settings_json = excluded.settings_json,
          updated_at = datetime('now')
      `).run(
        input.instance_id,
        input.service_type,
        input.label,
        input.enabled ? 1 : 0,
        JSON.stringify(input.scopes),
        input.auth_url,
        input.token_url,
        input.redirect_uri,
        JSON.stringify(input.settings),
      );
      return true;
    }, { pragmas: PRAGMAS });
  }

  update_settings(instance_id: string, patch: Partial<Pick<OAuthIntegrationConfig, "label" | "enabled" | "scopes">>): boolean {
    const existing = this.get(instance_id);
    if (!existing) return false;

    const label = patch.label ?? existing.label;
    const enabled = patch.enabled ?? existing.enabled;
    const scopes = patch.scopes ?? existing.scopes;

    with_sqlite_strict(this.db_path, (db) => {
      db.prepare(`
        UPDATE oauth_integrations SET label = ?, enabled = ?, scopes = ?, updated_at = datetime('now')
        WHERE instance_id = ?
      `).run(label, enabled ? 1 : 0, JSON.stringify(scopes), instance_id);
      return true;
    }, { pragmas: PRAGMAS });
    return true;
  }

  remove(instance_id: string): boolean {
    return with_sqlite_strict(this.db_path, (db) => {
      const r = db.prepare("DELETE FROM oauth_integrations WHERE instance_id = ?").run(instance_id);
      return r.changes > 0;
    }, { pragmas: PRAGMAS });
  }

  // ── 토큰 만료 ──

  set_expires_at(instance_id: string, expires_at: string | null): void {
    with_sqlite_strict(this.db_path, (db) => {
      db.prepare("UPDATE oauth_integrations SET expires_at = ?, updated_at = datetime('now') WHERE instance_id = ?")
        .run(expires_at, instance_id);
      return true;
    }, { pragmas: PRAGMAS });
  }

  is_expired(instance_id: string): boolean {
    const config = this.get(instance_id);
    if (!config?.expires_at) return false;
    return new Date(config.expires_at).getTime() <= Date.now();
  }

  // ── 토큰 (vault 위임) ──

  async set_tokens(instance_id: string, tokens: {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  }): Promise<void> {
    await this.vault.put_secret(vault_key(instance_id, "access_token"), tokens.access_token);
    if (tokens.refresh_token) {
      await this.vault.put_secret(vault_key(instance_id, "refresh_token"), tokens.refresh_token);
    }
    if (tokens.expires_in && tokens.expires_in > 0) {
      const expires_at = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
      this.set_expires_at(instance_id, expires_at);
    }
  }

  async set_client_credentials(instance_id: string, client_id: string, client_secret: string): Promise<void> {
    await this.vault.put_secret(vault_key(instance_id, "client_id"), client_id);
    await this.vault.put_secret(vault_key(instance_id, "client_secret"), client_secret);
  }

  async vault_store_client_id(instance_id: string, client_id: string): Promise<void> {
    await this.vault.put_secret(vault_key(instance_id, "client_id"), client_id);
  }

  async vault_store_client_secret(instance_id: string, client_secret: string): Promise<void> {
    await this.vault.put_secret(vault_key(instance_id, "client_secret"), client_secret);
  }

  async get_access_token(instance_id: string): Promise<string | null> {
    return this.vault.reveal_secret(vault_key(instance_id, "access_token"));
  }

  async get_refresh_token(instance_id: string): Promise<string | null> {
    return this.vault.reveal_secret(vault_key(instance_id, "refresh_token"));
  }

  async get_client_id(instance_id: string): Promise<string | null> {
    return this.vault.reveal_secret(vault_key(instance_id, "client_id"));
  }

  async get_client_secret(instance_id: string): Promise<string | null> {
    return this.vault.reveal_secret(vault_key(instance_id, "client_secret"));
  }

  async has_access_token(instance_id: string): Promise<boolean> {
    const cipher = await this.vault.get_secret_cipher(vault_key(instance_id, "access_token"));
    return cipher !== null;
  }

  async has_client_secret(instance_id: string): Promise<boolean> {
    const cipher = await this.vault.get_secret_cipher(vault_key(instance_id, "client_secret"));
    return cipher !== null;
  }

  async remove_tokens(instance_id: string): Promise<void> {
    await this.vault.remove_secret(vault_key(instance_id, "access_token"));
    await this.vault.remove_secret(vault_key(instance_id, "refresh_token"));
    await this.vault.remove_secret(vault_key(instance_id, "client_id"));
    await this.vault.remove_secret(vault_key(instance_id, "client_secret"));
    this.set_expires_at(instance_id, null);
  }

  // ── 커스텀 프리셋 (런타임 동적 등록용) ──

  save_preset(preset: OAuthServicePreset): void {
    with_sqlite_strict(this.db_path, (db) => {
      db.prepare(`
        INSERT INTO oauth_custom_presets
          (service_type, label, auth_url, token_url, scopes_available_json, default_scopes_json,
           supports_refresh, token_auth_method, test_url, extra_auth_params_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        ON CONFLICT(service_type) DO UPDATE SET
          label = excluded.label, auth_url = excluded.auth_url, token_url = excluded.token_url,
          scopes_available_json = excluded.scopes_available_json, default_scopes_json = excluded.default_scopes_json,
          supports_refresh = excluded.supports_refresh, token_auth_method = excluded.token_auth_method,
          test_url = excluded.test_url, extra_auth_params_json = excluded.extra_auth_params_json,
          updated_at = datetime('now')
      `).run(
        preset.service_type, preset.label, preset.auth_url, preset.token_url,
        JSON.stringify(preset.scopes_available), JSON.stringify(preset.default_scopes),
        preset.supports_refresh ? 1 : 0, preset.token_auth_method ?? null,
        preset.test_url ?? null, JSON.stringify(preset.extra_auth_params ?? {}),
      );
      return true;
    }, { pragmas: PRAGMAS });
  }

  load_presets(): OAuthServicePreset[] {
    return with_sqlite(this.db_path, (db) => {
      const rows = db.prepare("SELECT * FROM oauth_custom_presets ORDER BY created_at").all() as Array<Record<string, unknown>>;
      return rows.map((r) => ({
        service_type: String(r.service_type),
        label: String(r.label),
        auth_url: String(r.auth_url),
        token_url: String(r.token_url),
        scopes_available: JSON.parse(String(r.scopes_available_json)) as string[],
        default_scopes: JSON.parse(String(r.default_scopes_json)) as string[],
        supports_refresh: r.supports_refresh === 1,
        token_auth_method: r.token_auth_method ? (String(r.token_auth_method) as "basic" | "body") : undefined,
        test_url: r.test_url ? String(r.test_url) : undefined,
        extra_auth_params: JSON.parse(String(r.extra_auth_params_json)) as Record<string, string>,
      }));
    }, { pragmas: PRAGMAS }) ?? [];
  }

  remove_preset(service_type: string): boolean {
    return with_sqlite_strict(this.db_path, (db) => {
      const r = db.prepare("DELETE FROM oauth_custom_presets WHERE service_type = ?").run(service_type);
      return r.changes > 0;
    }, { pragmas: PRAGMAS });
  }
}
