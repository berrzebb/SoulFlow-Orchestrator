import type { RouteContext } from "../route-context.js";
import type { AgentApprovalStatus } from "../../agent/runtime.types.js";

export async function handle_approval(ctx: RouteContext): Promise<boolean> {
  const { req, url, res, options, json, read_body } = ctx;
  const path = url.pathname;

  // GET /api/approvals?status=...
  if (path === "/api/approvals" && req.method === "GET") {
    const status = (url.searchParams.get("status") || undefined) as AgentApprovalStatus | undefined;
    json(res, 200, options.agent.list_approval_requests(status));
    return true;
  }

  // POST /api/approvals/:id/resolve { text? }
  const resolve_match = path.match(/^\/api\/approvals\/([^/]+)\/resolve$/);
  if (resolve_match && req.method === "POST") {
    const approval_id = decodeURIComponent(resolve_match[1]);
    const body = await read_body(req);
    const text = String(body?.text || "approve").trim();
    const result = options.agent.resolve_approval_request(approval_id, text);
    if (!result.ok) { json(res, 404, result); return true; }
    if (result.decision === "approve") {
      const exec = await options.agent.execute_approved_request(approval_id);
      json(res, 200, { ...result, execution: exec });
      // 비동기 task 재개: bridge가 아닌 경우 task loop를 재시작
      const request = options.agent.get_approval_request(approval_id);
      const task_id = request?.context?.task_id;
      if (task_id && exec.ok && options.channels) {
        options.channels.resume_after_dashboard_approval({
          task_id,
          tool_result: String(exec.result || ""),
          provider: String(request?.context?.channel || "web"),
          chat_id: String(request?.context?.chat_id || ""),
        }).catch(() => { /* best-effort: 실패 시 ChannelManager가 내부 로깅 처리 */ });
      }
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
