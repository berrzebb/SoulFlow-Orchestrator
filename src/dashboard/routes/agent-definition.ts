import type { RouteContext } from "../route-context.js";
import { require_superadmin_for_write } from "../route-context.js";
import type { DashboardAgentDefinitionOps } from "../ops/agent-definition.js";

function ops_or_503(ctx: RouteContext): DashboardAgentDefinitionOps | null {
  const ops = (ctx.options as Record<string, unknown>).agent_definition_ops as DashboardAgentDefinitionOps | null | undefined;
  if (!ops) ctx.json(ctx.res, 503, { error: "agent_definition_ops_unavailable" });
  return ops ?? null;
}

export async function handle_agent_definition(ctx: RouteContext): Promise<boolean> {
  if (!require_superadmin_for_write(ctx)) return true;
  const { req, url, res, json, read_body } = ctx;
  const path = url.pathname;

  // GET /api/agent-definitions
  if (path === "/api/agent-definitions" && req.method === "GET") {
    const ops = ops_or_503(ctx);
    if (!ops) return true;
    json(res, 200, ops.list());
    return true;
  }

  // POST /api/agent-definitions/generate
  if (path === "/api/agent-definitions/generate" && req.method === "POST") {
    const ops = ops_or_503(ctx);
    if (!ops) return true;
    const body = await read_body(req);
    const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) { json(res, 400, { error: "prompt_required" }); return true; }
    const result = await ops.generate(prompt);
    json(res, result.ok ? 200 : (result.error === "generate_unavailable" ? 503 : 500), result);
    return true;
  }

  // POST /api/agent-definitions
  if (path === "/api/agent-definitions" && req.method === "POST") {
    const ops = ops_or_503(ctx);
    if (!ops) return true;
    const body = await read_body(req);
    if (!body) { json(res, 400, { error: "invalid_body" }); return true; }
    const result = ops.create(body as Parameters<typeof ops.create>[0]);
    json(res, result.ok ? 201 : 400, result);
    return true;
  }

  // POST /api/agent-definitions/:id/fork
  const fork_match = path.match(/^\/api\/agent-definitions\/([^/]+)\/fork$/);
  if (fork_match && req.method === "POST") {
    const ops = ops_or_503(ctx);
    if (!ops) return true;
    const id = decodeURIComponent(fork_match[1]);
    const result = ops.fork(id);
    json(res, result.ok ? 201 : 404, result);
    return true;
  }

  // GET /api/agent-definitions/:id
  const id_match = path.match(/^\/api\/agent-definitions\/([^/]+)$/);
  if (id_match && req.method === "GET") {
    const ops = ops_or_503(ctx);
    if (!ops) return true;
    const id = decodeURIComponent(id_match[1]);
    const data = ops.get(id);
    if (!data) { json(res, 404, { error: "not_found" }); return true; }
    json(res, 200, data);
    return true;
  }

  // PUT /api/agent-definitions/:id
  if (id_match && req.method === "PUT") {
    const ops = ops_or_503(ctx);
    if (!ops) return true;
    const id = decodeURIComponent(id_match[1]);
    const body = await read_body(req);
    if (!body) { json(res, 400, { error: "invalid_body" }); return true; }
    const result = ops.update(id, body as Parameters<typeof ops.update>[1]);
    json(res, result.ok ? 200 : (result.error === "not_found_or_builtin" ? 403 : 400), result);
    return true;
  }

  // DELETE /api/agent-definitions/:id
  if (id_match && req.method === "DELETE") {
    const ops = ops_or_503(ctx);
    if (!ops) return true;
    const id = decodeURIComponent(id_match[1]);
    const result = ops.delete(id);
    json(res, result.ok ? 200 : (result.error === "not_found_or_builtin" ? 403 : 404), result);
    return true;
  }

  return false;
}
