import type { RouteContext } from "../route-context.js";

export async function handle_channel(ctx: RouteContext): Promise<boolean> {
  const { req, url, res, options, json, read_body } = ctx;
  const path = url.pathname;

  // GET /api/channels/providers
  if (path === "/api/channels/providers" && req.method === "GET") {
    const ops = options.channel_ops;
    if (!ops) { json(res, 503, { error: "channel_ops_unavailable" }); return true; }
    json(res, 200, ops.list_providers());
    return true;
  }

  // GET /api/channels/status
  if (path === "/api/channels/status" && req.method === "GET") {
    const ops = options.channel_ops;
    if (!ops) { json(res, 503, { error: "channel_ops_unavailable" }); return true; }
    json(res, 200, await ops.list());
    return true;
  }

  // GET /api/channels/instances
  if (path === "/api/channels/instances" && req.method === "GET") {
    const ops = options.channel_ops;
    if (!ops) { json(res, 503, { error: "channel_ops_unavailable" }); return true; }
    json(res, 200, await ops.list());
    return true;
  }

  // POST /api/channels/instances { ...fields }
  if (path === "/api/channels/instances" && req.method === "POST") {
    const ops = options.channel_ops;
    if (!ops) { json(res, 503, { error: "channel_ops_unavailable" }); return true; }
    const body = await read_body(req);
    if (!body) { json(res, 400, { error: "invalid_body" }); return true; }
    const result = await ops.create(body as Parameters<typeof ops.create>[0]);
    json(res, result.ok ? 201 : 400, result);
    return true;
  }

  // GET /api/channels/instances/:id
  const id_match = path.match(/^\/api\/channels\/instances\/([^/]+)$/);
  if (id_match && req.method === "GET") {
    const ops = options.channel_ops;
    if (!ops) { json(res, 503, { error: "channel_ops_unavailable" }); return true; }
    const id = decodeURIComponent(id_match[1]);
    const info = await ops.get(id);
    json(res, info ? 200 : 404, info ?? { error: "not_found" });
    return true;
  }

  // PUT /api/channels/instances/:id { ...fields }
  if (id_match && req.method === "PUT") {
    const ops = options.channel_ops;
    if (!ops) { json(res, 503, { error: "channel_ops_unavailable" }); return true; }
    const id = decodeURIComponent(id_match[1]);
    const body = await read_body(req);
    if (!body) { json(res, 400, { error: "invalid_body" }); return true; }
    const result = await ops.update(id, body as Parameters<typeof ops.update>[1]);
    json(res, result.ok ? 200 : 400, result);
    return true;
  }

  // DELETE /api/channels/instances/:id
  if (id_match && req.method === "DELETE") {
    const ops = options.channel_ops;
    if (!ops) { json(res, 503, { error: "channel_ops_unavailable" }); return true; }
    const id = decodeURIComponent(id_match[1]);
    const result = await ops.remove(id);
    json(res, result.ok ? 200 : 404, result);
    return true;
  }

  // POST /api/channels/instances/:id/test
  const test_match = path.match(/^\/api\/channels\/instances\/([^/]+)\/test$/);
  if (test_match && req.method === "POST") {
    const ops = options.channel_ops;
    if (!ops) { json(res, 503, { error: "channel_ops_unavailable" }); return true; }
    const id = decodeURIComponent(test_match[1]);
    const result = await ops.test_connection(id);
    json(res, result.ok ? 200 : 400, result);
    return true;
  }

  return false;
}
