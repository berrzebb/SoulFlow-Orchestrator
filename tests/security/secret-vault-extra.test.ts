/**
 * SecretVaultService — resolve_inline_secrets, inspect_secret_references,
 * resolve_placeholders_with_report, prune_expired, mask_known_secrets 추가 테스트.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SecretVaultService } from "@src/security/secret-vault.ts";

describe("SecretVaultService — 확장 메서드", () => {
  let tmp_dir: string;
  let vault: SecretVaultService;

  beforeEach(async () => {
    tmp_dir = await mkdtemp(join(tmpdir(), "sv-extra-"));
    vault = new SecretVaultService(tmp_dir);
  });

  afterEach(async () => {
    await rm(tmp_dir, { recursive: true, force: true }).catch(() => {});
  });

  // ── resolve_placeholders_with_report ──

  it("resolve_placeholders_with_report: 없는 키 → missing_keys에 포함", async () => {
    const report = await vault.resolve_placeholders_with_report("value={{secret:missing_key}}");
    expect(report.missing_keys).toContain("missing_key");
  });

  it("resolve_placeholders_with_report: placeholder 없음 → 원문 그대로", async () => {
    const report = await vault.resolve_placeholders_with_report("no secrets here");
    expect(report.text).toBe("no secrets here");
    expect(report.missing_keys).toEqual([]);
    expect(report.invalid_ciphertexts).toEqual([]);
  });

  it("resolve_placeholders_with_report: 저장된 시크릿 → 복호화됨", async () => {
    await vault.put_secret("my_token", "secret-value-xyz");
    const report = await vault.resolve_placeholders_with_report("token={{secret:my_token}}");
    expect(report.text).toContain("secret-value-xyz");
    expect(report.missing_keys).toEqual([]);
  });

  it("resolve_placeholders_with_report: 빈 문자열", async () => {
    const report = await vault.resolve_placeholders_with_report("");
    expect(report.text).toBe("");
    expect(report.missing_keys).toEqual([]);
  });

  // ── resolve_inline_secrets ──

  it("resolve_inline_secrets: 일반 텍스트 → 그대로 반환", async () => {
    const result = await vault.resolve_inline_secrets("hello world");
    expect(result).toBe("hello world");
  });

  it("resolve_inline_secrets: placeholder 포함 → 복호화", async () => {
    await vault.put_secret("api_key", "my-api-key-123");
    const result = await vault.resolve_inline_secrets("key={{secret:api_key}}");
    expect(result).toContain("my-api-key-123");
  });

  it("resolve_inline_secrets_with_report: 반환 구조 검증", async () => {
    const report = await vault.resolve_inline_secrets_with_report("plain text");
    expect(report).toHaveProperty("text");
    expect(report).toHaveProperty("missing_keys");
    expect(report).toHaveProperty("invalid_ciphertexts");
  });

  // ── inspect_secret_references ──

  it("inspect_secret_references: 빈 문자열 → 빈 객체", async () => {
    const result = await vault.inspect_secret_references("");
    expect(result.missing_keys).toEqual([]);
    expect(result.invalid_ciphertexts).toEqual([]);
  });

  it("inspect_secret_references: 없는 키 참조 → missing_keys", async () => {
    const result = await vault.inspect_secret_references("{{secret:nonexistent}}");
    expect(result.missing_keys).toContain("nonexistent");
  });

  it("inspect_secret_references: 존재하는 키 참조 → missing_keys 없음", async () => {
    await vault.put_secret("existing_key", "value");
    const result = await vault.inspect_secret_references("{{secret:existing_key}}");
    expect(result.missing_keys).not.toContain("existing_key");
  });

  it("inspect_secret_references: placeholder 없음 → 비어있음", async () => {
    const result = await vault.inspect_secret_references("no placeholders here");
    expect(result.missing_keys).toEqual([]);
    expect(result.invalid_ciphertexts).toEqual([]);
  });

  // ── remove_secret ──

  it("remove_secret: 존재하는 시크릿 제거 → true", async () => {
    await vault.put_secret("to_remove", "value");
    const removed = await vault.remove_secret("to_remove");
    expect(removed).toBe(true);
    expect(await vault.reveal_secret("to_remove")).toBeNull();
  });

  it("remove_secret: 존재하지 않는 키 → false", async () => {
    const removed = await vault.remove_secret("ghost_key");
    expect(removed).toBe(false);
  });

  // ── prune_expired ──

  it("prune_expired: 최근 시크릿은 삭제 안 됨", async () => {
    await vault.put_secret("inbound.recent", "value");
    const count = await vault.prune_expired(60_000 * 60 * 24); // 24시간
    expect(count).toBe(0);
    expect(await vault.reveal_secret("inbound.recent")).toBe("value");
  });

  it("prune_expired: 결과는 숫자 타입", async () => {
    const count = await vault.prune_expired(60_000);
    expect(typeof count).toBe("number");
    expect(count).toBeGreaterThanOrEqual(0);
  });

  // ── encrypt/decrypt ──

  it("encrypt_text + decrypt_text: 라운드트립", async () => {
    const plain = "hello secret world";
    const cipher = await vault.encrypt_text(plain);
    expect(cipher.startsWith("sv1.")).toBe(true);
    const decrypted = await vault.decrypt_text(cipher);
    expect(decrypted).toBe(plain);
  });

  it("encrypt_text: AAD로 암호화하면 다른 AAD로 복호화 실패", async () => {
    const plain = "secure data";
    const cipher = await vault.encrypt_text(plain, "aad-1");
    await expect(vault.decrypt_text(cipher, "aad-2")).rejects.toThrow();
  });
});
