import type { RouteContext } from "../route-context.js";

export async function handle_workspace(ctx: RouteContext): Promise<boolean> {
  const { req, url, res, options, json } = ctx;
  const path = url.pathname;

  // GET /api/workspace/entries?path=
  if (path === "/api/workspace/entries" && req.method === "GET") {
    if (!options.workspace_ops) { json(res, 503, { error: "workspace_unavailable" }); return true; }
    const rel = url.searchParams.get("path") ?? "";
    const entries = await options.workspace_ops.list_files(rel);
    json(res, 200, { entries });
    return true;
  }

  // GET /api/workspace/content?path=
  if (path === "/api/workspace/content" && req.method === "GET") {
    if (!options.workspace_ops) { json(res, 503, { error: "workspace_unavailable" }); return true; }
    const rel = url.searchParams.get("path") ?? "";
    const content = await options.workspace_ops.read_file(rel);
    if (content === null) { json(res, 404, { error: "not_found" }); return true; }
    json(res, 200, { content, path: rel });
    return true;
  }

  return false;
}
