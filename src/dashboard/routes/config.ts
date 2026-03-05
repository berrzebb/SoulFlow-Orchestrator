import type { RouteContext } from "../route-context.js";

export async function handle_config(ctx: RouteContext): Promise<boolean> {
  const { req, url, res, options, json, read_body } = ctx;

  if (url.pathname === "/api/config" && req.method === "GET") {
    const ops = options.config_ops;
    if (!ops) { json(res, 503, { error: "config_unavailable" }); return true; }
    json(res, 200, { raw: ops.get_current_config(), sections: await ops.get_sections() });
    return true;
  }
  // POST /api/config/sections { section } — 단건 조회
  if (url.pathname === "/api/config/sections" && req.method === "POST") {
    const ops = options.config_ops;
    if (!ops) { json(res, 503, { error: "config_unavailable" }); return true; }
    const body = await read_body(req);
    const name = String(body?.section || "").trim();
    if (!name) { json(res, 400, { error: "section_required" }); return true; }
    const section = await ops.get_section(name);
    json(res, section ? 200 : 404, section ?? { error: "section_not_found" });
    return true;
  }

  if (url.pathname !== "/api/config/values") return false;

  // PUT /api/config/values { path, value } — 수정
  if (req.method === "PUT") {
    const ops = options.config_ops;
    if (!ops) { json(res, 503, { error: "config_unavailable" }); return true; }
    const body = await read_body(req);
    const { path: field_path, value } = (body ?? {}) as { path?: string; value?: unknown };
    if (!field_path) { json(res, 400, { error: "path_required" }); return true; }
    await ops.set_value(field_path, value);
    json(res, 200, { ok: true, path: field_path });
    return true;
  }
  // DELETE /api/config/values { path } — 초기화
  if (req.method === "DELETE") {
    const ops = options.config_ops;
    if (!ops) { json(res, 503, { error: "config_unavailable" }); return true; }
    const body = await read_body(req);
    const field_path = String(body?.path || "").trim();
    if (!field_path) { json(res, 400, { error: "path_required" }); return true; }
    await ops.remove_value(field_path);
    json(res, 200, { ok: true, restored: "default" });
    return true;
  }

  return false;
}
