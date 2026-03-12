/**
 * handle_admin — /api/admin/* 엔드포인트 (superadmin 전용).
 *
 *   GET    /api/admin/users            — 전체 사용자 목록
 *   POST   /api/admin/users            — 사용자 생성
 *   DELETE /api/admin/users/:id        — 사용자 삭제 (자기 자신 제외)
 *   PATCH  /api/admin/users/:id/password — 비밀번호 변경
 */

import type { RouteContext } from "../route-context.js";
import { extract_token } from "../../auth/auth-middleware.js";

const RE_USER = /^\/api\/admin\/users\/([^/]+)$/;
const RE_USER_PW = /^\/api\/admin\/users\/([^/]+)\/password$/;

export async function handle_admin(ctx: RouteContext): Promise<boolean> {
  const { req, res, url, options, json, read_body } = ctx;
  if (!url.pathname.startsWith("/api/admin")) return false;

  const auth_svc = options.auth_svc ?? null;
  if (!auth_svc) { json(res, 503, { error: "auth_not_configured" }); return true; }

  // superadmin 권한 확인
  const token = extract_token(req);
  const payload = token ? auth_svc.verify_token(token) : null;
  if (!payload || payload.role !== "superadmin") {
    json(res, 403, { error: "forbidden" });
    return true;
  }

  // ── GET /api/admin/users ──
  if (url.pathname === "/api/admin/users" && req.method === "GET") {
    const users = auth_svc.list_users().map((u) => ({
      id: u.id, username: u.username, system_role: u.system_role,
      created_at: u.created_at, last_login_at: u.last_login_at, disabled_at: u.disabled_at,
    }));
    json(res, 200, { users });
    return true;
  }

  // ── POST /api/admin/users ──
  if (url.pathname === "/api/admin/users" && req.method === "POST") {
    const body = await read_body(req);
    if (!body) { json(res, 400, { error: "invalid_body" }); return true; }

    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const role = body.role === "superadmin" ? "superadmin" as const : "user" as const;

    if (!username || !password) { json(res, 400, { error: "username_password_required" }); return true; }
    if (username.length < 2 || password.length < 6) { json(res, 400, { error: "username_min_2_password_min_6" }); return true; }
    if (auth_svc.get_user_by_username(username)) { json(res, 409, { error: "username_taken" }); return true; }

    const user = auth_svc.create_user({ username, password, system_role: role });
    json(res, 201, { id: user.id, username: user.username, system_role: user.system_role });
    return true;
  }

  // ── DELETE /api/admin/users/:id ──
  const del_m = RE_USER.exec(url.pathname);
  if (del_m && req.method === "DELETE") {
    if (del_m[1] === payload.sub) { json(res, 400, { error: "cannot_delete_self" }); return true; }
    const deleted = auth_svc.delete_user(del_m[1]);
    json(res, deleted ? 200 : 404, deleted ? { ok: true } : { error: "not_found" });
    return true;
  }

  // ── PATCH /api/admin/users/:id/password ──
  const pw_m = RE_USER_PW.exec(url.pathname);
  if (pw_m && req.method === "PATCH") {
    const body = await read_body(req);
    if (!body) { json(res, 400, { error: "invalid_body" }); return true; }
    const password = typeof body.password === "string" ? body.password : "";
    if (password.length < 6) { json(res, 400, { error: "password_min_6" }); return true; }
    const updated = auth_svc.update_password(pw_m[1], password);
    json(res, updated ? 200 : 404, updated ? { ok: true } : { error: "not_found" });
    return true;
  }

  return false;
}
