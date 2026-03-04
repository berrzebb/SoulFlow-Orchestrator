import type { RouteContext } from "../route-context.js";

export async function handle_template(ctx: RouteContext): Promise<boolean> {
  const { req, url, res, options, json, read_body } = ctx;

  if (url.pathname === "/api/templates" && req.method === "GET") {
    const ops = options.template_ops;
    if (!ops) { json(res, 503, { error: "templates_unavailable" }); return true; }
    json(res, 200, ops.list());
    return true;
  }
  const name_match = url.pathname.match(/^\/api\/templates\/([^/]+)$/);
  if (name_match && req.method === "GET") {
    const ops = options.template_ops;
    if (!ops) { json(res, 503, { error: "templates_unavailable" }); return true; }
    const content = ops.read(decodeURIComponent(name_match[1]));
    json(res, content !== null ? 200 : 404, { name: name_match[1], content });
    return true;
  }
  if (name_match && req.method === "PUT") {
    const ops = options.template_ops;
    if (!ops) { json(res, 503, { error: "templates_unavailable" }); return true; }
    const body = await read_body(req);
    const content = String(body?.content ?? "");
    const result = ops.write(decodeURIComponent(name_match[1]), content);
    json(res, result.ok ? 200 : 400, result);
    return true;
  }

  return false;
}
