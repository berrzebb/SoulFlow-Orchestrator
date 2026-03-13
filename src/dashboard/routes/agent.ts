import type { RouteContext } from "../route-context.js";
import { get_filter_team_id } from "../route-context.js";

export async function handle_agent(ctx: RouteContext): Promise<boolean> {
  const { req, url, res, options, json, read_body } = ctx;
  const path = url.pathname;

  // GET /api/agents
  if (path === "/api/agents" && req.method === "GET") {
    const refs = options.agent.list_subagents(get_filter_team_id(ctx));
    const agents = refs.map((a) => ({
      id: a.id,
      label: a.label || a.id,
      role: a.role,
      model: a.model || "",
      status: a.status,
      session_id: a.session_id,
      created_at: a.created_at,
      updated_at: a.updated_at,
      last_error: a.last_error,
      last_message: a.last_result ? a.last_result.slice(0, 200) : "",
    }));
    json(res, 200, agents);
    return true;
  }

  // DELETE /api/agents/:id
  const id_match = path.match(/^\/api\/agents\/([^/]+)$/);
  if (id_match && req.method === "DELETE") {
    const agent_id = decodeURIComponent(id_match[1]);
    const ok = options.agent.cancel_subagent(agent_id, { team_id: get_filter_team_id(ctx) });
    json(res, ok ? 200 : 404, { cancelled: ok });
    return true;
  }

  // POST /api/agents/:id/input { text }
  const input_match = path.match(/^\/api\/agents\/([^/]+)\/input$/);
  if (input_match && req.method === "POST") {
    const body = await read_body(req);
    const agent_id = decodeURIComponent(input_match[1]);
    const text = String(body?.text || "").trim();
    if (!text) { json(res, 400, { error: "text_required" }); return true; }
    const ok = options.agent.send_input_to_subagent(agent_id, text, { team_id: get_filter_team_id(ctx) });
    json(res, ok ? 200 : 404, { sent: ok });
    return true;
  }

  return false;
}
