import type { RouteContext } from "../route-context.js";
import { get_filter_team_id } from "../route-context.js";

export async function handle_process(ctx: RouteContext): Promise<boolean> {
  const { req, url, res, options, json } = ctx;
  const path = url.pathname;
  const team_id = get_filter_team_id(ctx);

  // GET /api/processes
  if (path === "/api/processes" && req.method === "GET") {
    const tracker = options.process_tracker;
    json(res, 200, { active: tracker?.list_active(team_id) ?? [], recent: tracker?.list_recent(20, team_id) ?? [] });
    return true;
  }

  // GET /api/processes/:id
  const id_match = path.match(/^\/api\/processes\/([^/]+)$/);
  if (id_match && req.method === "GET") {
    const run_id = decodeURIComponent(id_match[1]);
    const entry = options.process_tracker?.get(run_id);
    json(res, entry ? 200 : 404, entry ?? { error: "not_found" });
    return true;
  }

  // DELETE /api/processes/:id
  if (id_match && req.method === "DELETE") {
    const tracker = options.process_tracker;
    if (!tracker) { json(res, 503, { error: "process_tracker_unavailable" }); return true; }
    const run_id = decodeURIComponent(id_match[1]);
    const result = await tracker.cancel(run_id, { team_id });
    json(res, result.cancelled ? 200 : 404, result);
    return true;
  }

  return false;
}
