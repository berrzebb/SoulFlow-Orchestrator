import type { RouteContext } from "../route-context.js";

export async function handle_approval(ctx: RouteContext): Promise<boolean> {
  const { req, url, res, options, json, read_body } = ctx;

  if (url.pathname === "/api/approvals" && req.method === "GET") {
    const status = url.searchParams.get("status") || undefined;
    json(res, 200, options.agent.list_approval_requests(status as never));
    return true;
  }
  const id_match = url.pathname.match(/^\/api\/approvals\/([^/]+)$/);
  if (id_match && req.method === "GET") {
    const item = options.agent.get_approval_request(decodeURIComponent(id_match[1]));
    json(res, item ? 200 : 404, item ?? { error: "not_found" });
    return true;
  }
  const resolve_match = url.pathname.match(/^\/api\/approvals\/([^/]+)\/resolve$/);
  if (req.method === "POST" && resolve_match) {
    const approval_id = decodeURIComponent(resolve_match[1]);
    const body = await read_body(req);
    const text = String(body?.text || "approve").trim();
    const result = options.agent.resolve_approval_request(approval_id, text);
    if (!result.ok) { json(res, 404, result); return true; }
    if (result.decision === "approve") {
      const exec = await options.agent.execute_approved_request(approval_id);
      json(res, 200, { ...result, execution: exec });
      return true;
    }
    if (result.status === "denied" || result.status === "cancelled") {
      const request = options.agent.get_approval_request(approval_id);
      const task_id = request?.context?.task_id;
      if (task_id) {
        await options.task_ops?.cancel_task(task_id, `dashboard_approval_${result.status}`);
      }
    }
    json(res, 200, result);
    return true;
  }

  return false;
}
