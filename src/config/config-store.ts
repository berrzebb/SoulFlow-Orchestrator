/**
 * ConfigStore — SQLite 기반 설정 오버라이드 영속 저장소.
 * env 기본값 위에 덮어쓸 값을 저장. 민감 설정은 SecretVault에 위임.
 */

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { with_sqlite } from "../utils/sqlite-helper.js";
import type { SecretVaultLike } from "../security/secret-vault.js";
import { CONFIG_FIELDS, to_vault_name, type ConfigFieldMeta, type ConfigSection } from "./config-meta.js";

const INIT_SQL = `
  PRAGMA journal_mode=WAL;
  CREATE TABLE IF NOT EXISTS config_overrides (
    path      TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

const PRAGMAS = ["journal_mode=WAL"];

export interface ConfigOverride {
  path: string;
  value: unknown;
  updated_at: string;
}

export class ConfigStore {
  private readonly db_path: string;
  private readonly vault: SecretVaultLike;

  constructor(db_path: string, vault: SecretVaultLike) {
    this.db_path = db_path;
    this.vault = vault;
    mkdirSync(dirname(db_path), { recursive: true });
    this._ensure_initialized();
  }

  private _ensure_initialized(): void {
    with_sqlite(this.db_path, (db) => {
      db.exec(INIT_SQL);
      return true;
    }, { pragmas: PRAGMAS });
  }

  // ── 일반 설정 (비민감) ──

  /** 모든 오버라이드 조회 */
  get_all_overrides(): ConfigOverride[] {
    return with_sqlite(this.db_path, (db) => {
      const rows = db.prepare("SELECT path, value_json, updated_at FROM config_overrides").all() as Array<{ path: string; value_json: string; updated_at: string }>;
      return rows.map((r) => ({ path: r.path, value: JSON.parse(r.value_json), updated_at: r.updated_at }));
    }, { pragmas: PRAGMAS }) ?? [];
  }

  /** 개별 오버라이드 조회 */
  get_override(path: string): unknown | undefined {
    const result = with_sqlite(this.db_path, (db) => {
      const row = db.prepare("SELECT value_json FROM config_overrides WHERE path = ?").get(path) as { value_json: string } | undefined;
      return row ? JSON.parse(row.value_json) : undefined;
    }, { pragmas: PRAGMAS });
    return result ?? undefined;
  }

  /** 오버라이드 저장 */
  set_override(path: string, value: unknown): void {
    with_sqlite(this.db_path, (db) => {
      db.prepare(
        "INSERT INTO config_overrides (path, value_json, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(path) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
      ).run(path, JSON.stringify(value));
      return true;
    }, { pragmas: PRAGMAS });
  }

  /** 오버라이드 삭제 (env 기본값 복원) */
  remove_override(path: string): void {
    with_sqlite(this.db_path, (db) => {
      db.prepare("DELETE FROM config_overrides WHERE path = ?").run(path);
      return true;
    }, { pragmas: PRAGMAS });
  }

  // ── 민감 설정 (SecretVault) ──

  /** 민감 설정 저장 (vault 암호화) */
  async set_sensitive(path: string, plaintext: string): Promise<void> {
    await this.vault.ensure_ready();
    await this.vault.put_secret(to_vault_name(path), plaintext);
  }

  /** 민감 설정 조회 (vault 복호화) — null이면 미설정 */
  async get_sensitive(path: string): Promise<string | null> {
    await this.vault.ensure_ready();
    return this.vault.reveal_secret(to_vault_name(path));
  }

  /** 민감 설정 삭제 */
  async remove_sensitive(path: string): Promise<void> {
    await this.vault.ensure_ready();
    await this.vault.remove_secret(to_vault_name(path));
  }

  /** 민감 설정 존재 여부 확인 */
  async has_sensitive(path: string): Promise<boolean> {
    await this.vault.ensure_ready();
    const cipher = await this.vault.get_secret_cipher(to_vault_name(path));
    return cipher !== null;
  }

  // ── 통합 API (설정 전체 조회/저장) ──

  /** 설정 값 저장 (민감/비민감 자동 분기) */
  async set_value(path: string, value: unknown): Promise<void> {
    const meta = CONFIG_FIELDS.find((f) => f.path === path);
    if (meta?.sensitive) {
      await this.set_sensitive(path, String(value));
    } else {
      this.set_override(path, value);
    }
  }

  /** 설정 값 삭제 (민감/비민감 자동 분기) */
  async remove_value(path: string): Promise<void> {
    const meta = CONFIG_FIELDS.find((f) => f.path === path);
    if (meta?.sensitive) {
      await this.remove_sensitive(path);
    } else {
      this.remove_override(path);
    }
  }

  /**
   * 섹션별 설정 현황 조회.
   * 각 필드의 현재 effective value, 오버라이드 여부, 민감 설정 설정 여부 반환.
   */
  async get_section_status(section: ConfigSection, current_config: Record<string, unknown>): Promise<Array<{
    path: string;
    label: string;
    type: ConfigFieldMeta["type"];
    value: unknown;
    default_value: unknown;
    overridden: boolean;
    sensitive: boolean;
    sensitive_set: boolean;
    restart_required: boolean;
    options?: string[];
    description?: string;
  }>> {
    const fields = CONFIG_FIELDS.filter((f) => f.section === section);
    const overrides = this.get_all_overrides();
    const override_map = new Map(overrides.map((o) => [o.path, o.value]));

    const results = [];
    for (const f of fields) {
      const overridden = override_map.has(f.path);
      let sensitive_set = false;
      if (f.sensitive) {
        sensitive_set = await this.has_sensitive(f.path);
      }

      // effective value: config 객체에서 dot-path로 읽기
      const value = _get_nested(current_config, f.path);

      results.push({
        path: f.path,
        label: f.label,
        type: f.type,
        value: f.sensitive ? (sensitive_set ? "••••••••" : "") : value,
        default_value: f.default_value,
        overridden: overridden || sensitive_set,
        sensitive: f.sensitive,
        sensitive_set,
        restart_required: f.restart_required,
        options: f.options,
        description: f.description,
      });
    }
    return results;
  }
}

/** dot-path로 중첩 객체에서 값 추출 */
function _get_nested(obj: Record<string, unknown>, path: string): unknown {
  const keys = path.split(".");
  let current: unknown = obj;
  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}
