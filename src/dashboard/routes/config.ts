import { set_locale, get_locale, parse_locale } from "../../i18n/index.js";
import type { RouteContext } from "../route-context.js";

export async function handle_config(ctx: RouteContext): Promise<boolean> {
  const { req, url, res, options, json, read_body } = ctx;
  const path = url.pathname;

  // GET /api/locale
  if (path === "/api/locale" && req.method === "GET") {
    json(res, 200, { locale: get_locale() });
    return true;
  }

  // PUT /api/locale { locale: "en" | "ko" }
  if (path === "/api/locale" && req.method === "PUT") {
    const body = await read_body(req);
    const locale = parse_locale((body as Record<string, unknown>)?.locale);
    set_locale(locale);
    json(res, 200, { ok: true, locale });
    return true;
  }

  // GET /api/config
  if (path === "/api/config" && req.method === "GET") {
    const ops = options.config_ops;
    if (!ops) { json(res, 503, { error: "config_unavailable" }); return true; }
    json(res, 200, { raw: ops.get_current_config(), sections: await ops.get_sections() });
    return true;
  }

  // GET /api/config/sections/:section
  const section_match = path.match(/^\/api\/config\/sections\/([^/]+)$/);
  if (section_match && req.method === "GET") {
    const ops = options.config_ops;
    if (!ops) { json(res, 503, { error: "config_unavailable" }); return true; }
    const name = decodeURIComponent(section_match[1]);
    const section = await ops.get_section(name);
    json(res, section ? 200 : 404, section ?? { error: "section_not_found" });
    return true;
  }

  if (!path.startsWith("/api/config/values")) return false;

  // PUT /api/config/values { path, value }
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
  // DELETE /api/config/values { path }
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
