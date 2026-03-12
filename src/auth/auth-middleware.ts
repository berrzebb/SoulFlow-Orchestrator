/**
 * auth-middleware — HTTP 요청에서 JWT 토큰을 추출하는 유틸.
 * Bearer 헤더와 HttpOnly 쿠키 두 경로를 모두 지원한다.
 */

import type { IncomingMessage } from "node:http";

/** 웹 UI / API 클라이언트 공용 쿠키 이름. */
export const AUTH_COOKIE = "sf_token";

/** Authorization: Bearer 또는 sf_token 쿠키에서 토큰을 추출. */
export function extract_token(req: IncomingMessage): string | null {
  const auth = req.headers["authorization"];
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    const t = auth.slice(7).trim();
    if (t) return t;
  }
  const raw_cookie = req.headers["cookie"];
  if (raw_cookie) {
    const cookies = parse_cookies(raw_cookie);
    if (cookies[AUTH_COOKIE]) return cookies[AUTH_COOKIE];
  }
  return null;
}

/** Set-Cookie 헤더 문자열 생성 (HttpOnly, SameSite=Strict). */
export function make_auth_cookie(token: string, max_age_sec = 7 * 24 * 3600): string {
  return `${AUTH_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${max_age_sec}`;
}

/** Set-Cookie 헤더: 토큰 삭제용 (Max-Age=0). */
export function clear_auth_cookie(): string {
  return `${AUTH_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

function parse_cookies(header: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) result[key] = decodeURIComponent(val);
  }
  return result;
}
