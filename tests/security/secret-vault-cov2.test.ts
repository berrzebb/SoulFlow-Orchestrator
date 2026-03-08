/**
 * SecretVaultService — 미커버 분기 보충.
 * put_secret/remove_secret/get_secret_cipher/reveal_secret 빈 이름 → early return,
 * is_valid_ciphertext_shape 다양한 실패 모드,
 * get_mask_plaintexts 캐시 히트 + 짧은 plaintext 필터,
 * resolve_placeholders_with_report: 이름이 빈 placeholder, sv1 미포함 조기 반환,
 * inspect_secret_references: 직접 sv1 토큰 유효 형식 → invalid 아님.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SecretVaultService } from "@src/security/secret-vault.js";

let workspace: string;
let vault: SecretVaultService;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "sv-cov2-"));
  vault = new SecretVaultService(workspace);
  await vault.ensure_ready();
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true }).catch(() => {});
});

// ══════════════════════════════════════════
// 빈 이름 early return 경로
// ══════════════════════════════════════════

describe("SecretVaultService — 빈 이름 early return 분기", () => {
  it("put_secret 빈 이름 → ok:false, name:''", async () => {
    const r = await vault.put_secret("", "value");
    expect(r.ok).toBe(false);
    expect(r.name).toBe("");
  });

  it("put_secret 공백만 있는 이름 → ok:false", async () => {
    const r = await vault.put_secret("   ", "value");
    expect(r.ok).toBe(false);
  });

  it("remove_secret 빈 이름 → false", async () => {
    const r = await vault.remove_secret("");
    expect(r).toBe(false);
  });

  it("get_secret_cipher 빈 이름 → null", async () => {
    const r = await vault.get_secret_cipher("");
    expect(r).toBeNull();
  });

  it("reveal_secret 빈 이름 → null", async () => {
    const r = await vault.reveal_secret("");
    expect(r).toBeNull();
  });
});

// ══════════════════════════════════════════
// get_mask_plaintexts — 캐시 히트
// ══════════════════════════════════════════

describe("SecretVaultService — mask_known_secrets 캐시 히트", () => {
  it("연속 두 번 호출 시 두 번째는 캐시 사용 (같은 결과)", async () => {
    await vault.put_secret("cache-test-key", "super-secret-value");

    const r1 = await vault.mask_known_secrets("super-secret-value로 확인");
    const r2 = await vault.mask_known_secrets("super-secret-value로 재확인");

    expect(r1).toContain("[REDACTED:SECRET]");
    expect(r2).toContain("[REDACTED:SECRET]");
  });

  it("짧은 plaintext(3자 이하)는 마스킹에서 제외", async () => {
    // 4자 미만 값은 get_mask_plaintexts에서 필터됨
    await vault.put_secret("short-val", "abc");
    const r = await vault.mask_known_secrets("abc는 짧아서 마스킹 안 됨");
    // "abc" 3자이므로 마스킹 안 됨 (plain.length < 4 조건)
    expect(r).toContain("abc");
    expect(r).not.toContain("[REDACTED:SECRET]");
  });
});

// ══════════════════════════════════════════
// resolve_placeholders_with_report — sv1 미포함 조기 반환
// ══════════════════════════════════════════

describe("SecretVaultService — resolve_placeholders_with_report sv1 미포함 조기 반환", () => {
  it("missing 키 참조 → sv1 없음 → 조기 반환 (빠른 경로)", async () => {
    // {{secret:nonexistent}}는 ciphertext가 없으므로 그대로 남음 → sv1 미포함
    const report = await vault.resolve_placeholders_with_report("hello {{secret:nonexistent}}");
    expect(report.missing_keys).toContain("nonexistent");
    expect(report.invalid_ciphertexts).toHaveLength(0);
    // text에 sv1 토큰 없음 → 조기 반환 경로
    expect(report.text).toContain("{{secret:nonexistent}}");
  });
});

// ══════════════════════════════════════════
// resolve_placeholders_with_report — 캐시 재사용 (같은 이름 2회)
// ══════════════════════════════════════════

describe("SecretVaultService — resolve_placeholders cache 재사용 경로", () => {
  it("같은 placeholder 2회 참조 → cache.get 히트 → 같은 값 대체됨", async () => {
    await vault.put_secret("dup-key", "duplicate-secret-value");
    const input = "{{secret:dup-key}} and {{secret:dup-key}} again";
    const report = await vault.resolve_placeholders_with_report(input);
    // 두 곳 모두 대체
    const count = (report.text.match(/duplicate-secret-value/g) || []).length;
    expect(count).toBe(2);
  });
});

// ══════════════════════════════════════════
// inspect_secret_references — 유효한 sv1 형식 → invalid 아님
// ══════════════════════════════════════════

describe("SecretVaultService — inspect_secret_references 유효한 sv1 토큰", () => {
  it("정상 암호화된 sv1 토큰 → invalid_ciphertexts에 포함 안 됨", async () => {
    await vault.put_secret("inspect-key", "inspect-value");
    const cipher = await vault.get_secret_cipher("inspect-key");
    expect(cipher).not.toBeNull();

    const result = await vault.inspect_secret_references(cipher!);
    // 유효한 형식의 sv1 토큰은 invalid_ciphertexts에 포함 안 됨
    expect(result.invalid_ciphertexts).toHaveLength(0);
  });

  it("잘못된 형식 sv1 토큰 → invalid_ciphertexts에 포함됨", async () => {
    // sv1 형식이지만 실제로는 유효하지 않은 토큰
    const fake = "sv1.AAAA.BBBBBBBBBBBBBBBBBBBB.CCCC"; // wrong iv/tag lengths
    const result = await vault.inspect_secret_references(fake);
    expect(result.invalid_ciphertexts).toContain(fake);
  });
});

// ══════════════════════════════════════════
// resolve_inline_secrets — placeholder 없고 sv1 없으면 그대로
// ══════════════════════════════════════════

describe("SecretVaultService — resolve_inline_secrets_with_report: placeholder + sv1 없음", () => {
  it("일반 텍스트 → 변경 없이 반환", async () => {
    const report = await vault.resolve_inline_secrets_with_report("just plain text here");
    expect(report.text).toBe("just plain text here");
    expect(report.missing_keys).toHaveLength(0);
    expect(report.invalid_ciphertexts).toHaveLength(0);
  });
});

// ══════════════════════════════════════════
// decrypt_text — 잘못된 형식 → throw
// ══════════════════════════════════════════

describe("SecretVaultService — decrypt_text 잘못된 형식", () => {
  it("sv1 형식이 아닌 토큰 → Error throw", async () => {
    await expect(vault.decrypt_text("not.a.valid.token.format")).rejects.toThrow("invalid_ciphertext_format");
  });

  it("parts.length < 4 → Error throw", async () => {
    await expect(vault.decrypt_text("sv1.abc.def")).rejects.toThrow("invalid_ciphertext_format");
  });
});

// ══════════════════════════════════════════
// normalize_secret_name — 특수문자 → 언더스코어 치환
// ══════════════════════════════════════════

describe("SecretVaultService — 특수문자 이름 정규화 후 저장", () => {
  it("이름에 특수문자 포함 → 정규화 후 저장됨", async () => {
    const r = await vault.put_secret("MY SECRET KEY!", "value");
    expect(r.ok).toBe(true);
    // normalize: "my_secret_key_"
    expect(r.name).toMatch(/^[a-z0-9_.-]+$/);
  });

  it("list_names: 정규화된 이름 반환", async () => {
    await vault.put_secret("Test-Key_1", "val");
    const names = await vault.list_names();
    // "test-key_1" — 소문자, 하이픈 유지
    expect(names.some((n) => n.includes("test"))).toBe(true);
  });
});

// ══════════════════════════════════════════
// encrypt_text — AAD 경로
// ══════════════════════════════════════════

describe("SecretVaultService — encrypt_text AAD 경로", () => {
  it("aad 없이 암호화 → 복호화 성공", async () => {
    const cipher = await vault.encrypt_text("hello world");
    const plain = await vault.decrypt_text(cipher);
    expect(plain).toBe("hello world");
  });

  it("aad 있으면 같은 aad로만 복호화 가능", async () => {
    const cipher = await vault.encrypt_text("secret", "context:A");
    const plain = await vault.decrypt_text(cipher, "context:A");
    expect(plain).toBe("secret");
    // 다른 aad → 실패
    await expect(vault.decrypt_text(cipher, "context:B")).rejects.toThrow();
  });
});
