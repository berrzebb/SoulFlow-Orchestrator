import type { RouteContext } from "../route-context.js";

export async function handle_oauth(ctx: RouteContext): Promise<boolean> {
  const { req, url, res, options, json, read_body, oauth_callback_handler, oauth_callback_html, resolve_request_origin } = ctx;

  // Presets
  if (url.pathname === "/api/oauth/presets" && req.method === "GET") {
    const ops = options.oauth_ops;
    if (!ops) { json(res, 503, { error: "oauth_ops_unavailable" }); return true; }
    json(res, 200, ops.list_presets());
    return true;
  }
  if (url.pathname === "/api/oauth/presets" && req.method === "POST") {
    const ops = options.oauth_ops;
    if (!ops) { json(res, 503, { error: "oauth_ops_unavailable" }); return true; }
    const body = await read_body(req);
    if (!body || typeof (body as Record<string, unknown>).service_type !== "string") {
      json(res, 400, { error: "service_type required" }); return true;
    }
    const result = await ops.register_preset(body as Parameters<typeof ops.register_preset>[0]);
    json(res, result.ok ? 201 : 400, result);
    return true;
  }
  const preset_match = url.pathname.match(/^\/api\/oauth\/presets\/([^/]+)$/);
  if (preset_match && req.method === "PUT") {
    const ops = options.oauth_ops;
    if (!ops) { json(res, 503, { error: "oauth_ops_unavailable" }); return true; }
    const body = await read_body(req);
    if (!body) { json(res, 400, { error: "invalid_body" }); return true; }
    const result = await ops.update_preset(decodeURIComponent(preset_match[1]), body as Parameters<typeof ops.update_preset>[1]);
    json(res, result.ok ? 200 : 404, result);
    return true;
  }
  if (preset_match && req.method === "DELETE") {
    const ops = options.oauth_ops;
    if (!ops) { json(res, 503, { error: "oauth_ops_unavailable" }); return true; }
    const result = await ops.unregister_preset(decodeURIComponent(preset_match[1]));
    json(res, result.ok ? 200 : 404, result);
    return true;
  }

  // Integrations
  if (url.pathname === "/api/oauth/integrations" && req.method === "GET") {
    const ops = options.oauth_ops;
    if (!ops) { json(res, 503, { error: "oauth_ops_unavailable" }); return true; }
    json(res, 200, await ops.list());
    return true;
  }
  if (url.pathname === "/api/oauth/integrations" && req.method === "POST") {
    const ops = options.oauth_ops;
    if (!ops) { json(res, 503, { error: "oauth_ops_unavailable" }); return true; }
    const body = await read_body(req);
    if (!body) { json(res, 400, { error: "invalid_body" }); return true; }
    const result = await ops.create(body as Parameters<typeof ops.create>[0]);
    json(res, result.ok ? 201 : 400, result);
    return true;
  }
  const int_match = url.pathname.match(/^\/api\/oauth\/integrations\/([^/]+)$/);
  if (int_match) {
    const ops = options.oauth_ops;
    if (!ops) { json(res, 503, { error: "oauth_ops_unavailable" }); return true; }
    const id = decodeURIComponent(int_match[1]);
    if (req.method === "GET") {
      const info = await ops.get(id);
      if (!info) { json(res, 404, { error: "not_found" }); return true; }
      json(res, 200, info);
      return true;
    }
    if (req.method === "PUT") {
      const body = await read_body(req);
      if (!body) { json(res, 400, { error: "invalid_body" }); return true; }
      const result = await ops.update(id, body as Parameters<typeof ops.update>[1]);
      json(res, result.ok ? 200 : 400, result);
      return true;
    }
    if (req.method === "DELETE") {
      const result = await ops.remove(id);
      json(res, result.ok ? 200 : 404, result);
      return true;
    }
  }
  const auth_match = url.pathname.match(/^\/api\/oauth\/integrations\/([^/]+)\/auth$/);
  if (req.method === "POST" && auth_match) {
    const ops = options.oauth_ops;
    if (!ops) { json(res, 503, { error: "oauth_ops_unavailable" }); return true; }
    const body = await read_body(req);
    const client_secret = (body as Record<string, unknown>)?.client_secret as string | undefined;
    const origin = resolve_request_origin(req);
    const result = await ops.start_auth(decodeURIComponent(auth_match[1]), client_secret, origin);
    json(res, result.ok ? 200 : 400, result);
    return true;
  }
  const refresh_match = url.pathname.match(/^\/api\/oauth\/integrations\/([^/]+)\/refresh$/);
  if (req.method === "POST" && refresh_match) {
    const ops = options.oauth_ops;
    if (!ops) { json(res, 503, { error: "oauth_ops_unavailable" }); return true; }
    const result = await ops.refresh(decodeURIComponent(refresh_match[1]));
    json(res, result.ok ? 200 : 400, result);
    return true;
  }
  const test_match = url.pathname.match(/^\/api\/oauth\/integrations\/([^/]+)\/test$/);
  if (req.method === "POST" && test_match) {
    const ops = options.oauth_ops;
    if (!ops) { json(res, 503, { error: "oauth_ops_unavailable" }); return true; }
    const result = await ops.test(decodeURIComponent(test_match[1]));
    json(res, result.ok ? 200 : 400, result);
    return true;
  }

  // OAuth callback
  if (url.pathname === "/api/oauth/callback" && req.method === "GET") {
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
