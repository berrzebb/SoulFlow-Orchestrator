import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { create_logger } from "../logger.js";
import { escape_regexp, now_iso } from "../utils/common.js";
import { with_sqlite_strict } from "../utils/sqlite-helper.js";
import { redact_sensitive_text } from "./sensitive.js";

const log = create_logger("secret-vault");

type SecretEntry = {
  ciphertext: string;
  updated_at: string;
};

type SecretRow = {
  name: string;
  ciphertext: string;
  updated_at: string;
};

export type SecretResolveReport = {
  text: string;
  missing_keys: string[];
  invalid_ciphertexts: string[];
};

export interface SecretVaultLike {
  get_paths(): { root_dir: string; store_path: string };
  ensure_ready(): Promise<void>;
  get_or_create_key(): Promise<Buffer>;
  encrypt_text(plaintext: string, aad?: string): Promise<string>;
  decrypt_text(token: string, aad?: string): Promise<string>;
  list_names(): Promise<string[]>;
  put_secret(nameRaw: string, plaintext: string): Promise<{ ok: boolean; name: string }>;
  remove_secret(nameRaw: string): Promise<boolean>;
  get_secret_cipher(nameRaw: string): Promise<string | null>;
  reveal_secret(nameRaw: string): Promise<string | null>;
  resolve_placeholders(input: string): Promise<string>;
  resolve_placeholders_with_report(input: string): Promise<SecretResolveReport>;
  resolve_inline_secrets(input: string): Promise<string>;
  resolve_inline_secrets_with_report(input: string): Promise<SecretResolveReport>;
  inspect_secret_references(input: string): Promise<{ missing_keys: string[]; invalid_ciphertexts: string[] }>;
  mask_known_secrets(input: string): Promise<string>;
  prune_expired(max_age_ms: number): Promise<number>;
}

const STORE_FILE = "secrets.db";
const LEGACY_KEY_FILE = "master.key";
const CIPHERTEXT_TOKEN_RE = /\bsv1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;

function b64url_encode(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64url_decode(value: string): Buffer {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "===".slice((normalized.length + 3) % 4);
  return Buffer.from(padded, "base64");
}

function normalize_secret_name(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, "_")
    .slice(0, 80);
}

function is_valid_ciphertext_shape(token: string): boolean {
  try {
    const parts = String(token || "").trim().split(".");
    if (parts.length !== 4 || parts[0] !== "sv1") return false;
    const iv = b64url_decode(parts[1]);
    const tag = b64url_decode(parts[2]);
    const content = b64url_decode(parts[3]);
    if (iv.length !== 12) return false;
    if (tag.length !== 16) return false;
    if (content.length <= 0) return false;
    return true;
  } catch {
    return false;
  }
}

export class SecretVaultService implements SecretVaultLike {
  private readonly root_dir: string;
  private readonly store_path: string;
  private key_cache: Buffer | null = null;
  private key_lock: Promise<Buffer> | null = null;

  constructor(workspace: string) {
    this.root_dir = join(workspace, "runtime", "security");
    this.store_path = join(this.root_dir, STORE_FILE);
  }

  get_paths(): { root_dir: string; store_path: string } {
    return {
      root_dir: this.root_dir,
      store_path: this.store_path,
    };
  }

  private ensure_store_db(): void {
    with_sqlite_strict(this.store_path, (db) => {
      db.exec(`
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS master_key (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          key_b64url TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS secrets (
          name TEXT PRIMARY KEY,
          ciphertext TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_secrets_updated_at
          ON secrets(updated_at DESC);
      `);
      return true;
    });
  }

  async ensure_ready(): Promise<void> {
    await mkdir(this.root_dir, { recursive: true });
    this.ensure_store_db();
    await this.get_or_create_key();
  }

  async get_or_create_key(): Promise<Buffer> {
    if (this.key_cache) return this.key_cache;
    if (this.key_lock) return this.key_lock;
    this.key_lock = this._load_or_generate_key();
    try {
      return await this.key_lock;
    } finally {
      this.key_lock = null;
    }
  }

  private async _load_or_generate_key(): Promise<Buffer> {
    if (this.key_cache) return this.key_cache;
    await mkdir(this.root_dir, { recursive: true });
    this.ensure_store_db();

    // DB에서 마스터 키 조회
    const row = with_sqlite_strict(this.store_path, (db) =>
      db.prepare("SELECT key_b64url FROM master_key WHERE id = 1").get() as { key_b64url: string } | undefined
    );
    if (row?.key_b64url) {
      const bytes = b64url_decode(row.key_b64url);
      if (bytes.length !== 32) throw new Error("invalid_master_key_in_db");
      this.key_cache = bytes;
      return bytes;
    }

    // 레거시 파일(master.key)이 있으면 마이그레이션 후 삭제
    let key: Buffer;
    const legacy_path = join(this.root_dir, LEGACY_KEY_FILE);
    try {
      const raw = (await readFile(legacy_path, "utf-8")).trim();
      const bytes = b64url_decode(raw);
      if (bytes.length !== 32) throw new Error("invalid_key_length");
      key = bytes;
      await unlink(legacy_path).catch(() => undefined);
      log.info("master key migrated from legacy file");
    } catch (err) {
      const code = (err as { code?: string } | null)?.code || "";
      const msg = (err as Error).message || "";
      if (code !== "ENOENT" && msg !== "invalid_key_length") throw err;
      key = randomBytes(32);
      log.info("master key generated");
    }

    // DB에 저장 (파일에는 쓰지 않음)
    with_sqlite_strict(this.store_path, (db) => {
      db.prepare(
        "INSERT OR REPLACE INTO master_key(id, key_b64url, created_at) VALUES (1, ?, ?)"
      ).run(b64url_encode(key), now_iso());
      return true;
    });

    this.key_cache = key;
    return key;
  }

  async encrypt_text(plaintext: string, aad?: string): Promise<string> {
    await this.ensure_ready();
    const key = await this.get_or_create_key();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    if (aad) cipher.setAAD(Buffer.from(String(aad), "utf-8"));
    const content = Buffer.concat([cipher.update(String(plaintext || ""), "utf-8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `sv1.${b64url_encode(iv)}.${b64url_encode(tag)}.${b64url_encode(content)}`;
  }

  async decrypt_text(token: string, aad?: string): Promise<string> {
    await this.ensure_ready();
    const key = await this.get_or_create_key();
    const parts = String(token || "").trim().split(".");
    if (parts.length !== 4 || parts[0] !== "sv1") throw new Error("invalid_ciphertext_format");
    const iv = b64url_decode(parts[1]);
    const tag = b64url_decode(parts[2]);
    const content = b64url_decode(parts[3]);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    if (aad) decipher.setAAD(Buffer.from(String(aad), "utf-8"));
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(content), decipher.final()]);
    return plain.toString("utf-8");
  }

  private async read_store_map(): Promise<Record<string, SecretEntry>> {
    await this.ensure_ready();
    const rows = with_sqlite_strict(this.store_path, (db) => db.prepare(`
      SELECT name, ciphertext, updated_at
      FROM secrets
      ORDER BY name ASC
    `).all() as SecretRow[]) || [];
    const out: Record<string, SecretEntry> = {};
    for (const row of rows) {
      const name = normalize_secret_name(row.name);
      if (!name) continue;
      out[name] = {
        ciphertext: String(row.ciphertext || ""),
        updated_at: String(row.updated_at || now_iso()),
      };
    }
    return out;
  }

  async list_names(): Promise<string[]> {
    await this.ensure_ready();
    const rows = with_sqlite_strict(this.store_path, (db) => db.prepare(`
      SELECT name
      FROM secrets
      ORDER BY name ASC
    `).all() as Array<{ name: string }>) || [];
    return rows
      .map((row) => normalize_secret_name(row.name))
      .filter(Boolean);
  }

  async put_secret(nameRaw: string, plaintext: string): Promise<{ ok: boolean; name: string }> {
    const name = normalize_secret_name(nameRaw);
    if (!name) return { ok: false, name: "" };
    await this.ensure_ready();
    const ciphertext = await this.encrypt_text(plaintext, `secret:${name}`);
    const ok = with_sqlite_strict(this.store_path, (db) => {
      db.prepare(`
        INSERT INTO secrets(name, ciphertext, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET
          ciphertext = excluded.ciphertext,
          updated_at = excluded.updated_at
      `).run(name, ciphertext, now_iso());
      return true;
    });
    return { ok: Boolean(ok), name };
  }

  async remove_secret(nameRaw: string): Promise<boolean> {
    const name = normalize_secret_name(nameRaw);
    if (!name) return false;
    await this.ensure_ready();
    const removed = with_sqlite_strict(this.store_path, (db) => {
      const r = db.prepare("DELETE FROM secrets WHERE name = ?").run(name);
      return Number(r.changes || 0) > 0;
    });
    return Boolean(removed);
  }

  async get_secret_cipher(nameRaw: string): Promise<string | null> {
    const name = normalize_secret_name(nameRaw);
    if (!name) return null;
    await this.ensure_ready();
    const row = with_sqlite_strict(this.store_path, (db) => db.prepare(`
      SELECT ciphertext
      FROM secrets
      WHERE name = ?
      LIMIT 1
    `).get(name) as { ciphertext: string } | undefined) || null;
    if (!row) return null;
    return String(row.ciphertext || "").trim() || null;
  }

  async reveal_secret(nameRaw: string): Promise<string | null> {
    const name = normalize_secret_name(nameRaw);
    if (!name) return null;
    const cipher = await this.get_secret_cipher(name);
    if (!cipher) return null;
    try {
      return await this.decrypt_text(cipher, `secret:${name}`);
    } catch (err) {
      log.warn("decrypt failed", { name, error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  }

  async resolve_placeholders(input: string): Promise<string> {
    const report = await this.resolve_placeholders_with_report(input);
    return report.text;
  }

  async resolve_placeholders_with_report(input: string): Promise<SecretResolveReport> {
    const text = String(input || "");
    if (!text || !text.includes("{{secret:")) {
      return {
        text,
        missing_keys: [],
        invalid_ciphertexts: [],
      };
    }
    const store = await this.read_store_map();
    const cache = new Map<string, string>();
    const missing = new Set<string>();
    const replaced = text.replace(/\{\{\s*secret:([a-zA-Z0-9_.-]+)\s*\}\}/g, (_m, nameRaw) => {
      const name = normalize_secret_name(nameRaw);
      if (!name) {
        missing.add(String(nameRaw || "").trim());
        return `{{secret:${String(nameRaw || "").trim()}}}`;
      }
      const cached = cache.get(name);
      if (cached !== undefined) return cached;
      const row = store[name];
      if (!row?.ciphertext) {
        cache.set(name, "");
        missing.add(name);
        return `{{secret:${name}}}`;
      }
      cache.set(name, row.ciphertext);
      return row.ciphertext;
    });
    if (!replaced.includes("sv1.")) {
      return {
        text: replaced,
        missing_keys: [...missing.values()],
        invalid_ciphertexts: [],
      };
    }

    let out = replaced;
    const invalid_ciphertexts = new Set<string>();
    for (const [name, cipher] of cache.entries()) {
      if (!cipher) continue;
      const plain = await this.decrypt_text(cipher, `secret:${name}`).catch(() => "");
      if (!plain) {
        invalid_ciphertexts.add(cipher);
        continue;
      }
      out = out.replace(new RegExp(escape_regexp(cipher), "g"), plain);
    }
    return {
      text: out,
      missing_keys: [...missing.values()],
      invalid_ciphertexts: [...invalid_ciphertexts.values()],
    };
  }

  async resolve_inline_secrets(input: string): Promise<string> {
    const report = await this.resolve_inline_secrets_with_report(input);
    return report.text;
  }

  async resolve_inline_secrets_with_report(input: string): Promise<SecretResolveReport> {
    const report = await this.resolve_placeholders_with_report(input);
    if (!report.text.includes("sv1.")) return report;
    let out = report.text;
    const invalid = new Set<string>(report.invalid_ciphertexts || []);
    const tokens = new Set<string>(report.text.match(CIPHERTEXT_TOKEN_RE) || []);
    for (const token of tokens.values()) {
      if (!token) continue;
      // AAD 없이 decrypt — 인바운드 seal 등 AAD 없이 암호화된 토큰 대상
      const plain = await this.decrypt_text(token).catch(() => "");
      if (!plain) {
        invalid.add(token);
        continue;
      }
      out = out.replace(new RegExp(escape_regexp(token), "g"), plain);
    }
    return {
      text: out,
      missing_keys: [...new Set(report.missing_keys || [])],
      invalid_ciphertexts: [...invalid.values()],
    };
  }

  async inspect_secret_references(input: string): Promise<{ missing_keys: string[]; invalid_ciphertexts: string[] }> {
    const text = String(input || "");
    if (!text) return { missing_keys: [], invalid_ciphertexts: [] };
    const missing_keys = new Set<string>();
    const invalid_ciphertexts = new Set<string>();
    const store = await this.read_store_map();

    const placeholder_re = /\{\{\s*secret:([a-zA-Z0-9_.-]+)\s*\}\}/g;
    let pm: RegExpExecArray | null = null;
    while (true) {
      pm = placeholder_re.exec(text);
      if (!pm) break;
      const name = normalize_secret_name(pm[1]);
      if (!name || !store[name]?.ciphertext) {
        missing_keys.add(name || String(pm[1] || "").trim());
      }
      if (pm[0].length <= 0) placeholder_re.lastIndex += 1;
    }

    const tokens = new Set<string>(text.match(CIPHERTEXT_TOKEN_RE) || []);
    for (const token of tokens.values()) {
      if (!is_valid_ciphertext_shape(token)) invalid_ciphertexts.add(token);
    }
    return {
      missing_keys: [...missing_keys.values()],
      invalid_ciphertexts: [...invalid_ciphertexts.values()],
    };
  }

  async prune_expired(max_age_ms: number): Promise<number> {
    await this.ensure_ready();
    const cutoff = new Date(Date.now() - Math.max(max_age_ms, 60_000)).toISOString();
    const deleted = with_sqlite_strict(this.store_path, (db) => {
      // inbound seal이 생성한 자동 시크릿(inbound. 접두사)만 정리, 사용자 시크릿은 유지
      const r = db.prepare("DELETE FROM secrets WHERE updated_at < ? AND name LIKE 'inbound.%'").run(cutoff);
      return Number(r.changes || 0);
    });
    return deleted ?? 0;
  }

  async mask_known_secrets(input: string): Promise<string> {
    const text = String(input || "");
    if (!text) return "";
    const store = await this.read_store_map();
    let out = text;
    for (const [name, row] of Object.entries(store)) {
      const cipher = String(row?.ciphertext || "").trim();
      if (!cipher) continue;
      const plain = await this.decrypt_text(cipher, `secret:${name}`).catch(() => "");
      if (!plain || plain.length < 4) continue;
      out = out.replace(new RegExp(escape_regexp(plain), "g"), "[REDACTED:SECRET]");
    }
    const redacted = redact_sensitive_text(out);
    return redacted.text;
  }
}
