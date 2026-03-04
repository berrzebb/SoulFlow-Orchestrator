import type { RouteContext } from "../route-context.js";

export async function handle_config(ctx: RouteContext): Promise<boolean> {
  const { req, url, res, options, json, read_body } = ctx;

  if (url.pathname === "/api/config" && req.method === "GET") {
    const ops = options.config_ops;
    if (!ops) { json(res, 503, { error: "config_unavailable" }); return true; }
    json(res, 200, { raw: ops.get_current_config(), sections: await ops.get_sections() });
    return true;
  }
  const section_match = url.pathname.match(/^\/api\/config\/sections\/([^/]+)$/);
  if (section_match && req.method === "GET") {
    const ops = options.config_ops;
    if (!ops) { json(res, 503, { error: "config_unavailable" }); return true; }
    const section = await ops.get_section(decodeURIComponent(section_match[1]));
    json(res, section ? 200 : 404, section ?? { error: "section_not_found" });
    return true;
  }
  if (url.pathname === "/api/config/values" && req.method === "PUT") {
    const ops = options.config_ops;
    if (!ops) { json(res, 503, { error: "config_unavailable" }); return true; }
    const body = await read_body(req);
    const { path: field_path, value } = (body ?? {}) as { path?: string; value?: unknown };
    if (!field_path) { json(res, 400, { error: "path_required" }); return true; }
    await ops.set_value(field_path, value);
    json(res, 200, { ok: true, path: field_path });
    return true;
  }
  const value_match = url.pathname.match(/^\/api\/config\/values\/(.+)$/);
  if (value_match && req.method === "DELETE") {
    const ops = options.config_ops;
    if (!ops) { json(res, 503, { error: "config_unavailable" }); return true; }
    await ops.remove_value(decodeURIComponent(value_match[1]));
    json(res, 200, { ok: true, restored: "default" });
    return true;
  }

  return false;
}
