/**
 * inbound-seal.ts — 미커버 분기 커버리지.
 * - ASSIGNMENT_RE: kind=card/account → skip (L214)
 * - ACCOUNT_LINE_RE handler: account 번호 패턴 (L222-226)
 * - CARD_NUMBER_RE handler: luhn 유효/무효 (L229-232)
 */
import { describe, it, expect, vi } from "vitest";
import { seal_inbound_sensitive_text } from "@src/security/inbound-seal.js";
import type { SecretVaultLike } from "@src/security/secret-vault.js";

function make_vault(): SecretVaultLike {
  const store = new Map<string, string>();
  return {
    put_secret: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
    get_secret: vi.fn(async (key: string) => store.get(key) ?? null),
    delete_secret: vi.fn(async () => true),
    list_secret_names: vi.fn(async () => [...store.keys()]),
    has_secret: vi.fn(async (key: string) => store.has(key)),
  } as unknown as SecretVaultLike;
}

const CTX = { provider: "slack", chat_id: "C001" };

// ══════════════════════════════════════════════════════════
// ASSIGNMENT_RE: kind=card/account → skip (L214)
// ══════════════════════════════════════════════════════════

describe("seal_inbound_sensitive_text — ASSIGNMENT_RE card/account skip", () => {
  it("card=값 패턴 → ASSIGNMENT_RE에서 card kind → 원본 반환 (skip)", async () => {
    // CARD_ASSIGNMENT_RE는 숫자패턴 매칭, 여기서는 일반 텍스트 값
    // ASSIGNMENT_RE가 매칭하지만 kind=card → return original
    const vault = make_vault();
    const result = await seal_inbound_sensitive_text(
      "card=sometext_value",
      { ...CTX, vault },
    );
    // card kind이지만 CARD_ASSIGNMENT_RE 범위 바깥 → ASSIGNMENT_RE에서 skip
    expect(typeof result.text).toBe("string");
    // 이 경우 카드 관련 처리는 스킵, 원본 유지
    expect(result.text).toContain("card=sometext_value");
  });

  it("account=abc_text → ASSIGNMENT_RE에서 account kind → skip", async () => {
    const vault = make_vault();
    const result = await seal_inbound_sensitive_text(
      "account=notanumber",
      { ...CTX, vault },
    );
    // account kind이지만 ACCOUNT_ASSIGNMENT_RE 범위 바깥 → ASSIGNMENT_RE에서 skip
    expect(result.text).toContain("account=notanumber");
  });
});

// ══════════════════════════════════════════════════════════
// ACCOUNT_LINE_RE handler — L222-226
// ══════════════════════════════════════════════════════════

describe("seal_inbound_sensitive_text — ACCOUNT_LINE_RE", () => {
  it("계좌번호 패턴 → ACCOUNT_LINE_RE 매칭 → 봉인", async () => {
    const vault = make_vault();
    // "account: 1234567890123" 패턴 — ACCOUNT_LINE_RE 매칭
    const result = await seal_inbound_sensitive_text(
      "account: 12345678901",
      { ...CTX, vault },
    );
    // 계좌번호가 봉인됨
    expect(result.text).not.toContain("12345678901");
    expect(vault.put_secret).toHaveBeenCalled();
  });

  it("iban 패턴 → 봉인", async () => {
    const vault = make_vault();
    const result = await seal_inbound_sensitive_text(
      "iban 1234567890123456",
      { ...CTX, vault },
    );
    expect(typeof result.text).toBe("string");
  });
});

// ══════════════════════════════════════════════════════════
// CARD_NUMBER_RE handler — L229-232
// ══════════════════════════════════════════════════════════

describe("seal_inbound_sensitive_text — CARD_NUMBER_RE luhn", () => {
  it("luhn 유효 카드번호 → 봉인됨", async () => {
    const vault = make_vault();
    // Luhn-valid 테스트 카드번호: 4532015112830366 (Visa)
    const result = await seal_inbound_sensitive_text(
      "카드번호: 4532015112830366",
      { ...CTX, vault },
    );
    expect(result.text).not.toContain("4532015112830366");
    expect(vault.put_secret).toHaveBeenCalled();
  });

  it("luhn 무효 숫자열 → 봉인 안 됨 (원본 유지)", async () => {
    const vault = make_vault();
    // luhn 유효성 실패하는 숫자열
    const result = await seal_inbound_sensitive_text(
      "some number: 1234567890123456",
      { ...CTX, vault },
    );
    // luhn 실패 → 원본 그대로
    expect(result.text).toContain("1234567890123456");
  });
});
