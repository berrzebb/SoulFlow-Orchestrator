import type { RouteContext } from "../route-context.js";

export async function handle_approval(ctx: RouteContext): Promise<boolean> {
  const { req, url, res, options, json, read_body } = ctx;

  if (url.pathname !== "/api/approvals") return false;

  // GET /api/approvals?status=...
  if (req.method === "GET") {
    const status = url.searchParams.get("status") || undefined;
    json(res, 200, options.agent.list_approval_requests(status as never));
    return true;
  }

  // POST /api/approvals { approval_id, text? } — resolve
  if (req.method === "POST") {
    const body = await read_body(req);
    const approval_id = String(body?.approval_id || "").trim();
    if (!approval_id) { json(res, 400, { error: "approval_id_required" }); return true; }
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
