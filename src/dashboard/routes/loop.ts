import type { RouteContext } from "../route-context.js";

export async function handle_loop(ctx: RouteContext): Promise<boolean> {
  const { req, url, res, options, json, read_body } = ctx;

  if (url.pathname === "/api/loops" && req.method === "GET") {
    json(res, 200, options.agent.list_active_loops());
    return true;
  }
  const stop_match = url.pathname.match(/^\/api\/loops\/([^/]+)\/stop$/);
  if (req.method === "POST" && stop_match) {
    const body = await read_body(req);
    const reason = String(body?.reason || "stopped_from_dashboard").trim();
    const result = options.agent.stop_loop(decodeURIComponent(stop_match[1]), reason);
    json(res, result ? 200 : 404, result ?? { error: "not_found" });
    return true;
  }

  return false;
}
