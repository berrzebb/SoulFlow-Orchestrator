import type { RouteContext } from "../route-context.js";
import { build_scope_filter, can_write_scope } from "../route-context.js";
import type { DashboardAgentDefinitionOps } from "../ops/agent-definition.js";

function ops_or_503(ctx: RouteContext): DashboardAgentDefinitionOps | null {
  const ops = (ctx.options as Record<string, unknown>).agent_definition_ops as DashboardAgentDefinitionOps | null | undefined;
  if (!ops) ctx.json(ctx.res, 503, { error: "agent_definition_ops_unavailable" });
  return ops ?? null;
}

/**
 * 쓰기 요청에 대해 scope 권한 검사.
 * scope_type/scope_id가 없으면 personal scope로 기본값 주입.
 */
function resolve_write_scope(ctx: RouteContext, body: Record<string, unknown>): { scope_type: string; scope_id: string } {
  const scope_type = typeof body.scope_type === "string" ? body.scope_type : "personal";
  let scope_id = typeof body.scope_id === "string" ? body.scope_id : "";
  if (scope_type === "personal" && !scope_id) scope_id = ctx.auth_user?.sub ?? "";
  if (scope_type === "team" && !scope_id) scope_id = ctx.team_context?.team_id ?? "";
  return { scope_type, scope_id };
}

export async function handle_agent_definition(ctx: RouteContext): Promise<boolean> {
  const { req, url, res, json, read_body } = ctx;
  const path = url.pathname;

  // GET /api/agent-definitions — scope-filtered list
  if (path === "/api/agent-definitions" && req.method === "GET") {
    const ops = ops_or_503(ctx);
    if (!ops) return true;
    json(res, 200, ops.list(build_scope_filter(ctx)));
    return true;
  }

  // POST /api/agent-definitions/generate
  if (path === "/api/agent-definitions/generate" && req.method === "POST") {
    const ops = ops_or_503(ctx);
    if (!ops) return true;
    const body = await read_body(req);
    const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) { json(res, 400, { error: "prompt_required" }); return true; }
    const result = await ops.generate(prompt);
    json(res, result.ok ? 200 : (result.error === "generate_unavailable" ? 503 : 500), result);
    return true;
  }

  // POST /api/agent-definitions — scope 권한 검사 후 생성
  if (path === "/api/agent-definitions" && req.method === "POST") {
    const ops = ops_or_503(ctx);
    if (!ops) return true;
    const body = await read_body(req);
    if (!body) { json(res, 400, { error: "invalid_body" }); return true; }
    const scope = resolve_write_scope(ctx, body);
    if (!can_write_scope(ctx, scope.scope_type, scope.scope_id)) {
      json(res, 403, { error: "scope_write_denied" });
      return true;
    }
    const input = { ...body, scope_type: scope.scope_type, scope_id: scope.scope_id } as Parameters<typeof ops.create>[0];
    const result = ops.create(input);
    json(res, result.ok ? 201 : 400, result);
    return true;
  }

  // POST /api/agent-definitions/:id/fork — 원본 scope 유지, 쓰기 권한 검사
  const fork_match = path.match(/^\/api\/agent-definitions\/([^/]+)\/fork$/);
  if (fork_match && req.method === "POST") {
    const ops = ops_or_503(ctx);
    if (!ops) return true;
    const id = decodeURIComponent(fork_match[1]);
    const source = ops.get(id);
    if (!source) { json(res, 404, { error: "not_found" }); return true; }
    if (!can_write_scope(ctx, source.scope_type, source.scope_id)) {
      json(res, 403, { error: "scope_write_denied" });
      return true;
    }
    const result = ops.fork(id);
    json(res, result.ok ? 201 : 404, result);
    return true;
  }

  // GET /api/agent-definitions/:id — FE-6a: scope 가시성 검사 추가
  const id_match = path.match(/^\/api\/agent-definitions\/([^/]+)$/);
  if (id_match && req.method === "GET") {
    const ops = ops_or_503(ctx);
    if (!ops) return true;
    const id = decodeURIComponent(id_match[1]);
    const data = ops.get(id);
    if (!data) { json(res, 404, { error: "not_found" }); return true; }
    const scope = build_scope_filter(ctx);
    if (scope && (data as { scope_type?: string; scope_id?: string }).scope_type) {
      const dt = data as { scope_type: string; scope_id: string };
      if (!scope.some((s) => s.scope_type === dt.scope_type && s.scope_id === dt.scope_id)) {
        json(res, 404, { error: "not_found" });
        return true;
      }
    }
    json(res, 200, data);
    return true;
  }

  // PUT /api/agent-definitions/:id — 기존 리소스의 scope로 권한 검사
  if (id_match && req.method === "PUT") {
    const ops = ops_or_503(ctx);
    if (!ops) return true;
    const id = decodeURIComponent(id_match[1]);
    const existing = ops.get(id);
    if (!existing) { json(res, 404, { error: "not_found" }); return true; }
    if (!can_write_scope(ctx, existing.scope_type, existing.scope_id)) {
      json(res, 403, { error: "scope_write_denied" });
      return true;
    }
    const body = await read_body(req);
    if (!body) { json(res, 400, { error: "invalid_body" }); return true; }
    const result = ops.update(id, body as Parameters<typeof ops.update>[1]);
    json(res, result.ok ? 200 : (result.error === "not_found_or_builtin" ? 403 : 400), result);
    return true;
  }

  // DELETE /api/agent-definitions/:id — 기존 리소스의 scope로 권한 검사
  if (id_match && req.method === "DELETE") {
    const ops = ops_or_503(ctx);
    if (!ops) return true;
    const id = decodeURIComponent(id_match[1]);
    const existing = ops.get(id);
    if (!existing) { json(res, 404, { error: "not_found" }); return true; }
    if (!can_write_scope(ctx, existing.scope_type, existing.scope_id)) {
      json(res, 403, { error: "scope_write_denied" });
      return true;
    }
    const result = ops.delete(id);
    json(res, result.ok ? 200 : (result.error === "not_found_or_builtin" ? 403 : 404), result);
    return true;
  }

  return false;
}
