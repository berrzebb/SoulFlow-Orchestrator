import type { RouteContext } from "../route-context.js";
import { require_superadmin_for_write } from "../route-context.js";

function oauth_ops_or_503(ctx: RouteContext) {
  const ops = ctx.options.oauth_ops ?? null;
  if (!ops) ctx.json(ctx.res, 503, { error: "oauth_ops_unavailable" });
  return ops;
}

export async function handle_oauth(ctx: RouteContext): Promise<boolean> {
  if (!require_superadmin_for_write(ctx)) return true;
  const { req, url, res, options, json, read_body, oauth_callback_handler, oauth_callback_html, resolve_request_origin } = ctx;
  const path = url.pathname;

  // ── Presets ──

  // GET /api/oauth/presets
  if (path === "/api/oauth/presets" && req.method === "GET") {
    const ops = oauth_ops_or_503(ctx);
    if (!ops) return true;
    json(res, 200, ops.list_presets());
    return true;
  }

  // POST /api/oauth/presets { service_type, ... }
  if (path === "/api/oauth/presets" && req.method === "POST") {
    const ops = oauth_ops_or_503(ctx);
    if (!ops) return true;
    const body = await read_body(req);
    if (!body || typeof (body as Record<string, unknown>).service_type !== "string") {
      json(res, 400, { error: "service_type required" }); return true;
    }
    const result = await ops.register_preset(body as Parameters<typeof ops.register_preset>[0]);
    json(res, result.ok ? 201 : 400, result);
    return true;
  }

  // PUT /api/oauth/presets/:type { ...fields }
  const preset_match = path.match(/^\/api\/oauth\/presets\/([^/]+)$/);
  if (preset_match && req.method === "PUT") {
    const ops = oauth_ops_or_503(ctx);
    if (!ops) return true;
    const service_type = decodeURIComponent(preset_match[1]);
    const body = await read_body(req);
    if (!body) { json(res, 400, { error: "invalid_body" }); return true; }
    const result = await ops.update_preset(service_type, body as Parameters<typeof ops.update_preset>[1]);
    json(res, result.ok ? 200 : 404, result);
    return true;
  }

  // DELETE /api/oauth/presets/:type
  if (preset_match && req.method === "DELETE") {
    const ops = oauth_ops_or_503(ctx);
    if (!ops) return true;
    const service_type = decodeURIComponent(preset_match[1]);
    const result = await ops.unregister_preset(service_type);
    json(res, result.ok ? 200 : 404, result);
    return true;
  }

  // ── Integrations ──

  // GET /api/oauth/integrations
  if (path === "/api/oauth/integrations" && req.method === "GET") {
    const ops = oauth_ops_or_503(ctx);
    if (!ops) return true;
    json(res, 200, await ops.list());
    return true;
  }

  // POST /api/oauth/integrations { ...fields }
  if (path === "/api/oauth/integrations" && req.method === "POST") {
    const ops = oauth_ops_or_503(ctx);
    if (!ops) return true;
    const body = await read_body(req);
    if (!body) { json(res, 400, { error: "invalid_body" }); return true; }
    const result = await ops.create(body as Parameters<typeof ops.create>[0]);
    json(res, result.ok ? 201 : 400, result);
    return true;
  }

  // GET /api/oauth/integrations/:id
  const integ_match = path.match(/^\/api\/oauth\/integrations\/([^/]+)$/);
  if (integ_match && req.method === "GET") {
    const ops = oauth_ops_or_503(ctx);
    if (!ops) return true;
    const id = decodeURIComponent(integ_match[1]);
    const info = await ops.get(id);
    json(res, info ? 200 : 404, info ?? { error: "not_found" });
    return true;
  }

  // PUT /api/oauth/integrations/:id { ...fields }
  if (integ_match && req.method === "PUT") {
    const ops = oauth_ops_or_503(ctx);
    if (!ops) return true;
    const id = decodeURIComponent(integ_match[1]);
    const body = await read_body(req);
    if (!body) { json(res, 400, { error: "invalid_body" }); return true; }
    const result = await ops.update(id, body as Parameters<typeof ops.update>[1]);
    json(res, result.ok ? 200 : 400, result);
    return true;
  }

  // DELETE /api/oauth/integrations/:id
  if (integ_match && req.method === "DELETE") {
    const ops = oauth_ops_or_503(ctx);
    if (!ops) return true;
    const id = decodeURIComponent(integ_match[1]);
    const result = await ops.remove(id);
    json(res, result.ok ? 200 : 404, result);
    return true;
  }

  // POST /api/oauth/integrations/:id/auth { client_secret? }
  const auth_match = path.match(/^\/api\/oauth\/integrations\/([^/]+)\/auth$/);
  if (auth_match && req.method === "POST") {
    const ops = oauth_ops_or_503(ctx);
    if (!ops) return true;
    const id = decodeURIComponent(auth_match[1]);
    const body = await read_body(req);
    const client_secret = (body as Record<string, unknown> | undefined)?.client_secret as string | undefined;
    const origin = resolve_request_origin(req);
    const result = await ops.start_auth(id, client_secret, origin);
    json(res, result.ok ? 200 : 400, result);
    return true;
  }

  // POST /api/oauth/integrations/:id/refresh
  const refresh_match = path.match(/^\/api\/oauth\/integrations\/([^/]+)\/refresh$/);
  if (refresh_match && req.method === "POST") {
    const ops = oauth_ops_or_503(ctx);
    if (!ops) return true;
    const id = decodeURIComponent(refresh_match[1]);
    const result = await ops.refresh(id);
    json(res, result.ok ? 200 : 400, result);
    return true;
  }

  // POST /api/oauth/integrations/:id/test
  const test_match = path.match(/^\/api\/oauth\/integrations\/([^/]+)\/test$/);
  if (test_match && req.method === "POST") {
    const ops = oauth_ops_or_503(ctx);
    if (!ops) return true;
    const id = decodeURIComponent(test_match[1]);
    const result = await ops.test(id);
    json(res, result.ok ? 200 : 400, result);
    return true;
  }

  // ── OAuth callback ──

  if (path === "/api/oauth/callback" && req.method === "GET") {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error_param = url.searchParams.get("error");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    if (error_param) {
      res.statusCode = 400;
      res.end(oauth_callback_html(false, error_param));
      return true;
    }
    if (!options.oauth_ops || !code || !state) {
      res.statusCode = 400;
      res.end(oauth_callback_html(false, "missing code or state"));
      return true;
    }
    if (!oauth_callback_handler) {
      res.statusCode = 503;
      res.end(oauth_callback_html(false, "callback handler not configured"));
      return true;
    }
    const result = await oauth_callback_handler(code, state);
    res.statusCode = result.ok ? 200 : 400;
    res.end(oauth_callback_html(result.ok, result.ok ? "Authorization successful" : (result.error || "unknown error")));
    return true;
  }

  return false;
}
