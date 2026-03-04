import type { RouteContext } from "../route-context.js";

export async function handle_channel(ctx: RouteContext): Promise<boolean> {
  const { req, url, res, options, json, read_body } = ctx;

  if (url.pathname === "/api/channel-instances" && req.method === "GET") {
    const ops = options.channel_ops;
    if (!ops) { json(res, 503, { error: "channel_ops_unavailable" }); return true; }
    json(res, 200, await ops.list());
    return true;
  }
  if (url.pathname === "/api/channel-instances/providers" && req.method === "GET") {
    const ops = options.channel_ops;
    if (!ops) { json(res, 503, { error: "channel_ops_unavailable" }); return true; }
    json(res, 200, ops.list_providers());
    return true;
  }
  if (url.pathname === "/api/channel-instances" && req.method === "POST") {
    const ops = options.channel_ops;
    if (!ops) { json(res, 503, { error: "channel_ops_unavailable" }); return true; }
    const body = await read_body(req);
    if (!body) { json(res, 400, { error: "invalid_body" }); return true; }
    const result = await ops.create(body as Parameters<typeof ops.create>[0]);
    json(res, result.ok ? 201 : 400, result);
    return true;
  }
  const ci_match = url.pathname.match(/^\/api\/channel-instances\/([^/]+)$/);
  if (ci_match) {
    const ops = options.channel_ops;
    if (!ops) { json(res, 503, { error: "channel_ops_unavailable" }); return true; }
    const id = decodeURIComponent(ci_match[1]);
    if (req.method === "GET") {
      const info = await ops.get(id);
      if (!info) { json(res, 404, { error: "not_found" }); return true; }
      json(res, 200, info);
      return true;
    }
    if (req.method === "PUT") {
      const body = await read_body(req);
      if (!body) { json(res, 400, { error: "invalid_body" }); return true; }
      const result = await ops.update(id, body as Parameters<typeof ops.update>[1]);
      json(res, result.ok ? 200 : 400, result);
      return true;
    }
    if (req.method === "DELETE") {
      const result = await ops.remove(id);
      json(res, result.ok ? 200 : 404, result);
      return true;
    }
  }
  const test_match = url.pathname.match(/^\/api\/channel-instances\/([^/]+)\/test$/);
  if (req.method === "POST" && test_match) {
    const ops = options.channel_ops;
    if (!ops) { json(res, 503, { error: "channel_ops_unavailable" }); return true; }
    const result = await ops.test_connection(decodeURIComponent(test_match[1]));
    json(res, result.ok ? 200 : 400, result);
    return true;
  }
  // Legacy channel-status (후방 호환)
  if (url.pathname === "/api/channel-status" && req.method === "GET") {
    const ops = options.channel_ops;
    if (!ops) { json(res, 503, { error: "channel_ops_unavailable" }); return true; }
    json(res, 200, await ops.list());
    return true;
  }

  return false;
}
