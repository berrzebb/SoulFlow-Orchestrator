/**
 * handle_team_providers — 팀·전역 스코프 프로바이더 CRUD.
 *
 *   GET    /api/teams/:id/providers             — 팀+전역 병합 목록 (scope 배지 포함)
 *   POST   /api/teams/:id/providers             — 팀 프로바이더 생성 (team_manager 이상)
 *   PATCH  /api/teams/:id/providers/:pid        — 팀 프로바이더 수정
 *   DELETE /api/teams/:id/providers/:pid        — 팀 프로바이더 삭제
 *
 *   GET    /api/admin/global-providers          — 전역 프로바이더 목록 (superadmin)
 *   POST   /api/admin/global-providers          — 전역 프로바이더 생성 (superadmin)
 *   PATCH  /api/admin/global-providers/:id      — 전역 프로바이더 수정 (superadmin)
 *   DELETE /api/admin/global-providers/:id      — 전역 프로바이더 삭제 (superadmin)
 */

import { join } from "node:path";
import type { RouteContext } from "../route-context.js";
import { TeamStore, type TeamRole } from "../../auth/team-store.js";
import { ScopedProviderResolver } from "../../auth/scoped-provider-resolver.js";

const RE_TEAM_PROV      = /^\/api\/teams\/([^/]+)\/providers$/;
const RE_TEAM_PROV_ID   = /^\/api\/teams\/([^/]+)\/providers\/([^/]+)$/;
const RE_GLOBAL_PROV    = /^\/api\/admin\/global-providers$/;
const RE_GLOBAL_PROV_ID = /^\/api\/admin\/global-providers\/([^/]+)$/;

const TEAM_MANAGER_ROLES: TeamRole[] = ["owner", "manager"];

function team_db_path(workspace_root: string, team_id: string): string {
  return join(workspace_root, "tenants", team_id, "team.db");
}

export async function handle_team_providers(ctx: RouteContext): Promise<boolean> {
  const { req, res, url, options, json, read_body, auth_user } = ctx;

  const auth_svc = options.auth_svc ?? null;
  const workspace = options.workspace ?? "";

  // ── /api/teams/:id/providers ──

  const list_m = RE_TEAM_PROV.exec(url.pathname);
  if (list_m) {
    const team_id = list_m[1];
    if (!auth_svc || !auth_user) { json(res, 401, { error: "unauthorized" }); return true; }

    // superadmin은 모든 팀 접근 가능, 일반 사용자는 자신의 팀만
    if (auth_user.role !== "superadmin" && auth_user.tid !== team_id) {
      json(res, 403, { error: "forbidden" }); return true;
    }

    if (req.method === "GET") {
      if (!workspace) { json(res, 503, { error: "workspace_not_configured" }); return true; }
      const resolver = new ScopedProviderResolver(auth_svc, workspace);
      json(res, 200, { team_id, providers: resolver.list(team_id) });
      return true;
    }

    if (req.method === "POST") {
      if (!workspace) { json(res, 503, { error: "workspace_not_configured" }); return true; }
      // 팀 관리자(owner/manager) 또는 superadmin만 생성 가능
      if (auth_user.role !== "superadmin") {
        const store = new TeamStore(team_db_path(workspace, team_id), team_id);
        const membership = store.get_membership(auth_user.sub);
        if (!membership || !TEAM_MANAGER_ROLES.includes(membership.role)) {
          json(res, 403, { error: "team_manager_required" }); return true;
        }
      }
      const body = await read_body(req);
      if (!body) { json(res, 400, { error: "invalid_body" }); return true; }
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const type = typeof body.type === "string" ? body.type.trim() : "";
      if (!name || !type) { json(res, 400, { error: "name_type_required" }); return true; }
      const store = new TeamStore(team_db_path(workspace, team_id), team_id);
      const provider = store.create_provider({
        name, type,
        model: typeof body.model === "string" ? body.model : "",
        config: (typeof body.config === "object" && body.config !== null ? body.config : {}) as Record<string, unknown>,
        api_key_ref: typeof body.api_key_ref === "string" ? body.api_key_ref : "",
        enabled: body.enabled !== false,
      });
      json(res, 201, { ...provider, scope: "team" });
      return true;
    }
  }

  const id_m = RE_TEAM_PROV_ID.exec(url.pathname);
  if (id_m) {
    const team_id = id_m[1];
    const provider_id = id_m[2];
    if (!auth_svc || !auth_user) { json(res, 401, { error: "unauthorized" }); return true; }
    if (auth_user.role !== "superadmin" && auth_user.tid !== team_id) {
      json(res, 403, { error: "forbidden" }); return true;
    }
    if (!workspace) { json(res, 503, { error: "workspace_not_configured" }); return true; }

    if (req.method === "PATCH" || req.method === "DELETE") {
      if (auth_user.role !== "superadmin") {
        const store = new TeamStore(team_db_path(workspace, team_id), team_id);
        const membership = store.get_membership(auth_user.sub);
        if (!membership || !TEAM_MANAGER_ROLES.includes(membership.role)) {
          json(res, 403, { error: "team_manager_required" }); return true;
        }
      }
    }

    const store = new TeamStore(team_db_path(workspace, team_id), team_id);

    if (req.method === "PATCH") {
      const body = await read_body(req);
      if (!body) { json(res, 400, { error: "invalid_body" }); return true; }
      const updated = store.update_provider(provider_id, {
        name: typeof body.name === "string" ? body.name : undefined,
        model: typeof body.model === "string" ? body.model : undefined,
        config: (typeof body.config === "object" && body.config !== null ? body.config : undefined) as Record<string, unknown> | undefined,
        api_key_ref: typeof body.api_key_ref === "string" ? body.api_key_ref : undefined,
        enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
      });
      json(res, updated ? 200 : 404, updated ? { ok: true } : { error: "not_found" });
      return true;
    }

    if (req.method === "DELETE") {
      const removed = store.delete_provider(provider_id);
      json(res, removed ? 200 : 404, removed ? { ok: true } : { error: "not_found" });
      return true;
    }
  }

  // ── /api/admin/global-providers (superadmin 전용) ──

  if (RE_GLOBAL_PROV.exec(url.pathname)) {
    if (!auth_svc || !auth_user) { json(res, 401, { error: "unauthorized" }); return true; }
    if (auth_user.role !== "superadmin") { json(res, 403, { error: "forbidden" }); return true; }

    if (req.method === "GET") {
      json(res, 200, { providers: auth_svc.list_shared_providers().map((p) => ({ ...p, scope: "global" })) });
      return true;
    }

    if (req.method === "POST") {
      const body = await read_body(req);
      if (!body) { json(res, 400, { error: "invalid_body" }); return true; }
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const type = typeof body.type === "string" ? body.type.trim() : "";
      if (!name || !type) { json(res, 400, { error: "name_type_required" }); return true; }
      const provider = auth_svc.create_shared_provider({
        name, type,
        model: typeof body.model === "string" ? body.model : "",
        config: (typeof body.config === "object" && body.config !== null ? body.config : {}) as Record<string, unknown>,
        api_key_ref: typeof body.api_key_ref === "string" ? body.api_key_ref : "",
        enabled: body.enabled !== false,
      });
      json(res, 201, { ...provider, scope: "global" });
      return true;
    }
  }

  const gp_id_m = RE_GLOBAL_PROV_ID.exec(url.pathname);
  if (gp_id_m) {
    const gp_id = gp_id_m[1];
    if (!auth_svc || !auth_user) { json(res, 401, { error: "unauthorized" }); return true; }
    if (auth_user.role !== "superadmin") { json(res, 403, { error: "forbidden" }); return true; }

    if (req.method === "PATCH") {
      const body = await read_body(req);
      if (!body) { json(res, 400, { error: "invalid_body" }); return true; }
      const updated = auth_svc.update_shared_provider(gp_id, {
        name: typeof body.name === "string" ? body.name : undefined,
        model: typeof body.model === "string" ? body.model : undefined,
        config: (typeof body.config === "object" && body.config !== null ? body.config : undefined) as Record<string, unknown> | undefined,
        enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
      });
      json(res, updated ? 200 : 404, updated ? { ok: true } : { error: "not_found" });
      return true;
    }

    if (req.method === "DELETE") {
      const removed = auth_svc.delete_shared_provider(gp_id);
      json(res, removed ? 200 : 404, removed ? { ok: true } : { error: "not_found" });
      return true;
    }
  }

  return false;
}
