import type { RouteContext } from "../route-context.js";

export async function handle_template(ctx: RouteContext): Promise<boolean> {
  const { req, url, res, options, json, read_body } = ctx;

  if (url.pathname !== "/api/templates") return false;

  // GET /api/templates — 목록
  if (req.method === "GET") {
    const ops = options.template_ops;
    if (!ops) { json(res, 503, { error: "templates_unavailable" }); return true; }
    json(res, 200, ops.list());
    return true;
  }

  // POST /api/templates { name } — 단건 조회
  if (req.method === "POST") {
    const ops = options.template_ops;
    if (!ops) { json(res, 503, { error: "templates_unavailable" }); return true; }
    const body = await read_body(req);
    const name = String(body?.name || "").trim();
    if (!name) { json(res, 400, { error: "name_required" }); return true; }
    const content = ops.read(name);
    json(res, content !== null ? 200 : 404, { name, content });
    return true;
  }

  // PUT /api/templates { name, content } — 수정
  if (req.method === "PUT") {
    const ops = options.template_ops;
    if (!ops) { json(res, 503, { error: "templates_unavailable" }); return true; }
    const body = await read_body(req);
    const name = String(body?.name || "").trim();
    if (!name) { json(res, 400, { error: "name_required" }); return true; }
    const content = String(body?.content ?? "");
    const result = ops.write(name, content);
    json(res, result.ok ? 200 : 400, result);
    return true;
  }

  return false;
}
