import type { RouteContext } from "../route-context.js";

export async function handle_loop(ctx: RouteContext): Promise<boolean> {
  const { req, url, res, options, json, read_body } = ctx;

  if (url.pathname !== "/api/loops") return false;

  if (req.method === "GET") {
    json(res, 200, options.agent.list_active_loops());
    return true;
  }

  // DELETE /api/loops { loop_id, reason? } — 중지
  if (req.method === "DELETE") {
    const body = await read_body(req);
    const loop_id = String(body?.loop_id || "").trim();
    if (!loop_id) { json(res, 400, { error: "loop_id_required" }); return true; }
    const reason = String(body?.reason || "stopped_from_dashboard").trim();
    const result = options.agent.stop_loop(loop_id, reason);
    json(res, result ? 200 : 404, result ?? { error: "not_found" });
    return true;
  }

  return false;
}
