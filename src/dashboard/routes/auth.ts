/**
 * handle_auth — /api/auth/* 엔드포인트.
 *
 *   GET  /api/auth/status  — 인증 설정 여부 + 초기화 여부
 *   POST /api/auth/setup   — 최초 superadmin 생성 (미초기화 시에만)
 *   POST /api/auth/login   — 로그인 → JWT 쿠키 + JSON 응답
 *   POST /api/auth/logout  — 쿠키 삭제
 *   GET  /api/auth/me      — 현재 로그인 사용자 정보
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { RouteContext } from "../route-context.js";
import { make_auth_cookie, clear_auth_cookie } from "../../auth/auth-middleware.js";
import { TeamStore } from "../../auth/team-store.js";

function team_db_path(workspace: string, team_id: string): string {
  return join(workspace, "tenants", team_id, "team.db");
}

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
    const p = ctx.auth_user;
    if (!p) { json(res, 401, { error: "not_authenticated" }); return true; }

    // TeamStore에서 현재 팀 role 조회 (없으면 null)
    const workspace = options.workspace ?? "";
    let team_role: string | null = null;
    if (workspace && p.tid) {
      const db = team_db_path(workspace, p.tid);
      if (existsSync(db)) team_role = new TeamStore(db, p.tid).get_membership(p.sub)?.role ?? null;
    }

    json(res, 200, { sub: p.sub, username: p.usr, role: p.role, tid: p.tid, wdir: p.wdir, exp: p.exp, team_role });
    return true;
  }

  // ── GET /api/auth/my-teams ──

  if (url.pathname === "/api/auth/my-teams" && req.method === "GET") {
    if (!auth_svc) { json(res, 503, { error: "auth_not_configured" }); return true; }
    const p = ctx.auth_user;
    if (!p) { json(res, 401, { error: "not_authenticated" }); return true; }

    const workspace = options.workspace ?? "";
    const all_teams = auth_svc.list_teams();

    // superadmin은 모든 팀, 일반 사용자는 멤버십이 있는 팀만
    if (p.role === "superadmin") {
      json(res, 200, { teams: all_teams.map((t) => ({ ...t, role: "owner" as const })) });
      return true;
    }

    const my_teams = [];
    for (const team of all_teams) {
      const db = team_db_path(workspace, team.id);
      if (!existsSync(db)) continue;
      const membership = new TeamStore(db, team.id).get_membership(p.sub);
      if (membership) my_teams.push({ ...team, role: membership.role });
    }
    json(res, 200, { teams: my_teams });
    return true;
  }

  // ── POST /api/auth/switch-team ──

  if (url.pathname === "/api/auth/switch-team" && req.method === "POST") {
    if (!auth_svc) { json(res, 503, { error: "auth_not_configured" }); return true; }
    const p = ctx.auth_user;
    if (!p) { json(res, 401, { error: "not_authenticated" }); return true; }

    const body = await read_body(req);
    const team_id = typeof body?.team_id === "string" ? body.team_id.trim() : "";
    if (!team_id) { json(res, 400, { error: "team_id_required" }); return true; }

    const workspace = options.workspace ?? "";

    // superadmin은 멤버십 검증 없이 모든 팀으로 전환 가능
    if (p.role !== "superadmin") {
      const db = team_db_path(workspace, team_id);
      if (!existsSync(db)) { json(res, 403, { error: "not_a_member" }); return true; }
      const membership = new TeamStore(db, team_id).get_membership(p.sub);
      if (!membership) { json(res, 403, { error: "not_a_member" }); return true; }
    }

    const result = auth_svc.issue_token_for_team(p.sub, team_id);
    if (!result) { json(res, 404, { error: "user_not_found" }); return true; }

    res.setHeader("Set-Cookie", make_auth_cookie(result.token));
    json(res, 200, { ok: true, tid: team_id });
    return true;
  }

  return false;
}
