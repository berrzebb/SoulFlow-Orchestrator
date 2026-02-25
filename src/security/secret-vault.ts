import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { redact_sensitive_text } from "./sensitive.js";

type SecretEntry = {
  ciphertext: string;
  updated_at: string;
};

type SecretFile = {
  version: number;
  secrets: Record<string, SecretEntry>;
};

export type SecretResolveReport = {
  text: string;
  missing_keys: string[];
  invalid_ciphertexts: string[];
};

const KEY_FILE = "master.key";
const STORE_FILE = "secrets.json";
const CIPHERTEXT_TOKEN_RE = /\bsv1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;

function b64url_encode(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64url_decode(value: string): Buffer {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "===".slice((normalized.length + 3) % 4);
  return Buffer.from(padded, "base64");
}

function now_iso(): string {
  return new Date().toISOString();
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

export class SecretVaultService {
  private readonly workspace: string;
  private readonly root_dir: string;
  private readonly key_path: string;
  private readonly store_path: string;
  private key_cache: Buffer | null = null;
  private write_queue: Promise<void> = Promise.resolve();

  constructor(workspace: string) {
    this.workspace = workspace;
    this.root_dir = join(workspace, "runtime", "security");
    this.key_path = join(this.root_dir, KEY_FILE);
    this.store_path = join(this.root_dir, STORE_FILE);
  }

  get_paths(): { root_dir: string; key_path: string; store_path: string } {
    return {
      root_dir: this.root_dir,
      key_path: this.key_path,
      store_path: this.store_path,
    };
  }

  async ensure_ready(): Promise<void> {
    await mkdir(this.root_dir, { recursive: true });
    await this.get_or_create_key();
    await this.ensure_store_file();
  }

  private async ensure_store_file(): Promise<void> {
    try {
      await readFile(this.store_path, "utf-8");
    } catch {
      const initial: SecretFile = { version: 1, secrets: {} };
      await writeFile(this.store_path, JSON.stringify(initial, null, 2), "utf-8");
    }
  }

  async get_or_create_key(): Promise<Buffer> {
    if (this.key_cache) return this.key_cache;
    await mkdir(dirname(this.key_path), { recursive: true });
    try {
      const raw = (await readFile(this.key_path, "utf-8")).trim();
      const bytes = b64url_decode(raw);
      if (bytes.length !== 32) throw new Error("invalid_key_length");
      this.key_cache = bytes;
      return bytes;
    } catch {
      const generated = randomBytes(32);
      await writeFile(this.key_path, b64url_encode(generated), "utf-8");
      this.key_cache = generated;
      return generated;
    }
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

  private async read_store(): Promise<SecretFile> {
    await this.ensure_ready();
    try {
      const raw = await readFile(this.store_path, "utf-8");
      const parsed = JSON.parse(raw) as SecretFile;
      const secrets = (parsed.secrets && typeof parsed.secrets === "object")
        ? (parsed.secrets as Record<string, SecretEntry>)
        : {};
      return {
        version: Number(parsed.version || 1),
        secrets,
      };
    } catch {
      return { version: 1, secrets: {} };
    }
  }

  private async write_store(next: SecretFile): Promise<void> {
    this.write_queue = this.write_queue.then(async () => {
      await writeFile(this.store_path, JSON.stringify(next, null, 2), "utf-8");
    });
    await this.write_queue;
  }

  async list_names(): Promise<string[]> {
    const store = await this.read_store();
    return Object.keys(store.secrets).sort((a, b) => a.localeCompare(b));
  }

  async put_secret(nameRaw: string, plaintext: string): Promise<{ ok: boolean; name: string }> {
    const name = normalize_secret_name(nameRaw);
    if (!name) return { ok: false, name: "" };
    const store = await this.read_store();
    const ciphertext = await this.encrypt_text(plaintext, `secret:${name}`);
    store.secrets[name] = {
      ciphertext,
      updated_at: now_iso(),
    };
    await this.write_store(store);
    return { ok: true, name };
  }

  async remove_secret(nameRaw: string): Promise<boolean> {
    const name = normalize_secret_name(nameRaw);
    if (!name) return false;
    const store = await this.read_store();
    if (!store.secrets[name]) return false;
    delete store.secrets[name];
    await this.write_store(store);
    return true;
  }

  async get_secret_cipher(nameRaw: string): Promise<string | null> {
    const name = normalize_secret_name(nameRaw);
    if (!name) return null;
    const store = await this.read_store();
    const row = store.secrets[name];
    if (!row) return null;
    return String(row.ciphertext || "").trim() || null;
  }

  async reveal_secret(nameRaw: string): Promise<string | null> {
    const name = normalize_secret_name(nameRaw);
    if (!name) return null;
    const store = await this.read_store();
    const row = store.secrets[name];
    if (!row?.ciphertext) return null;
    try {
      return await this.decrypt_text(row.ciphertext, `secret:${name}`);
    } catch {
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
    const store = await this.read_store();
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
      const row = store.secrets[name];
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
    const store = await this.read_store();

    const placeholder_re = /\{\{\s*secret:([a-zA-Z0-9_.-]+)\s*\}\}/g;
    let pm: RegExpExecArray | null = null;
    while (true) {
      pm = placeholder_re.exec(text);
      if (!pm) break;
      const name = normalize_secret_name(pm[1]);
      if (!name || !store.secrets[name]?.ciphertext) {
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

  async mask_known_secrets(input: string): Promise<string> {
    const text = String(input || "");
    if (!text) return "";
    const store = await this.read_store();
    let out = text;
    for (const [name, row] of Object.entries(store.secrets)) {
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

function escape_regexp(value: string): string {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
