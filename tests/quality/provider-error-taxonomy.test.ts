import { describe, it, expect } from "vitest";
import {
  classify_provider_error,
  from_pty_error_code,
  PROVIDER_ERROR_LABELS,
  type ProviderErrorCode,
} from "@src/quality/provider-error-taxonomy.ts";

describe("classify_provider_error — 에러 메시지 → ProviderErrorCode", () => {
  const cases: Array<[string, string, ProviderErrorCode]> = [
    ["auth_invalid: API key", "Invalid API key", "auth_invalid"],
    ["auth_invalid: unauthorized", "Unauthorized access", "auth_invalid"],
    ["auth_invalid: authentication fail", "authentication failed", "auth_invalid"],
    ["billing_exceeded: billing", "billing limit exceeded", "billing_exceeded"],
    ["billing_exceeded: quota", "quota exceeded for this month", "billing_exceeded"],
    ["billing_exceeded: insufficient funds", "Insufficient funds", "billing_exceeded"],
    ["rate_limited: rate limit", "Rate limit hit", "rate_limited"],
    ["rate_limited: too many requests", "Too many requests per minute", "rate_limited"],
    ["context_overflow: context", "Context overflow detected", "context_overflow"],
    ["context_overflow: token limit", "token limit reached", "context_overflow"],
    ["context_overflow: prompt too large", "prompt too large for model", "context_overflow"],
    ["model_unavailable: failover", "failover to backup model", "model_unavailable"],
    ["model_unavailable: overloaded", "model overloaded", "model_unavailable"],
    ["model_unavailable: service unavailable", "service unavailable", "model_unavailable"],
    ["provider_crash: internal server error", "500 Internal Server Error", "provider_crash"],
    ["provider_crash: fatal", "fatal process exit", "provider_crash"],
    ["network_error: timeout", "connection timeout", "network_error"],
    ["network_error: econnreset", "ECONNRESET", "network_error"],
    ["unknown: empty", "", "unknown"],
    ["unknown: unrecognized", "something went very wrong here", "unknown"],
  ];

  for (const [label, message, expected] of cases) {
    it(label, () => {
      expect(classify_provider_error(message)).toBe(expected);
    });
  }

  it("code 파라미터도 함께 분류에 사용", () => {
    // message에는 단서가 없지만 code에 "billing"이 있으면 감지
    expect(classify_provider_error("unexpected failure", "billing")).toBe("billing_exceeded");
  });
});

describe("from_pty_error_code — PTY ErrorCode → ProviderErrorCode 하위 호환", () => {
  const cases: Array<[string, ProviderErrorCode]> = [
    ["auth", "auth_invalid"],
    ["billing", "billing_exceeded"],
    ["rate_limit", "rate_limited"],
    ["token_limit", "context_overflow"],
    ["buffer_overflow", "context_overflow"],
    ["failover", "model_unavailable"],
    ["crash", "provider_crash"],
    ["timeout", "network_error"],
    ["fatal", "unknown"],
  ];

  for (const [pty_code, expected] of cases) {
    it(`${pty_code} → ${expected}`, () => {
      expect(from_pty_error_code(pty_code)).toBe(expected);
    });
  }

  it("알 수 없는 PTY 코드 → unknown", () => {
    expect(from_pty_error_code("nonexistent_code")).toBe("unknown");
  });
});

describe("PROVIDER_ERROR_LABELS — 모든 코드에 레이블 존재", () => {
  const all_codes: ProviderErrorCode[] = [
    "auth_invalid", "billing_exceeded", "rate_limited", "context_overflow",
    "model_unavailable", "provider_crash", "network_error", "unknown",
  ];

  it("모든 ProviderErrorCode에 레이블이 있음", () => {
    for (const code of all_codes) {
      expect(PROVIDER_ERROR_LABELS[code]).toBeTruthy();
    }
  });
});
