import type { RouteContext } from "../route-context.js";
import { build_scope_filter, can_write_scope, require_superadmin_for_write, require_team_manager } from "../route-context.js";
import { error_message } from "../../utils/common.js";

function agent_provider_ops_or_503(ctx: RouteContext) {
  const ops = ctx.options.agent_provider_ops ?? null;
  if (!ops) ctx.json(ctx.res, 503, { error: "agent_provider_ops_unavailable" });
  return ops;
}

/**
 * 쓰기 요청에 대해 scope 기본값 주입.
 * scope_type/scope_id가 없으면 personal scope로 기본값 설정.
 */
function resolve_write_scope(ctx: RouteContext, body: Record<string, unknown>): { scope_type: string; scope_id: string } {
  const scope_type = typeof body.scope_type === "string" ? body.scope_type : "personal";
  let scope_id = typeof body.scope_id === "string" ? body.scope_id : "";
  if (scope_type === "personal" && !scope_id) scope_id = ctx.auth_user?.sub ?? "";
  if (scope_type === "team" && !scope_id) scope_id = ctx.team_context?.team_id ?? "";
  return { scope_type, scope_id };
}

export async function handle_agent_provider(ctx: RouteContext): Promise<boolean> {
  const { req, url, res, json, read_body } = ctx;
  const path = url.pathname;

  // GET /api/agents/providers/types — 프로바이더 타입 목록 (읽기, 제한 없음)
  if (path === "/api/agents/providers/types" && req.method === "GET") {
    const ops = agent_provider_ops_or_503(ctx);
    if (!ops) return true;
    json(res, 200, ops.list_provider_types());
    return true;
  }

  // GET /api/agents/providers/models/:provider_type — 프로바이더 타입별 모델 목록
  const type_models_match = path.match(/^\/api\/agents\/providers\/models\/([^/]+)$/);
  if (type_models_match && req.method === "GET") {
    const ops = agent_provider_ops_or_503(ctx);
    if (!ops) return true;
    const provider_type = decodeURIComponent(type_models_match[1]);
    const api_base = url.searchParams.get("api_base") || undefined;
    try {
      const models = await ops.list_models(provider_type, { api_base });
      json(res, 200, models);
    } catch (e) {
      json(res, 502, { error: error_message(e) });
    }
    return true;
  }

  // GET /api/agents/providers — scope-filtered list
  if (path === "/api/agents/providers" && req.method === "GET") {
    const ops = agent_provider_ops_or_503(ctx);
    if (!ops) return true;
    json(res, 200, await ops.list(build_scope_filter(ctx)));
    return true;
  }

  // POST /api/agents/providers — scope 권한 검사 후 생성
  if (path === "/api/agents/providers" && req.method === "POST") {
    const ops = agent_provider_ops_or_503(ctx);
    if (!ops) return true;
    const body = await read_body(req);
    if (!body) { json(res, 400, { error: "invalid_body" }); return true; }
    const scope = resolve_write_scope(ctx, body);
    if (!can_write_scope(ctx, scope.scope_type, scope.scope_id)) {
      json(res, 403, { error: "scope_write_denied" });
      return true;
    }
    const input = { ...body, scope_type: scope.scope_type, scope_id: scope.scope_id } as Parameters<typeof ops.create>[0];
    const result = await ops.create(input);
    json(res, result.ok ? 201 : 400, result);
    return true;
  }

  // POST /api/agents/providers/:id/test
  const test_match = path.match(/^\/api\/agents\/providers\/([^/]+)\/test$/);
  if (test_match && req.method === "POST") {
    const ops = agent_provider_ops_or_503(ctx);
    if (!ops) return true;
    const id = decodeURIComponent(test_match[1]);
    const result = await ops.test_availability(id);
    json(res, result.ok ? 200 : 400, result);
    return true;
  }

  // GET /api/agents/providers/:id/models — 인스턴스별 모델 목록
  const inst_models_match = path.match(/^\/api\/agents\/providers\/([^/]+)\/models$/);
  if (inst_models_match && req.method === "GET") {
    const ops = agent_provider_ops_or_503(ctx);
    if (!ops) return true;
    const id = decodeURIComponent(inst_models_match[1]);
    const config = await ops.get(id);
    if (!config) { json(res, 404, { error: "not_found" }); return true; }
    // connection의 api_base를 우선 사용, 없으면 인스턴스 settings의 api_base
    let api_base = typeof config.settings?.api_base === "string" ? config.settings.api_base : undefined;
    if (config.connection_id) {
      const conn = await ops.get_connection(config.connection_id);
      if (conn?.api_base) api_base = conn.api_base;
    }
    try {
      const models = await ops.list_models(config.provider_type, { api_base });
      json(res, 200, models);
    } catch (e) {
      json(res, 502, { error: error_message(e) });
    }
    return true;
  }

  // GET /api/agents/providers/:id — FE-6a: scope 가시성 검사 추가
  const id_match = path.match(/^\/api\/agents\/providers\/([^/]+)$/);
  if (id_match && req.method === "GET") {
    const ops = agent_provider_ops_or_503(ctx);
    if (!ops) return true;
    const id = decodeURIComponent(id_match[1]);
    const info = await ops.get(id);
    if (!info) { json(res, 404, { error: "not_found" }); return true; }
    const scope = build_scope_filter(ctx);
    if (scope && !scope.some((s) => s.scope_type === info.scope_type && s.scope_id === info.scope_id)) {
      json(res, 404, { error: "not_found" });
      return true;
    }
    json(res, 200, info);
    return true;
  }

  // PUT /api/agents/providers/:id — 기존 리소스의 scope로 권한 검사
  if (id_match && req.method === "PUT") {
    const ops = agent_provider_ops_or_503(ctx);
    if (!ops) return true;
    const id = decodeURIComponent(id_match[1]);
    const existing = await ops.get(id);
    if (!existing) { json(res, 404, { error: "not_found" }); return true; }
    if (!can_write_scope(ctx, existing.scope_type, existing.scope_id)) {
      json(res, 403, { error: "scope_write_denied" });
      return true;
    }
    const body = await read_body(req);
    if (!body) { json(res, 400, { error: "invalid_body" }); return true; }
    const result = await ops.update(id, body as Parameters<typeof ops.update>[1]);
    json(res, result.ok ? 200 : 400, result);
    return true;
  }

  // DELETE /api/agents/providers/:id — 기존 리소스의 scope로 권한 검사
  if (id_match && req.method === "DELETE") {
    const ops = agent_provider_ops_or_503(ctx);
    if (!ops) return true;
    const id = decodeURIComponent(id_match[1]);
    const existing = await ops.get(id);
    if (!existing) { json(res, 404, { error: "not_found" }); return true; }
    if (!can_write_scope(ctx, existing.scope_type, existing.scope_id)) {
      json(res, 403, { error: "scope_write_denied" });
      return true;
    }
    const result = await ops.remove(id);
    json(res, result.ok ? 200 : 404, result);
    return true;
  }

  // ── Connection 엔드포인트 (인프라 레벨 = superadmin only for writes) ──

  // GET /api/agents/connections — FE-6a: 인프라 데이터, team_manager 이상만 접근
  if (path === "/api/agents/connections" && req.method === "GET") {
    if (!require_team_manager(ctx)) return true;
    const ops = agent_provider_ops_or_503(ctx);
    if (!ops) return true;
    json(res, 200, await ops.list_connections());
    return true;
  }

  // POST /api/agents/connections
  if (path === "/api/agents/connections" && req.method === "POST") {
    if (!require_superadmin_for_write(ctx)) return true;
    const ops = agent_provider_ops_or_503(ctx);
    if (!ops) return true;
    const body = await read_body(req);
    if (!body) { json(res, 400, { error: "invalid_body" }); return true; }
    const result = await ops.create_connection(body as Parameters<typeof ops.create_connection>[0]);
    json(res, result.ok ? 201 : 400, result);
    return true;
  }

  // POST /api/agents/connections/:id/test
  const conn_test_match = path.match(/^\/api\/agents\/connections\/([^/]+)\/test$/);
  if (conn_test_match && req.method === "POST") {
    const ops = agent_provider_ops_or_503(ctx);
    if (!ops) return true;
    const id = decodeURIComponent(conn_test_match[1]);
    const result = await ops.test_connection(id);
    json(res, result.ok ? 200 : 400, result);
    return true;
  }

  // GET /api/agents/connections/:id/models — connection별 모델 목록
  const conn_models_match = path.match(/^\/api\/agents\/connections\/([^/]+)\/models$/);
  if (conn_models_match && req.method === "GET") {
    const ops = agent_provider_ops_or_503(ctx);
    if (!ops) return true;
    const id = decodeURIComponent(conn_models_match[1]);
    const conn = await ops.get_connection(id);
    if (!conn) { json(res, 404, { error: "not_found" }); return true; }
    try {
      const models = await ops.list_models(conn.provider_type, { api_base: conn.api_base });
      json(res, 200, models);
    } catch (e) {
      json(res, 502, { error: error_message(e) });
    }
    return true;
  }

  // GET /api/agents/connections/:id
  const conn_id_match = path.match(/^\/api\/agents\/connections\/([^/]+)$/);
  if (conn_id_match && req.method === "GET") {
    const ops = agent_provider_ops_or_503(ctx);
    if (!ops) return true;
    const id = decodeURIComponent(conn_id_match[1]);
    const info = await ops.get_connection(id);
    json(res, info ? 200 : 404, info ?? { error: "not_found" });
    return true;
  }

  // PUT /api/agents/connections/:id
  if (conn_id_match && req.method === "PUT") {
    if (!require_superadmin_for_write(ctx)) return true;
    const ops = agent_provider_ops_or_503(ctx);
    if (!ops) return true;
    const id = decodeURIComponent(conn_id_match[1]);
    const body = await read_body(req);
    if (!body) { json(res, 400, { error: "invalid_body" }); return true; }
    const result = await ops.update_connection(id, body as Parameters<typeof ops.update_connection>[1]);
    json(res, result.ok ? 200 : 400, result);
    return true;
  }

  // DELETE /api/agents/connections/:id
  if (conn_id_match && req.method === "DELETE") {
    if (!require_superadmin_for_write(ctx)) return true;
    const ops = agent_provider_ops_or_503(ctx);
    if (!ops) return true;
    const id = decodeURIComponent(conn_id_match[1]);
    const result = await ops.remove_connection(id);
    json(res, result.ok ? 200 : 404, result);
    return true;
  }

  return false;
}
