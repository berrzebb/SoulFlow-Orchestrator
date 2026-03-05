import type { RouteContext } from "../route-context.js";

export async function handle_agent(ctx: RouteContext): Promise<boolean> {
  const { req, url, res, options, json, read_body } = ctx;

  if (url.pathname !== "/api/agents") return false;

  // GET /api/agents — 목록
  if (req.method === "GET") {
    json(res, 200, options.agent.list_subagents());
    return true;
  }

  // DELETE /api/agents { agent_id } — 취소
  if (req.method === "DELETE") {
    const body = await read_body(req);
    const agent_id = String(body?.agent_id || "").trim();
    if (!agent_id) { json(res, 400, { error: "agent_id_required" }); return true; }
    const ok = options.agent.cancel_subagent(agent_id);
    json(res, ok ? 200 : 404, { cancelled: ok });
    return true;
  }

  // POST /api/agents { agent_id, text } — 입력 전송
  if (req.method === "POST") {
    const body = await read_body(req);
    const agent_id = String(body?.agent_id || "").trim();
    const text = String(body?.text || "").trim();
    if (!agent_id) { json(res, 400, { error: "agent_id_required" }); return true; }
    if (!text) { json(res, 400, { error: "text_required" }); return true; }
    const ok = options.agent.send_input_to_subagent(agent_id, text);
    json(res, ok ? 200 : 404, { sent: ok });
    return true;
  }

  return false;
}
