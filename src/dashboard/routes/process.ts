import type { RouteContext } from "../route-context.js";

export async function handle_process(ctx: RouteContext): Promise<boolean> {
  const { req, url, res, options, json, read_body } = ctx;

  if (url.pathname !== "/api/processes") return false;

  // GET /api/processes — 목록
  if (req.method === "GET") {
    const tracker = options.process_tracker;
    json(res, 200, { active: tracker?.list_active() ?? [], recent: tracker?.list_recent(20) ?? [] });
    return true;
  }

  // DELETE /api/processes { run_id } — 취소
  if (req.method === "DELETE") {
    const tracker = options.process_tracker;
    if (!tracker) { json(res, 503, { error: "process_tracker_unavailable" }); return true; }
    const body = await read_body(req);
    const run_id = String(body?.run_id || "").trim();
    if (!run_id) { json(res, 400, { error: "run_id_required" }); return true; }
    const result = await tracker.cancel(run_id);
    json(res, result.cancelled ? 200 : 404, result);
    return true;
  }

  // POST /api/processes { run_id } — 단건 조회
  if (req.method === "POST") {
    const body = await read_body(req);
    const run_id = String(body?.run_id || "").trim();
    if (!run_id) { json(res, 400, { error: "run_id_required" }); return true; }
    const entry = options.process_tracker?.get(run_id);
    json(res, entry ? 200 : 404, entry ?? { error: "not_found" });
    return true;
  }

  return false;
}
