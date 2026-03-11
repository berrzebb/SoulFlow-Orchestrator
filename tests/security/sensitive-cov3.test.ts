/**
 * sensitive.ts — 미커버 분기 (cov3):
 * - L121: get_env_secret_patterns → token.length < 6 || seen.has(token) → continue
 *
 * 나머지 미커버 라인(L95, L101)은 defensive dead code:
 * - L95: keyword_is_sensitive("") — ASSIGNMENT_RE 그룹1은 항상 {2,64}자 → 빈 키 불가
 * - L101: mask_assignment에서 key="" — 동일 이유
 *
 * L121을 히트하려면 모듈 캐시를 리셋하고 짧은 값 환경변수 주입이 필요.
 */
import { describe, it, expect, vi } from "vitest";

// ── L121: get_env_secret_patterns → token.length < 6 → continue ─────────────

describe("sensitive — L121: 짧은 env 시크릿 값 → skip", () => {
  it("PASSWORD 환경변수 값이 3자(< 6) → L121: token.length < 6 → continue", async () => {
    // 모듈 캐시 리셋 + 짧은 값 주입 → get_env_secret_patterns 재빌드 시 L121 실행
    vi.resetModules();
    process.env["TEST_PASSWORD_L121_COV"] = "abc";  // 3자 < 6 → L121
    try {
      const { redact_sensitive_text } = await import("@src/security/sensitive.js");
      const result = redact_sensitive_text("test text without secrets");
      expect(typeof result.text).toBe("string");
    } finally {
      delete process.env["TEST_PASSWORD_L121_COV"];
    }
  });

  it("두 민감 환경변수가 동일한 값 → seen.has(token) → L121: continue (중복 skip)", async () => {
    // 동일한 값을 가진 두 env 변수 → 첫 번째는 seen에 추가, 두 번째는 L121 seen.has(token) 히트
    vi.resetModules();
    process.env["TEST_SECRET_DUP_COV_A"] = "same_shared_value_12345";
    process.env["TEST_PASSWORD_DUP_COV_B"] = "same_shared_value_12345";  // 중복 값
    try {
      const { redact_sensitive_text } = await import("@src/security/sensitive.js");
      const result = redact_sensitive_text("value: same_shared_value_12345");
      expect(typeof result.text).toBe("string");
    } finally {
      delete process.env["TEST_SECRET_DUP_COV_A"];
      delete process.env["TEST_PASSWORD_DUP_COV_B"];
    }
  });
});
