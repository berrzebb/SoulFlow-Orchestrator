import type { RouteContext } from "../route-context.js";

export async function handle_channel(ctx: RouteContext): Promise<boolean> {
  const { req, url, res, options, json, read_body } = ctx;

  if (url.pathname === "/api/channel-instances/providers" && req.method === "GET") {
    const ops = options.channel_ops;
    if (!ops) { json(res, 503, { error: "channel_ops_unavailable" }); return true; }
    json(res, 200, ops.list_providers());
    return true;
  }

  // Legacy 후방 호환
  if (url.pathname === "/api/channel-status" && req.method === "GET") {
    const ops = options.channel_ops;
    if (!ops) { json(res, 503, { error: "channel_ops_unavailable" }); return true; }
    json(res, 200, await ops.list());
    return true;
  }

  if (url.pathname !== "/api/channel-instances") return false;

  const ops = options.channel_ops;
  if (!ops) { json(res, 503, { error: "channel_ops_unavailable" }); return true; }

  // GET /api/channel-instances — 목록
  if (req.method === "GET") {
    json(res, 200, await ops.list());
    return true;
  }

  // POST /api/channel-instances { ...fields } — 생성
  // POST /api/channel-instances { action: "get"|"test", id } — 단건 조회/테스트
  if (req.method === "POST") {
    const body = await read_body(req);
    if (!body) { json(res, 400, { error: "invalid_body" }); return true; }
    const action = String(body.action || "").trim();

    if (action === "get") {
      const id = String(body.id || "").trim();
      if (!id) { json(res, 400, { error: "id_required" }); return true; }
      const info = await ops.get(id);
      json(res, info ? 200 : 404, info ?? { error: "not_found" });
      return true;
    }
    if (action === "test") {
      const id = String(body.id || "").trim();
      if (!id) { json(res, 400, { error: "id_required" }); return true; }
      const result = await ops.test_connection(id);
      json(res, result.ok ? 200 : 400, result);
      return true;
    }

    // action 없으면 생성
    const result = await ops.create(body as Parameters<typeof ops.create>[0]);
    json(res, result.ok ? 201 : 400, result);
    return true;
  }

  // PUT /api/channel-instances { id, ...fields } — 수정
  if (req.method === "PUT") {
    const body = await read_body(req);
    if (!body) { json(res, 400, { error: "invalid_body" }); return true; }
    const id = String(body.id || "").trim();
    if (!id) { json(res, 400, { error: "id_required" }); return true; }
    const result = await ops.update(id, body as Parameters<typeof ops.update>[1]);
    json(res, result.ok ? 200 : 400, result);
    return true;
  }

  // DELETE /api/channel-instances { id } — 삭제
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
