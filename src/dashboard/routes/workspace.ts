import { create_workspace_ops } from "../ops-factory.js";
import type { RouteContext } from "../route-context.js";

export async function handle_workspace(ctx: RouteContext): Promise<boolean> {
  const { req, url, res, options, json, personal_dir } = ctx;
  const path = url.pathname;

  // 요청마다 JWT에서 해석된 personal_dir 기반으로 격리된 워크스페이스 ops 생성
  const workspace_ops = personal_dir
    ? create_workspace_ops(personal_dir)
    : options.workspace_ops;

  // GET /api/workspace/entries?path=
  if (path === "/api/workspace/entries" && req.method === "GET") {
    if (!workspace_ops) { json(res, 503, { error: "workspace_unavailable" }); return true; }
    const rel = url.searchParams.get("path") ?? "";
    const entries = await workspace_ops.list_files(rel);
    json(res, 200, { entries });
    return true;
  }

  // GET /api/workspace/content?path=
  if (path === "/api/workspace/content" && req.method === "GET") {
    if (!workspace_ops) { json(res, 503, { error: "workspace_unavailable" }); return true; }
    const rel = url.searchParams.get("path") ?? "";
    const content = await workspace_ops.read_file(rel);
    if (content === null) { json(res, 404, { error: "not_found" }); return true; }
    json(res, 200, { content, path: rel });
    return true;
  }

  return false;
}
