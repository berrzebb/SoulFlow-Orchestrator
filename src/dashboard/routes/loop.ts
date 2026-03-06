import type { RouteContext } from "../route-context.js";

export async function handle_loop(ctx: RouteContext): Promise<boolean> {
  const { req, url, res, options, json, read_body } = ctx;
  const path = url.pathname;

  // GET /api/loops
  if (path === "/api/loops" && req.method === "GET") {
    json(res, 200, options.agent.list_active_loops());
    return true;
  }

  // DELETE /api/loops/:id
  const id_match = path.match(/^\/api\/loops\/([^/]+)$/);
  if (id_match && req.method === "DELETE") {
    const loop_id = decodeURIComponent(id_match[1]);
    const body = await read_body(req);
    const reason = String(body?.reason || "stopped_from_dashboard").trim();
    const result = options.agent.stop_loop(loop_id, reason);
    json(res, result ? 200 : 404, result ?? { error: "not_found" });
    return true;
  }

  return false;
}
