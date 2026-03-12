/**
 * handle_admin — /api/admin/* 엔드포인트 (superadmin 전용).
 *
 *   GET    /api/admin/users                         — 전체 사용자 목록
 *   POST   /api/admin/users                         — 사용자 생성 (team_id 선택)
 *   DELETE /api/admin/users/:id                     — 사용자 삭제 (자기 자신 제외)
 *   PATCH  /api/admin/users/:id/password            — 비밀번호 변경
 *   PATCH  /api/admin/users/:id/team                — 팀 변경 + TeamStore 멤버십 동기화
 *
 *   GET    /api/admin/teams                         — 팀 목록
 *   POST   /api/admin/teams                         — 팀 생성 (team.db 초기화 포함)
 *   GET    /api/admin/teams/:id                     — 팀 단건 조회
 *   GET    /api/admin/teams/:id/members             — 팀 멤버 목록 (TeamStore)
 *   POST   /api/admin/teams/:id/members             — 멤버 추가/역할 변경
 *   DELETE /api/admin/teams/:id/members/:user_id    — 멤버 제거
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { RouteContext } from "../route-context.js";
import { TeamStore, type TeamRole } from "../../auth/team-store.js";

const RE_USER       = /^\/api\/admin\/users\/([^/]+)$/;
const RE_USER_PW    = /^\/api\/admin\/users\/([^/]+)\/password$/;
const RE_USER_TM    = /^\/api\/admin\/users\/([^/]+)\/team$/;
const RE_TEAM       = /^\/api\/admin\/teams\/([^/]+)$/;
const RE_TEAM_MBR   = /^\/api\/admin\/teams\/([^/]+)\/members$/;
const RE_TEAM_MBR_U = /^\/api\/admin\/teams\/([^/]+)\/members\/([^/]+)$/;

const VALID_ROLES: TeamRole[] = ["owner", "manager", "member", "viewer"];

/** 신규 사용자의 개인 워크스페이스 하위 디렉토리 생성. */
function ensure_user_workspace(workspace_root: string, team_id: string, user_id: string): void {
  const base = join(workspace_root, "tenants", team_id, "users", user_id);
  for (const sub of ["workflows", "skills", "templates", "runtime"]) {
    mkdirSync(join(base, sub), { recursive: true });
  }
}

/** team.db 경로 반환. workspace_root 없으면 null. */
function team_db_path(workspace_root: string, team_id: string): string {
  return join(workspace_root, "tenants", team_id, "team.db");
}

export async function handle_admin(ctx: RouteContext): Promise<boolean> {
  const { req, res, url, options, json, read_body, auth_user } = ctx;
  if (!url.pathname.startsWith("/api/admin")) return false;

  const auth_svc = options.auth_svc ?? null;
  if (!auth_svc) { json(res, 503, { error: "auth_not_configured" }); return true; }

  // 미들웨어에서 이미 DB 검증 완료 → auth_user 재사용
  if (!auth_user || auth_user.role !== "superadmin") {
    json(res, 403, { error: "forbidden" });
    return true;
  }

  const workspace = options.workspace ?? "";

  // ── GET /api/admin/users ──

  if (url.pathname === "/api/admin/users" && req.method === "GET") {
    const users = auth_svc.list_users().map((u) => ({
      id: u.id, username: u.username, system_role: u.system_role,
      default_team_id: u.default_team_id,
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
    const team_id = typeof body.team_id === "string" ? body.team_id.trim() || null : null;
    const team_role: TeamRole = VALID_ROLES.includes(body.team_role as TeamRole) ? body.team_role as TeamRole : "member";

    if (!username || !password) { json(res, 400, { error: "username_password_required" }); return true; }
    if (username.length < 2 || password.length < 6) { json(res, 400, { error: "username_min_2_password_min_6" }); return true; }
    if (auth_svc.get_user_by_username(username)) { json(res, 409, { error: "username_taken" }); return true; }
    if (team_id && !auth_svc.list_teams().find((t) => t.id === team_id)) {
      json(res, 422, { error: "team_not_found" }); return true;
    }

    const user = auth_svc.create_user({ username, password, system_role: role, default_team_id: team_id });
    if (workspace && team_id) {
      ensure_user_workspace(workspace, team_id, user.id);
      // TeamStore 멤버십 동기화
      new TeamStore(team_db_path(workspace, team_id), team_id).upsert_member(user.id, team_role);
    }
    json(res, 201, { id: user.id, username: user.username, system_role: user.system_role, default_team_id: user.default_team_id });
    return true;
  }

  // ── DELETE /api/admin/users/:id ──

  const del_m = RE_USER.exec(url.pathname);
  if (del_m && req.method === "DELETE") {
    if (del_m[1] === auth_user.sub) { json(res, 400, { error: "cannot_delete_self" }); return true; }
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

  // ── PATCH /api/admin/users/:id/team ──

  const tm_m = RE_USER_TM.exec(url.pathname);
  if (tm_m && req.method === "PATCH") {
    const body = await read_body(req);
    if (!body) { json(res, 400, { error: "invalid_body" }); return true; }
    const team_id = typeof body.team_id === "string" ? body.team_id.trim() : "";
    if (!team_id) { json(res, 400, { error: "team_id_required" }); return true; }
    if (!auth_svc.list_teams().find((t) => t.id === team_id)) {
      json(res, 422, { error: "team_not_found" }); return true;
    }
    const user = auth_svc.get_user_by_id(tm_m[1]);
    if (!user) { json(res, 404, { error: "not_found" }); return true; }
    auth_svc.assign_team(user.id, team_id);
    if (workspace) {
      ensure_user_workspace(workspace, team_id, user.id);
      // TeamStore 멤버십 동기화 (기본 역할 member)
      new TeamStore(team_db_path(workspace, team_id), team_id).upsert_member(user.id, "member");
    }
    json(res, 200, { ok: true, user_id: user.id, team_id });
    return true;
  }

  // ── GET /api/admin/teams ──

  if (url.pathname === "/api/admin/teams" && req.method === "GET") {
    const teams = auth_svc.list_teams();
    const all_users = auth_svc.list_users();
    const result = teams.map((t) => ({
      ...t,
      member_count: all_users.filter((u) => (u.default_team_id ?? "default") === t.id).length,
    }));
    json(res, 200, { teams: result });
    return true;
  }

  // ── POST /api/admin/teams ──

  if (url.pathname === "/api/admin/teams" && req.method === "POST") {
    const body = await read_body(req);
    if (!body) { json(res, 400, { error: "invalid_body" }); return true; }
    const id = typeof body.id === "string" ? body.id.trim() : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!id || !name) { json(res, 400, { error: "id_name_required" }); return true; }
    if (!/^[a-z0-9-]+$/.test(id)) { json(res, 400, { error: "id_must_be_lowercase_alphanumeric_hyphen" }); return true; }
    const team = auth_svc.ensure_team(id, name);
    // team.db 초기화 (shared/ 디렉토리 포함)
    if (workspace) {
      for (const sub of ["shared/templates", "shared/workflows", "shared/references"]) {
        mkdirSync(join(workspace, "tenants", id, sub), { recursive: true });
      }
      new TeamStore(team_db_path(workspace, id), id); // DB 스키마 초기화
    }
    json(res, 201, team);
    return true;
  }

  // ── GET/POST /api/admin/teams/:id/members ──

  const mbr_m = RE_TEAM_MBR.exec(url.pathname);
  if (mbr_m) {
    const team_id = mbr_m[1];
    const team = auth_svc.list_teams().find((t) => t.id === team_id);
    if (!team) { json(res, 404, { error: "team_not_found" }); return true; }

    if (req.method === "GET") {
      // TeamStore 기반 멤버 목록 (role 포함)
      let members: Array<Record<string, unknown>> = [];
      if (workspace) {
        const store = new TeamStore(team_db_path(workspace, team_id), team_id);
        const db_members = store.list_members();
        const all_users = auth_svc.list_users();
        members = db_members.map((m) => {
          const u = all_users.find((u) => u.id === m.user_id);
          return {
            user_id: m.user_id, role: m.role, joined_at: m.joined_at,
            username: u?.username ?? null, system_role: u?.system_role ?? null,
            wdir: `tenants/${team_id}/users/${m.user_id}`,
          };
        });
      }
      json(res, 200, { team_id, members });
      return true;
    }

    if (req.method === "POST") {
      const body = await read_body(req);
      if (!body) { json(res, 400, { error: "invalid_body" }); return true; }
      const user_id = typeof body.user_id === "string" ? body.user_id.trim() : "";
      const role: TeamRole = VALID_ROLES.includes(body.role as TeamRole) ? body.role as TeamRole : "member";
      if (!user_id) { json(res, 400, { error: "user_id_required" }); return true; }
      if (!auth_svc.get_user_by_id(user_id)) { json(res, 404, { error: "user_not_found" }); return true; }
      if (!workspace) { json(res, 503, { error: "workspace_not_configured" }); return true; }
      ensure_user_workspace(workspace, team_id, user_id);
      const membership = new TeamStore(team_db_path(workspace, team_id), team_id).upsert_member(user_id, role);
      json(res, 200, membership);
      return true;
    }
  }

  // ── DELETE /api/admin/teams/:id/members/:user_id ──

  const mbr_u_m = RE_TEAM_MBR_U.exec(url.pathname);
  if (mbr_u_m && req.method === "DELETE") {
    const [, team_id, user_id] = mbr_u_m;
    if (!workspace) { json(res, 503, { error: "workspace_not_configured" }); return true; }
    const removed = new TeamStore(team_db_path(workspace, team_id), team_id).remove_member(user_id);
    json(res, removed ? 200 : 404, removed ? { ok: true } : { error: "not_found" });
    return true;
  }

  // ── GET /api/admin/teams/:id ──

  const team_m = RE_TEAM.exec(url.pathname);
  if (team_m && req.method === "GET") {
    const teams = auth_svc.list_teams();
    const team = teams.find((t) => t.id === team_m[1]);
    if (!team) { json(res, 404, { error: "not_found" }); return true; }
    json(res, 200, team);
    return true;
  }

  return false;
}
