import type { RouteContext } from "../route-context.js";

export async function handle_task(ctx: RouteContext): Promise<boolean> {
  const { req, url, res, options, json, read_body, build_merged_tasks } = ctx;

  if (url.pathname === "/api/tasks" && req.method === "GET") {
    json(res, 200, await build_merged_tasks());
    return true;
  }
  const cancel_match = url.pathname.match(/^\/api\/tasks\/([^/]+)\/cancel$/);
  if (req.method === "POST" && cancel_match) {
    const ops = options.task_ops;
    if (!ops) { json(res, 503, { error: "task_ops_unavailable" }); return true; }
    const result = await ops.cancel_task(cancel_match[1], "cancelled_from_dashboard");
    json(res, result ? 200 : 404, result ?? { error: "not_found" });
    return true;
  }
  const resume_match = url.pathname.match(/^\/api\/tasks\/([^/]+)\/resume$/);
  if (req.method === "POST" && resume_match) {
    const ops = options.task_ops;
    if (!ops) { json(res, 503, { error: "task_ops_unavailable" }); return true; }
    const body = await read_body(req);
    const text = String(body?.text || "").trim() || undefined;
    const result = await ops.resume_task(decodeURIComponent(resume_match[1]), text);
    json(res, result ? 200 : 404, result ?? { error: "not_found" });
    return true;
  }
  const detail_match = url.pathname.match(/^\/api\/tasks\/([^/]+)\/detail$/);
  if (detail_match && req.method === "GET") {
    const detail = await options.events.read_task_detail(decodeURIComponent(detail_match[1]));
    json(res, 200, { task_id: detail_match[1], content: detail });
    return true;
  }
  const id_match = url.pathname.match(/^\/api\/tasks\/([^/]+)$/);
  if (id_match && req.method === "GET") {
    const ops = options.task_ops;
    if (!ops) { json(res, 503, { error: "task_ops_unavailable" }); return true; }
    const task = await ops.get_task(id_match[1]);
    json(res, task ? 200 : 404, task ?? { error: "not_found" });
    return true;
  }

  return false;
}
