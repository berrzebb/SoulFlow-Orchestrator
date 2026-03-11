/** 채널 HTTP 공통 유틸 — fetch timeout·JSON 파싱 중복 제거. */

export const CHANNEL_FETCH_TIMEOUT_MS = 30_000;

/**
 * fetch + AbortSignal.timeout 자동 주입 래퍼.
 * signal을 직접 넘기지 않아도 된다.
 */
export function channel_fetch(url: string, init?: Omit<RequestInit, "signal">): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(CHANNEL_FETCH_TIMEOUT_MS) });
}

/** Response → Record<string, unknown> 파싱. 실패 시 빈 객체 반환. */
export async function parse_json_response(response: Response): Promise<Record<string, unknown>> {
  return (await response.json().catch(() => ({}))) as Record<string, unknown>;
}
