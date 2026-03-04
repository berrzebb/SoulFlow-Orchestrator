import type { RouteContext } from "../route-context.js";

export async function handle_agent(ctx: RouteContext): Promise<boolean> {
  const { req, url, res, options, json, read_body } = ctx;

  if (url.pathname === "/api/agents" && req.method === "GET") {
    json(res, 200, options.agent.list_subagents());
    return true;
  }
  const cancel_match = url.pathname.match(/^\/api\/agents\/([^/]+)\/cancel$/);
  if (req.method === "POST" && cancel_match) {
    const ok = options.agent.cancel_subagent(cancel_match[1]);
    json(res, ok ? 200 : 404, { cancelled: ok });
    return true;
  }
  const send_match = url.pathname.match(/^\/api\/agents\/([^/]+)\/send$/);
  if (req.method === "POST" && send_match) {
    const body = await read_body(req);
    const text = String(body?.text || "").trim();
    if (!text) { json(res, 400, { error: "text_required" }); return true; }
    const ok = options.agent.send_input_to_subagent(send_match[1], text);
    json(res, ok ? 200 : 404, { sent: ok });
    return true;
  }

  return false;
}
