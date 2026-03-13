import type { RouteContext } from "../route-context.js";
import { get_filter_team_id } from "../route-context.js";

export async function handle_task(ctx: RouteContext): Promise<boolean> {
  const { req, url, res, options, json, read_body, build_merged_tasks } = ctx;
  const path = url.pathname;

  // GET /api/tasks
  if (path === "/api/tasks" && req.method === "GET") {
    json(res, 200, await build_merged_tasks(get_filter_team_id(ctx)));
    return true;
  }

  // GET /api/tasks/:id
  const id_match = path.match(/^\/api\/tasks\/([^/]+)$/);
  const scope = { team_id: get_filter_team_id(ctx) };
  if (id_match && req.method === "GET") {
    const ops = options.task_ops;
    if (!ops) { json(res, 503, { error: "task_ops_unavailable" }); return true; }
    const task_id = decodeURIComponent(id_match[1]);
    const task = await ops.get_task(task_id, scope);
    json(res, task ? 200 : 404, task ?? { error: "not_found" });
    return true;
  }

  // DELETE /api/tasks/:id
  if (id_match && req.method === "DELETE") {
    const ops = options.task_ops;
    if (!ops) { json(res, 503, { error: "task_ops_unavailable" }); return true; }
    const task_id = decodeURIComponent(id_match[1]);
    const result = await ops.cancel_task(task_id, "cancelled_from_dashboard", scope);
    json(res, result ? 200 : 404, result ?? { error: "not_found" });
    return true;
  }

  // PUT /api/tasks/:id { text? } — resume
  if (id_match && req.method === "PUT") {
    const ops = options.task_ops;
    if (!ops) { json(res, 503, { error: "task_ops_unavailable" }); return true; }
    const task_id = decodeURIComponent(id_match[1]);
    const body = await read_body(req);
    const text = String(body?.text || "").trim() || undefined;
    const result = await ops.resume_task(task_id, text, scope);
    json(res, result ? 200 : 404, result ?? { error: "not_found" });
    return true;
  }

  // GET /api/tasks/:id/detail
  const detail_match = path.match(/^\/api\/tasks\/([^/]+)\/detail$/);
  if (detail_match && req.method === "GET") {
    const task_id = decodeURIComponent(detail_match[1]);
    const detail = await options.events.read_task_detail(task_id);
    json(res, 200, { task_id, content: detail });
    return true;
  }

  return false;
}
