import type { RouteContext } from "../route-context.js";

export async function handle_agent_provider(ctx: RouteContext): Promise<boolean> {
  const { req, url, res, options, json, read_body } = ctx;

  if (url.pathname === "/api/agent-providers/types" && req.method === "GET") {
    const ops = options.agent_provider_ops;
    if (!ops) { json(res, 503, { error: "agent_provider_ops_unavailable" }); return true; }
    json(res, 200, ops.list_provider_types());
    return true;
  }

  if (url.pathname !== "/api/agent-providers") return false;

  const ops = options.agent_provider_ops;
  if (!ops) { json(res, 503, { error: "agent_provider_ops_unavailable" }); return true; }

  if (req.method === "GET") {
    json(res, 200, await ops.list());
    return true;
  }

  // POST: 생성 또는 액션 (action 필드로 구분)
  if (req.method === "POST") {
    const body = await read_body(req);
    if (!body) { json(res, 400, { error: "invalid_body" }); return true; }
    const action = String((body as Record<string, unknown>).action || "").trim();

    if (action === "test") {
      const id = String((body as Record<string, unknown>).id || "").trim();
      if (!id) { json(res, 400, { error: "id_required" }); return true; }
      const result = await ops.test_availability(id);
      json(res, result.ok ? 200 : 400, result);
      return true;
    }
    if (action === "get") {
      const id = String((body as Record<string, unknown>).id || "").trim();
      if (!id) { json(res, 400, { error: "id_required" }); return true; }
      const info = await ops.get(id);
      json(res, info ? 200 : 404, info ?? { error: "not_found" });
      return true;
    }

    const result = await ops.create(body as Parameters<typeof ops.create>[0]);
    json(res, result.ok ? 201 : 400, result);
    return true;
  }

  // PUT: { id, ...fields } — 수정
  if (req.method === "PUT") {
    const body = await read_body(req);
    if (!body) { json(res, 400, { error: "invalid_body" }); return true; }
    const id = String((body as Record<string, unknown>).id || "").trim();
    if (!id) { json(res, 400, { error: "id_required" }); return true; }
    const result = await ops.update(id, body as Parameters<typeof ops.update>[1]);
    json(res, result.ok ? 200 : 400, result);
    return true;
  }

  // DELETE: { id } — 삭제
  if (req.method === "DELETE") {
    const body = await read_body(req);
    const id = String(body?.id || "").trim();
    if (!id) { json(res, 400, { error: "id_required" }); return true; }
    const result = await ops.remove(id);
    json(res, result.ok ? 200 : 404, result);
    return true;
  }

  return false;
}
