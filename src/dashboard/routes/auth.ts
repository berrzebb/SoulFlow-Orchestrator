/**
 * handle_auth — /api/auth/* 엔드포인트.
 *
 *   GET  /api/auth/status  — 인증 설정 여부 + 초기화 여부
 *   POST /api/auth/setup   — 최초 superadmin 생성 (미초기화 시에만)
 *   POST /api/auth/login   — 로그인 → JWT 쿠키 + JSON 응답
 *   POST /api/auth/logout  — 쿠키 삭제
 *   GET  /api/auth/me      — 현재 로그인 사용자 정보
 */

import type { RouteContext } from "../route-context.js";
import { extract_token, make_auth_cookie, clear_auth_cookie } from "../../auth/auth-middleware.js";

export async function handle_auth(ctx: RouteContext): Promise<boolean> {
  const { req, res, url, options, json, read_body } = ctx;
  if (!url.pathname.startsWith("/api/auth")) return false;

  const auth_svc = options.auth_svc ?? null;

  // ── GET /api/auth/status ──

  if (url.pathname === "/api/auth/status" && req.method === "GET") {
    if (!auth_svc) {
      json(res, 200, { enabled: false, initialized: false });
      return true;
    }
    json(res, 200, { enabled: true, initialized: auth_svc.is_initialized() });
    return true;
  }

  // ── POST /api/auth/setup ──

  if (url.pathname === "/api/auth/setup" && req.method === "POST") {
    if (!auth_svc) { json(res, 503, { error: "auth_not_configured" }); return true; }
    if (auth_svc.is_initialized()) { json(res, 409, { error: "already_initialized" }); return true; }

    const body = await read_body(req);
    if (!body) { json(res, 400, { error: "invalid_body" }); return true; }

    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!username || !password) {
      json(res, 400, { error: "username_password_required" });
      return true;
    }
    if (username.length < 2 || password.length < 6) {
      json(res, 400, { error: "username_min_2_password_min_6" });
      return true;
    }

    const result = await auth_svc.setup_superadmin(username, password);
    if (!result) { json(res, 500, { error: "setup_failed" }); return true; }

    res.setHeader("Set-Cookie", make_auth_cookie(result.token));
    json(res, 201, { ok: true, username: result.payload.usr, role: result.payload.role });
    return true;
  }

  // ── POST /api/auth/login ──

  if (url.pathname === "/api/auth/login" && req.method === "POST") {
    if (!auth_svc) { json(res, 503, { error: "auth_not_configured" }); return true; }

    const body = await read_body(req);
    if (!body) { json(res, 400, { error: "invalid_body" }); return true; }

    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!username || !password) {
      json(res, 400, { error: "username_password_required" });
      return true;
    }

    const result = await auth_svc.login(username, password);
    if (!result) { json(res, 401, { error: "invalid_credentials" }); return true; }

    res.setHeader("Set-Cookie", make_auth_cookie(result.token));
    json(res, 200, { ok: true, username: result.payload.usr, role: result.payload.role });
    return true;
  }

  // ── POST /api/auth/logout ──

  if (url.pathname === "/api/auth/logout" && req.method === "POST") {
    res.setHeader("Set-Cookie", clear_auth_cookie());
    json(res, 200, { ok: true });
    return true;
  }

  // ── GET /api/auth/me ──

  if (url.pathname === "/api/auth/me" && req.method === "GET") {
    if (!auth_svc) { json(res, 503, { error: "auth_not_configured" }); return true; }

    const token = extract_token(req);
    if (!token) { json(res, 401, { error: "not_authenticated" }); return true; }

    const payload = auth_svc.verify_token(token);
    if (!payload) { json(res, 401, { error: "token_invalid_or_expired" }); return true; }

    json(res, 200, { sub: payload.sub, username: payload.usr, role: payload.role, exp: payload.exp });
    return true;
  }

  return false;
}
