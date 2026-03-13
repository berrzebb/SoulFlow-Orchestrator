import { set_locale, get_locale, parse_locale } from "../../i18n/index.js";
import type { RouteContext } from "../route-context.js";
import { require_superadmin_for_write } from "../route-context.js";

export async function handle_config(ctx: RouteContext): Promise<boolean> {
  if (!require_superadmin_for_write(ctx)) return true;
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

  // GET /api/config/provider-instances?purpose=chat|embedding — 등록된 프로바이더 인스턴스 목록
  if (path === "/api/config/provider-instances" && req.method === "GET") {
    const provider_ops = options.agent_provider_ops;
    if (!provider_ops) { json(res, 503, { error: "agent_provider_ops_unavailable" }); return true; }
    const purpose = url.searchParams.get("purpose") || "chat";
    const all = await provider_ops.list();
    const filtered = all.filter((p) => p.model_purpose === purpose && p.enabled);
    json(res, 200, filtered.map((p) => ({
      instance_id: p.instance_id,
      label: p.label || p.instance_id,
      provider_type: p.provider_type,
      connection_id: p.connection_id || "",
      model: p.settings?.model || "",
      available: p.available,
    })));
    return true;
  }

  // 하위 호환: /api/config/embed-instances → provider-instances?purpose=embedding 리다이렉트
  if (path === "/api/config/embed-instances" && req.method === "GET") {
    const provider_ops = options.agent_provider_ops;
    if (!provider_ops) { json(res, 503, { error: "agent_provider_ops_unavailable" }); return true; }
    const all = await provider_ops.list();
    const embed = all.filter((p) => p.model_purpose === "embedding" && p.enabled);
    json(res, 200, embed.map((p) => ({
      instance_id: p.instance_id,
      label: p.label || p.instance_id,
      provider_type: p.provider_type,
      connection_id: p.connection_id || "",
      model: p.settings?.model || "",
      available: p.available,
    })));
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
