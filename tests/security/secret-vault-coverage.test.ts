/**
 * SecretVaultService — 미커버 분기 보충.
 * - _load_or_generate_key: legacy DB 마이그레이션, legacy file 마이그레이션, invalid file length
 * - get_or_create_key: concurrent key_lock 경로
 * - resolve_placeholders_with_report: cache 재사용 (같은 이름 2회), invalid ciphertext 경로
 * - reveal_secret: decrypt 실패 → null
 * - prune_expired: inbound.* 오래된 시크릿 삭제 → invalidate_mask_cache 호출
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { SecretVaultService } from "@src/security/secret-vault.js";

// ── helpers ─────────────────────────────────────────────────────────────────

function b64url_encode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

let tmp_dir: string;
let vault: SecretVaultService;

beforeEach(async () => {
  tmp_dir = await mkdtemp(join(tmpdir(), "sv-cov-"));
});

afterEach(async () => {
  await rm(tmp_dir, { recursive: true, force: true }).catch(() => {});
});

// ══════════════════════════════════════════
// legacy DB 마이그레이션 (_load_or_generate_key L182-208)
// ══════════════════════════════════════════

describe("SecretVaultService — legacy DB migration (secrets.db → keyring.db)", () => {
  it("secrets.db의 master_key 테이블에서 키를 읽어 keyring.db로 이전", async () => {
    const security_dir = join(tmp_dir, "runtime", "security");
    await mkdir(security_dir, { recursive: true });

    // 정상 32바이트 마스터 키를 secrets.db에 미리 저장
    const raw_key = Buffer.alloc(32, 0xab);
    const key_b64url = b64url_encode(raw_key);

    const store_path = join(security_dir, "secrets.db");
    const db = new Database(store_path);
    db.exec(`
      CREATE TABLE master_key (
        id INTEGER PRIMARY KEY,
        key_b64url TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE secrets (
        name TEXT PRIMARY KEY,
        ciphertext TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    db.prepare("INSERT INTO master_key(id, key_b64url, created_at) VALUES (1, ?, datetime('now'))").run(key_b64url);
    db.close();

    vault = new SecretVaultService(tmp_dir);
    const key = await vault.get_or_create_key();

    // 마이그레이션된 키가 원본과 동일해야 함
    expect(key.length).toBe(32);
    expect(key.toString("hex")).toBe(raw_key.toString("hex"));

    // 이후 secrets.db에는 master_key 테이블이 없어야 함
    const store_db = new Database(store_path);
    const table_check = store_db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='master_key'"
    ).get();
    store_db.close();
    expect(table_check).toBeUndefined();
  });
});

// ══════════════════════════════════════════
// legacy file 마이그레이션 (master.key → keyring.db)
// ══════════════════════════════════════════

describe("SecretVaultService — legacy file migration (master.key)", () => {
  it("master.key 파일에서 키를 읽어 keyring.db로 이전 후 파일 삭제", async () => {
    const security_dir = join(tmp_dir, "runtime", "security");
    await mkdir(security_dir, { recursive: true });

    const raw_key = Buffer.alloc(32, 0xcc);
    const key_b64url = b64url_encode(raw_key);

    // master.key 파일 미리 생성 (keyring.db는 없는 상태)
    await writeFile(join(security_dir, "master.key"), key_b64url, "utf-8");

    vault = new SecretVaultService(tmp_dir);
    const key = await vault.get_or_create_key();

    expect(key.length).toBe(32);
    expect(key.toString("hex")).toBe(raw_key.toString("hex"));
  });

  it("master.key 파일의 키 길이가 32바이트가 아니면 새 키 생성 (catch → randomBytes)", async () => {
    const security_dir = join(tmp_dir, "runtime", "security");
    await mkdir(security_dir, { recursive: true });

    // 잘못된 길이: 16바이트짜리 키를 b64url로 인코딩
    // _load_or_generate_key 에서 invalid_key_length catch → 새 키 생성
    const bad_key = Buffer.alloc(16, 0x01);
    const key_b64url = b64url_encode(bad_key);
    await writeFile(join(security_dir, "master.key"), key_b64url, "utf-8");

    vault = new SecretVaultService(tmp_dir);
    const key = await vault.get_or_create_key();
    // 에러 없이 32바이트 새 키 생성됨
    expect(key.length).toBe(32);
  });
});

// ══════════════════════════════════════════
// get_or_create_key — concurrent 경로 (key_lock)
// ══════════════════════════════════════════

describe("SecretVaultService — concurrent get_or_create_key (key_lock 경로)", () => {
  it("동시에 두 번 호출해도 같은 키 반환 (race 없음)", async () => {
    vault = new SecretVaultService(tmp_dir);
    const [k1, k2] = await Promise.all([vault.get_or_create_key(), vault.get_or_create_key()]);
    expect(k1.length).toBe(32);
    expect(k1.toString("hex")).toBe(k2.toString("hex"));
  });

  it("첫 호출 완료 후 두 번째 호출 → key_cache 경로 (빠른 반환)", async () => {
    vault = new SecretVaultService(tmp_dir);
    const k1 = await vault.get_or_create_key(); // 캐시 초기화
    const k2 = await vault.get_or_create_key(); // key_cache 히트
    expect(k1.toString("hex")).toBe(k2.toString("hex"));
  });
});

// ══════════════════════════════════════════
// resolve_placeholders_with_report — cache 재사용
// ══════════════════════════════════════════

describe("SecretVaultService — resolve_placeholders_with_report cache 재사용", () => {
  beforeEach(async () => {
    vault = new SecretVaultService(tmp_dir);
    await vault.ensure_ready();
  });

  it("같은 이름 2회 참조 → cache 히트 분기 통과, 두 곳 모두 복호화됨", async () => {
    await vault.put_secret("dup_key", "dup-value-xyz");
    const report = await vault.resolve_placeholders_with_report(
      "a={{secret:dup_key}} b={{secret:dup_key}}"
    );
    expect(report.text).toContain("dup-value-xyz");
    // 두 곳 모두 치환되어야 함
    expect(report.text.split("dup-value-xyz").length - 1).toBe(2);
    expect(report.missing_keys).toHaveLength(0);
    expect(report.invalid_ciphertexts).toHaveLength(0);
  });

  it("잘못된 ciphertext 직접 DB 삽입 → invalid_ciphertexts에 포함", async () => {
    const security_dir = join(tmp_dir, "runtime", "security");
    await mkdir(security_dir, { recursive: true });
    // 먼저 vault를 준비시켜 DB 스키마 생성
    await vault.ensure_ready();

    const store_path = vault.get_paths().store_path;
    // 잘못된 ciphertext (올바른 sv1 형식이지만 다른 키로 암호화됨)
    const bad_cipher = "sv1.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA.AAAA";
    const db = new Database(store_path);
    db.prepare("INSERT OR REPLACE INTO secrets(name, ciphertext, updated_at) VALUES (?, ?, datetime('now'))").run(
      "bad_secret",
      bad_cipher
    );
    db.close();

    const report = await vault.resolve_placeholders_with_report("x={{secret:bad_secret}}");
    // ciphertext가 store에 있으므로 missing_keys는 비어있고
    // decrypt 실패 → invalid_ciphertexts에 포함
    expect(report.invalid_ciphertexts.length).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════
// reveal_secret — decrypt 실패 → null
// ══════════════════════════════════════════

describe("SecretVaultService — reveal_secret decrypt 실패", () => {
  beforeEach(async () => {
    vault = new SecretVaultService(tmp_dir);
    await vault.ensure_ready();
  });

  it("DB에 잘못된 ciphertext 삽입 → reveal_secret이 null 반환", async () => {
    const store_path = vault.get_paths().store_path;
    const db = new Database(store_path);
    db.prepare("INSERT OR REPLACE INTO secrets(name, ciphertext, updated_at) VALUES (?, ?, datetime('now'))").run(
      "bad_reveal",
      "sv1.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA.AAAA"
    );
    db.close();

    const result = await vault.reveal_secret("bad_reveal");
    expect(result).toBeNull();
  });
});

// ══════════════════════════════════════════
// prune_expired — 오래된 inbound.* 시크릿 삭제
// ══════════════════════════════════════════

describe("SecretVaultService — prune_expired 오래된 시크릿 삭제", () => {
  beforeEach(async () => {
    vault = new SecretVaultService(tmp_dir);
    await vault.ensure_ready();
  });

  it("오래된 updated_at으로 삽입된 inbound.* → prune 후 삭제됨", async () => {
    const store_path = vault.get_paths().store_path;
    const old_date = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(); // 30일 전

    const db = new Database(store_path);
    db.prepare("INSERT OR REPLACE INTO secrets(name, ciphertext, updated_at) VALUES (?, ?, ?)").run(
      "inbound.old_secret",
      "sv1.placeholder.placeholder.placeholder",
      old_date
    );
    db.close();

    // 10초보다 오래된 것 삭제 (30일 전이므로 무조건 삭제됨)
    const deleted = await vault.prune_expired(10_000);
    expect(deleted).toBeGreaterThan(0);

    // 삭제 후 해당 시크릿 없음
    const names = await vault.list_names();
    expect(names).not.toContain("inbound.old_secret");
  });

  it("삭제 후 mask_cache 무효화 → 다음 mask_known_secrets 재생성", async () => {
    const store_path = vault.get_paths().store_path;
    // mask_cache 초기화를 위해 mask_known_secrets 한 번 호출
    await vault.put_secret("inbound.fresh", "fresh-value");
    await vault.mask_known_secrets("test text");

    const old_date = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const db = new Database(store_path);
    db.prepare("INSERT OR REPLACE INTO secrets(name, ciphertext, updated_at) VALUES (?, ?, ?)").run(
      "inbound.expired_one",
      "sv1.placeholder.placeholder.placeholder",
      old_date
    );
    db.close();

    await vault.prune_expired(10_000); // invalidate_mask_cache 호출됨
    // 에러 없이 완료되면 OK
    const result = await vault.mask_known_secrets("fresh-value should be masked");
    expect(result).toContain("[REDACTED:SECRET]");
  });
});

// ══════════════════════════════════════════
// resolve_inline_secrets_with_report — sv1 토큰 직접 포함
// ══════════════════════════════════════════

describe("SecretVaultService — resolve_inline_secrets_with_report sv1 direct token", () => {
  beforeEach(async () => {
    vault = new SecretVaultService(tmp_dir);
    await vault.ensure_ready();
  });

  it("텍스트 안에 sv1 토큰 직접 포함 → 복호화됨", async () => {
    const plain = "direct-inline-secret";
    const token = await vault.encrypt_text(plain); // no AAD → decrypt without AAD
    const report = await vault.resolve_inline_secrets_with_report(`prefix ${token} suffix`);
    expect(report.text).toContain(plain);
    expect(report.invalid_ciphertexts).toHaveLength(0);
  });

  it("텍스트 안에 복호화 불가 sv1 토큰 → invalid_ciphertexts에 포함", async () => {
    // 다른 vault 인스턴스(다른 키)로 암호화된 토큰 시뮬레이션:
    // AAD 불일치로 복호화 실패
    const plain = "secret-with-aad";
    const token = await vault.encrypt_text(plain, "specific-aad");
    // token을 decrypt 시 AAD 없이 시도 → 실패 → invalid_ciphertexts
    const report = await vault.resolve_inline_secrets_with_report(`data: ${token}`);
    // AAD 없이 decrypt하면 실패 → invalid에 추가됨
    expect(report.invalid_ciphertexts).toContain(token);
  });
});
