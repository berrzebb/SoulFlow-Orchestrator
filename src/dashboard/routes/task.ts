import type { RouteContext } from "../route-context.js";

export async function handle_task(ctx: RouteContext): Promise<boolean> {
  const { req, url, res, options, json, read_body, build_merged_tasks } = ctx;

  if (url.pathname !== "/api/tasks") return false;

  // GET /api/tasks — 전체 목록
  if (req.method === "GET") {
    json(res, 200, await build_merged_tasks());
    return true;
  }

  // DELETE /api/tasks { task_id } — 취소
  if (req.method === "DELETE") {
    const ops = options.task_ops;
    if (!ops) { json(res, 503, { error: "task_ops_unavailable" }); return true; }
    const body = await read_body(req);
    const task_id = String(body?.task_id || "").trim();
    if (!task_id) { json(res, 400, { error: "task_id_required" }); return true; }
    const result = await ops.cancel_task(task_id, "cancelled_from_dashboard");
    json(res, result ? 200 : 404, result ?? { error: "not_found" });
    return true;
  }

  // PUT /api/tasks { task_id, text? } — resume
  if (req.method === "PUT") {
    const ops = options.task_ops;
    if (!ops) { json(res, 503, { error: "task_ops_unavailable" }); return true; }
    const body = await read_body(req);
    const task_id = String(body?.task_id || "").trim();
    if (!task_id) { json(res, 400, { error: "task_id_required" }); return true; }
    const text = String(body?.text || "").trim() || undefined;
    const result = await ops.resume_task(task_id, text);
    json(res, result ? 200 : 404, result ?? { error: "not_found" });
    return true;
  }

  // POST /api/tasks { task_id, action } — detail/get 등 조회
  if (req.method === "POST") {
    const body = await read_body(req);
    const task_id = String(body?.task_id || "").trim();
    if (!task_id) { json(res, 400, { error: "task_id_required" }); return true; }
    const action = String(body?.action || "get").trim();

    if (action === "detail") {
      const detail = await options.events.read_task_detail(task_id);
      json(res, 200, { task_id, content: detail });
      return true;
    }

    const ops = options.task_ops;
    if (!ops) { json(res, 503, { error: "task_ops_unavailable" }); return true; }
    const task = await ops.get_task(task_id);
    json(res, task ? 200 : 404, task ?? { error: "not_found" });
    return true;
  }

  return false;
}
