import type { RouteContext } from "../route-context.js";

export async function handle_bootstrap(ctx: RouteContext): Promise<boolean> {
  const { req, url, res, options, json, read_body } = ctx;

  if (url.pathname === "/api/bootstrap/status" && req.method === "GET") {
    const ops = options.bootstrap_ops;
    if (!ops) { json(res, 503, { error: "bootstrap_unavailable" }); return true; }
    json(res, 200, ops.get_status());
    return true;
  }
  if (url.pathname === "/api/bootstrap" && req.method === "POST") {
    const ops = options.bootstrap_ops;
    if (!ops) { json(res, 503, { error: "bootstrap_unavailable" }); return true; }
    const body = await read_body(req);
    if (!body) { json(res, 400, { error: "invalid_body" }); return true; }
    const result = await ops.apply(body as Parameters<typeof ops.apply>[0]);
    json(res, result.ok ? 200 : 400, result);
    return true;
  }

  return false;
}
