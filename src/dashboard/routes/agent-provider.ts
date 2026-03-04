import type { RouteContext } from "../route-context.js";

export async function handle_agent_provider(ctx: RouteContext): Promise<boolean> {
  const { req, url, res, options, json, read_body } = ctx;

  if (url.pathname === "/api/agent-providers" && req.method === "GET") {
    const ops = options.agent_provider_ops;
    if (!ops) { json(res, 503, { error: "agent_provider_ops_unavailable" }); return true; }
    json(res, 200, await ops.list());
    return true;
  }
  if (url.pathname === "/api/agent-providers/types" && req.method === "GET") {
    const ops = options.agent_provider_ops;
    if (!ops) { json(res, 503, { error: "agent_provider_ops_unavailable" }); return true; }
    json(res, 200, ops.list_provider_types());
    return true;
  }
  if (url.pathname === "/api/agent-providers" && req.method === "POST") {
    const ops = options.agent_provider_ops;
    if (!ops) { json(res, 503, { error: "agent_provider_ops_unavailable" }); return true; }
    const body = await read_body(req);
    if (!body) { json(res, 400, { error: "invalid_body" }); return true; }
    const result = await ops.create(body as Parameters<typeof ops.create>[0]);
    json(res, result.ok ? 201 : 400, result);
    return true;
  }
  const ap_match = url.pathname.match(/^\/api\/agent-providers\/([^/]+)$/);
  if (ap_match) {
    const ops = options.agent_provider_ops;
    if (!ops) { json(res, 503, { error: "agent_provider_ops_unavailable" }); return true; }
    const id = decodeURIComponent(ap_match[1]);
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
  const test_match = url.pathname.match(/^\/api\/agent-providers\/([^/]+)\/test$/);
  if (req.method === "POST" && test_match) {
    const ops = options.agent_provider_ops;
    if (!ops) { json(res, 503, { error: "agent_provider_ops_unavailable" }); return true; }
    const result = await ops.test_availability(decodeURIComponent(test_match[1]));
    json(res, result.ok ? 200 : 400, result);
    return true;
  }

  return false;
}
