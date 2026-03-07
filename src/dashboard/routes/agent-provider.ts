import type { RouteContext } from "../route-context.js";

export async function handle_agent_provider(ctx: RouteContext): Promise<boolean> {
  const { req, url, res, options, json, read_body } = ctx;
  const path = url.pathname;

  // GET /api/agents/providers/types
  if (path === "/api/agents/providers/types" && req.method === "GET") {
    const ops = options.agent_provider_ops;
    if (!ops) { json(res, 503, { error: "agent_provider_ops_unavailable" }); return true; }
    json(res, 200, ops.list_provider_types());
    return true;
  }

  // GET /api/agents/providers/models/:provider_type — 프로바이더 타입별 모델 목록
  const type_models_match = path.match(/^\/api\/agents\/providers\/models\/([^/]+)$/);
  if (type_models_match && req.method === "GET") {
    const ops = options.agent_provider_ops;
    if (!ops) { json(res, 503, { error: "agent_provider_ops_unavailable" }); return true; }
    const provider_type = decodeURIComponent(type_models_match[1]);
    const api_base = url.searchParams.get("api_base") || undefined;
    const models = await ops.list_models(provider_type, { api_base });
    json(res, 200, models);
    return true;
  }

  // GET /api/agents/providers
  if (path === "/api/agents/providers" && req.method === "GET") {
    const ops = options.agent_provider_ops;
    if (!ops) { json(res, 503, { error: "agent_provider_ops_unavailable" }); return true; }
    json(res, 200, await ops.list());
    return true;
  }

  // POST /api/agents/providers { ...fields }
  if (path === "/api/agents/providers" && req.method === "POST") {
    const ops = options.agent_provider_ops;
    if (!ops) { json(res, 503, { error: "agent_provider_ops_unavailable" }); return true; }
    const body = await read_body(req);
    if (!body) { json(res, 400, { error: "invalid_body" }); return true; }
    const result = await ops.create(body as Parameters<typeof ops.create>[0]);
    json(res, result.ok ? 201 : 400, result);
    return true;
  }

  // POST /api/agents/providers/:id/test
  const test_match = path.match(/^\/api\/agents\/providers\/([^/]+)\/test$/);
  if (test_match && req.method === "POST") {
    const ops = options.agent_provider_ops;
    if (!ops) { json(res, 503, { error: "agent_provider_ops_unavailable" }); return true; }
    const id = decodeURIComponent(test_match[1]);
    const result = await ops.test_availability(id);
    json(res, result.ok ? 200 : 400, result);
    return true;
  }

  // GET /api/agents/providers/:id/models — 인스턴스별 모델 목록
  const inst_models_match = path.match(/^\/api\/agents\/providers\/([^/]+)\/models$/);
  if (inst_models_match && req.method === "GET") {
    const ops = options.agent_provider_ops;
    if (!ops) { json(res, 503, { error: "agent_provider_ops_unavailable" }); return true; }
    const id = decodeURIComponent(inst_models_match[1]);
    const config = await ops.get(id);
    if (!config) { json(res, 404, { error: "not_found" }); return true; }
    // connection의 api_base를 우선 사용, 없으면 인스턴스 settings의 api_base
    let api_base = typeof config.settings?.api_base === "string" ? config.settings.api_base : undefined;
    if (config.connection_id) {
      const conn = await ops.get_connection(config.connection_id);
      if (conn?.api_base) api_base = conn.api_base;
    }
    const models = await ops.list_models(config.provider_type, { api_base });
    json(res, 200, models);
    return true;
  }

  // GET /api/agents/providers/:id
  const id_match = path.match(/^\/api\/agents\/providers\/([^/]+)$/);
  if (id_match && req.method === "GET") {
    const ops = options.agent_provider_ops;
    if (!ops) { json(res, 503, { error: "agent_provider_ops_unavailable" }); return true; }
    const id = decodeURIComponent(id_match[1]);
    const info = await ops.get(id);
    json(res, info ? 200 : 404, info ?? { error: "not_found" });
    return true;
  }

  // PUT /api/agents/providers/:id { ...fields }
  if (id_match && req.method === "PUT") {
    const ops = options.agent_provider_ops;
    if (!ops) { json(res, 503, { error: "agent_provider_ops_unavailable" }); return true; }
    const id = decodeURIComponent(id_match[1]);
    const body = await read_body(req);
    if (!body) { json(res, 400, { error: "invalid_body" }); return true; }
    const result = await ops.update(id, body as Parameters<typeof ops.update>[1]);
    json(res, result.ok ? 200 : 400, result);
    return true;
  }

  // DELETE /api/agents/providers/:id
  if (id_match && req.method === "DELETE") {
    const ops = options.agent_provider_ops;
    if (!ops) { json(res, 503, { error: "agent_provider_ops_unavailable" }); return true; }
    const id = decodeURIComponent(id_match[1]);
    const result = await ops.remove(id);
    json(res, result.ok ? 200 : 404, result);
    return true;
  }

  // ── Connection 엔드포인트 ──

  // GET /api/agents/connections
  if (path === "/api/agents/connections" && req.method === "GET") {
    const ops = options.agent_provider_ops;
    if (!ops) { json(res, 503, { error: "agent_provider_ops_unavailable" }); return true; }
    json(res, 200, await ops.list_connections());
    return true;
  }

  // POST /api/agents/connections
  if (path === "/api/agents/connections" && req.method === "POST") {
    const ops = options.agent_provider_ops;
    if (!ops) { json(res, 503, { error: "agent_provider_ops_unavailable" }); return true; }
    const body = await read_body(req);
    if (!body) { json(res, 400, { error: "invalid_body" }); return true; }
    const result = await ops.create_connection(body as Parameters<typeof ops.create_connection>[0]);
    json(res, result.ok ? 201 : 400, result);
    return true;
  }

  // POST /api/agents/connections/:id/test
  const conn_test_match = path.match(/^\/api\/agents\/connections\/([^/]+)\/test$/);
  if (conn_test_match && req.method === "POST") {
    const ops = options.agent_provider_ops;
    if (!ops) { json(res, 503, { error: "agent_provider_ops_unavailable" }); return true; }
    const id = decodeURIComponent(conn_test_match[1]);
    const result = await ops.test_connection(id);
    json(res, result.ok ? 200 : 400, result);
    return true;
  }

  // GET /api/agents/connections/:id/models — connection별 모델 목록
  const conn_models_match = path.match(/^\/api\/agents\/connections\/([^/]+)\/models$/);
  if (conn_models_match && req.method === "GET") {
    const ops = options.agent_provider_ops;
    if (!ops) { json(res, 503, { error: "agent_provider_ops_unavailable" }); return true; }
    const id = decodeURIComponent(conn_models_match[1]);
    const conn = await ops.get_connection(id);
    if (!conn) { json(res, 404, { error: "not_found" }); return true; }
    const models = await ops.list_models(conn.provider_type, { api_base: conn.api_base });
    json(res, 200, models);
    return true;
  }

  // GET /api/agents/connections/:id
  const conn_id_match = path.match(/^\/api\/agents\/connections\/([^/]+)$/);
  if (conn_id_match && req.method === "GET") {
    const ops = options.agent_provider_ops;
    if (!ops) { json(res, 503, { error: "agent_provider_ops_unavailable" }); return true; }
    const id = decodeURIComponent(conn_id_match[1]);
    const info = await ops.get_connection(id);
    json(res, info ? 200 : 404, info ?? { error: "not_found" });
    return true;
  }

  // PUT /api/agents/connections/:id
  if (conn_id_match && req.method === "PUT") {
    const ops = options.agent_provider_ops;
    if (!ops) { json(res, 503, { error: "agent_provider_ops_unavailable" }); return true; }
    const id = decodeURIComponent(conn_id_match[1]);
    const body = await read_body(req);
    if (!body) { json(res, 400, { error: "invalid_body" }); return true; }
    const result = await ops.update_connection(id, body as Parameters<typeof ops.update_connection>[1]);
    json(res, result.ok ? 200 : 400, result);
    return true;
  }

  // DELETE /api/agents/connections/:id
  if (conn_id_match && req.method === "DELETE") {
    const ops = options.agent_provider_ops;
    if (!ops) { json(res, 503, { error: "agent_provider_ops_unavailable" }); return true; }
    const id = decodeURIComponent(conn_id_match[1]);
    const result = await ops.remove_connection(id);
    json(res, result.ok ? 200 : 404, result);
    return true;
  }

  return false;
}
