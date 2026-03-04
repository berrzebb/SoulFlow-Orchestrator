import type { RouteContext } from "../route-context.js";

export async function handle_process(ctx: RouteContext): Promise<boolean> {
  const { req, url, res, options, json } = ctx;

  if (url.pathname === "/api/processes" && req.method === "GET") {
    const tracker = options.process_tracker;
    json(res, 200, { active: tracker?.list_active() ?? [], recent: tracker?.list_recent(20) ?? [] });
    return true;
  }
  const cancel_match = url.pathname.match(/^\/api\/processes\/([^/]+)\/cancel$/);
  if (req.method === "POST" && cancel_match) {
    const tracker = options.process_tracker;
    if (!tracker) { json(res, 503, { error: "process_tracker_unavailable" }); return true; }
    const result = await tracker.cancel(cancel_match[1]);
    json(res, result.cancelled ? 200 : 404, result);
    return true;
  }
  const id_match = url.pathname.match(/^\/api\/processes\/([^/]+)$/);
  if (id_match) {
    const entry = options.process_tracker?.get(id_match[1]);
    json(res, entry ? 200 : 404, entry ?? { error: "not_found" });
    return true;
  }

  return false;
}
