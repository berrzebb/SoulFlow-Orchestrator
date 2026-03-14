/**
 * F1: Provider Error Taxonomy.
 *
 * PTY, SDK, 채널 간 공유되는 안정적인 에러 분류 코드.
 * 개별 어댑터의 ad-hoc 문자열 비교를 한 곳으로 통합하여
 * 공급자 간 에러를 일관되게 비교·보고할 수 있게 한다.
 */

/** 공급자/런타임 에러 분류 코드. */
export type ProviderErrorCode =
  | "auth_invalid"        // API 키 무효, 인증 실패
  | "billing_exceeded"    // 청구 한도, 잔액 부족
  | "rate_limited"        // 요청 속도 제한, too_many_requests
  | "context_overflow"    // 토큰 한도, 컨텍스트 초과, buffer overflow
  | "model_unavailable"   // 모델 오버로드, failover, 서비스 일시 중단
  | "provider_crash"      // 예상치 못한 종료, 5xx, fatal
  | "network_error"       // 타임아웃, 연결 실패, ECONNRESET
  | "unknown";            // 분류 불가

/** 사용자/채널 표시용 레이블. 내부 코드와 분리. */
export const PROVIDER_ERROR_LABELS: Record<ProviderErrorCode, string> = {
  auth_invalid: "인증 오류",
  billing_exceeded: "청구 한도 초과",
  rate_limited: "요청 속도 제한",
  context_overflow: "컨텍스트 한도 초과",
  model_unavailable: "모델 사용 불가",
  provider_crash: "공급자 오류",
  network_error: "네트워크 오류",
  unknown: "알 수 없는 오류",
};

/**
 * 에러 메시지 + 선택적 코드 → ProviderErrorCode.
 * 세 어댑터(claude/codex/gemini)의 중복 map_*_error_code()를 통합.
 */
export function classify_provider_error(message: string, code?: string): ProviderErrorCode {
  const src = (message + " " + (code ?? "")).toLowerCase();

  if (/invalid.*api.*key|unauthorized|authentication.*fail|invalid.*token/i.test(src))
    return "auth_invalid";
  if (/billing|quota.*exceeded|insufficient.*fund|payment.*required/i.test(src))
    return "billing_exceeded";
  if (/rate.*limit|too.*many.*request|request.*per.*minute/i.test(src))
    return "rate_limited";
  if (/context.*overflow|token.*limit|prompt.*too.*large|buffer.*overflow|context.*length/i.test(src))
    return "context_overflow";
  if (/failover|model.*unavailable|overloaded|service.*unavailable|model.*not.*found/i.test(src))
    return "model_unavailable";
  if (/internal.*server.*error|fatal|crash|unexpected.*exit|5[0-9][0-9]\b/i.test(src))
    return "provider_crash";
  if (/timeout|timed.*out|network|connection.*refused|econnreset|enotfound/i.test(src))
    return "network_error";

  return "unknown";
}

/**
 * PTY `ErrorCode` → `ProviderErrorCode` 하위 호환 매핑.
 * 기존 container-cli-agent / types.ts를 건드리지 않고 상위 레이어에서 정규화.
 */
export function from_pty_error_code(pty_code: string): ProviderErrorCode {
  const MAP: Record<string, ProviderErrorCode> = {
    auth: "auth_invalid",
    billing: "billing_exceeded",
    rate_limit: "rate_limited",
    token_limit: "context_overflow",
    buffer_overflow: "context_overflow",
    failover: "model_unavailable",
    crash: "provider_crash",
    timeout: "network_error",
    fatal: "unknown",
  };
  return MAP[pty_code] ?? "unknown";
}
