/**
 * inbound-seal.ts — 미커버 분기 (cov3):
 * - L158: seal_value → plain.trim().length < 4 → 짧은 값 봉인 건너뜀
 *
 * 나머지 미커버 라인(L96, L109, L139, L224)은 defensive dead code:
 * - L96: keyword_kind("") — ASSIGNMENT_RE 그룹1은 항상 {2,80}자 → 빈 키 불가
 * - L109: luhn_valid 자릿수 부족 — CARD_NUMBER_RE는 13-19자리 보장
 * - L139: zero-length match guard — 사용되는 regex는 zero-length 매칭 없음
 * - L224: raw_number 빈 문자열 — ACCOUNT_LINE_RE 그룹1은 최소 8자리 보장
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

// ── L158: plain.trim().length < 4 → 짧은 값 봉인 건너뜀 ─────────────────────

describe("seal_inbound_sensitive_text — L158: 짧은 quoted 값 봉인 건너뜀", () => {
  it("password=\"ab\" → 내부 값 2자 < 4 → L158: 봉인하지 않고 그대로 반환", async () => {
    // ASSIGNMENT_RE: password=<quoted_value> → kind=password → unwrap_quoted → inner="ab"
    // seal_value("ab"): plain.trim().length=2 < 4 → L158 실행 → 원본 반환
    const vault = make_vault();
    const result = await seal_inbound_sensitive_text(
      'password = "ab"',
      { ...CTX, vault },
    );
    // 값이 너무 짧아 봉인 건너뜀 → put_secret 호출 안 됨
    expect(vault.put_secret).not.toHaveBeenCalled();
    expect(result.hits).toHaveLength(0);
  });

  it("token='x' → 내부 값 1자 < 4 → L158: 봉인하지 않고 원본 유지", async () => {
    // ASSIGNMENT_RE: token='x' → kind=token → unwrap_quoted → inner="x"
    // seal_value("x"): plain.trim().length=1 < 4 → L158 실행
    const vault = make_vault();
    const result = await seal_inbound_sensitive_text(
      "token = 'x'",
      { ...CTX, vault },
    );
    expect(vault.put_secret).not.toHaveBeenCalled();
    expect(result.hits).toHaveLength(0);
  });

  it("password=longvalue → 긴 값 → L158 건너뜀 → 정상 봉인", async () => {
    // 값이 4자 이상이면 L158 건너뜀 → 정상 봉인 진행
    const vault = make_vault();
    const result = await seal_inbound_sensitive_text(
      "password=supersecretvalue",
      { ...CTX, vault },
    );
    expect(vault.put_secret).toHaveBeenCalled();
    expect(result.hits.length).toBeGreaterThan(0);
  });
});
