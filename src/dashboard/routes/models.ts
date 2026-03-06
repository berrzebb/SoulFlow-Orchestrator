/** /api/models — 모델 관리 REST 라우트. */

import type { RouteContext } from "../route-context.js";
import { set_no_cache } from "../route-context.js";

export async function handle_models(ctx: RouteContext): Promise<boolean> {
  const { req, url, res, options, json, read_body } = ctx;
  const ops = options.model_ops;
  const path = url.pathname;

  // GET /api/models
  if (path === "/api/models" && req.method === "GET") {
    if (!ops) { json(res, 503, { error: "model_ops_unavailable" }); return true; }
    json(res, 200, await ops.list());
    return true;
  }

  // GET /api/models/active
  if (path === "/api/models/active" && req.method === "GET") {
    if (!ops) { json(res, 503, { error: "model_ops_unavailable" }); return true; }
    json(res, 200, await ops.list_active());
    return true;
  }

  // GET /api/models/runtime
  if (path === "/api/models/runtime" && req.method === "GET") {
    if (!ops) { json(res, 503, { error: "model_ops_unavailable" }); return true; }
    json(res, 200, await ops.get_runtime_status());
    return true;
  }

  // PATCH /api/models/runtime { name }
  if (path === "/api/models/runtime" && req.method === "PATCH") {
    if (!ops) { json(res, 503, { error: "model_ops_unavailable" }); return true; }
    const body = await read_body(req);
    const name = String(body?.name || "").trim();
    if (!name) { json(res, 400, { error: "name_required" }); return true; }
    json(res, 200, await ops.switch_model(name));
    return true;
  }

  // /api/models/:name
  const name_match = path.match(/^\/api\/models\/([^/]+)$/);
  if (name_match) {
    const name = decodeURIComponent(name_match[1]);
    if (!ops) { json(res, 503, { error: "model_ops_unavailable" }); return true; }

    // POST /api/models/:name/pull — SSE 스트리밍 pull
    // (prefix match로 /api/models/:name/pull도 이 핸들러에 도달)
    if (req.method === "DELETE") {
      const ok = await ops.delete(name);
      json(res, ok ? 200 : 500, { ok });
      return true;
    }
  }

  // POST /api/models/:name/pull — SSE 스트리밍 pull
  const pull_match = path.match(/^\/api\/models\/([^/]+)\/pull$/);
  if (pull_match && req.method === "POST") {
    if (!ops) { json(res, 503, { error: "model_ops_unavailable" }); return true; }
    const name = decodeURIComponent(pull_match[1]);

    set_no_cache(res);
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Connection": "keep-alive",
    });

    let error_occurred = false;
    try {
      for await (const progress of ops.pull_stream(name)) {
        if (res.destroyed) break;
        res.write(`data: ${JSON.stringify(progress)}\n\n`);
        if (progress.status.startsWith("error")) {
          error_occurred = true;
          break;
        }
      }
    } catch (err) {
      error_occurred = true;
      if (!res.destroyed) {
        res.write(`data: ${JSON.stringify({ status: "error", error: String(err) })}\n\n`);
      }
    }

    if (!res.destroyed) {
      if (!error_occurred) {
        res.write(`data: ${JSON.stringify({ status: "done" })}\n\n`);
      }
      res.end();
    }
    return true;
  }

  return false;
}
