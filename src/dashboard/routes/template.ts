import { create_template_ops } from "../ops-factory.js";
import type { RouteContext } from "../route-context.js";

export async function handle_template(ctx: RouteContext): Promise<boolean> {
  const { req, url, res, options, json, read_body, personal_dir } = ctx;
  const path = url.pathname;

  // 요청마다 JWT에서 해석된 personal_dir 기반으로 격리된 템플릿 ops 생성
  const ops = personal_dir
    ? create_template_ops(personal_dir)
    : options.template_ops;

  // GET /api/templates
  if (path === "/api/templates" && req.method === "GET") {
    if (!ops) { json(res, 503, { error: "templates_unavailable" }); return true; }
    json(res, 200, ops.list());
    return true;
  }

  // GET /api/templates/:name
  const name_match = path.match(/^\/api\/templates\/([^/]+)$/);
  if (name_match && req.method === "GET") {
    if (!ops) { json(res, 503, { error: "templates_unavailable" }); return true; }
    const name = decodeURIComponent(name_match[1]);
    const content = ops.read(name);
    json(res, content !== null ? 200 : 404, { name, content });
    return true;
  }

  // PUT /api/templates/:name { content }
  if (name_match && req.method === "PUT") {
    if (!ops) { json(res, 503, { error: "templates_unavailable" }); return true; }
    const name = decodeURIComponent(name_match[1]);
    const body = await read_body(req);
    const content = String(body?.content ?? "");
    const result = ops.write(name, content);
    json(res, result.ok ? 200 : 400, result);
    return true;
  }

  return false;
}
