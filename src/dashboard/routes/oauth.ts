import type { RouteContext } from "../route-context.js";

export async function handle_oauth(ctx: RouteContext): Promise<boolean> {
  const { req, url, res, options, json, read_body, oauth_callback_handler, oauth_callback_html, resolve_request_origin } = ctx;

  // ── Presets ──

  if (url.pathname === "/api/oauth/presets") {
    const ops = options.oauth_ops;
    if (!ops) { json(res, 503, { error: "oauth_ops_unavailable" }); return true; }

    if (req.method === "GET") {
      json(res, 200, ops.list_presets());
      return true;
    }
    // POST: 생성
    if (req.method === "POST") {
      const body = await read_body(req);
      if (!body || typeof (body as Record<string, unknown>).service_type !== "string") {
        json(res, 400, { error: "service_type required" }); return true;
      }
      const result = await ops.register_preset(body as Parameters<typeof ops.register_preset>[0]);
      json(res, result.ok ? 201 : 400, result);
      return true;
    }
    // PUT: { service_type, ...fields } — 수정
    if (req.method === "PUT") {
      const body = await read_body(req);
      if (!body) { json(res, 400, { error: "invalid_body" }); return true; }
      const service_type = String((body as Record<string, unknown>).service_type || "").trim();
      if (!service_type) { json(res, 400, { error: "service_type_required" }); return true; }
      const result = await ops.update_preset(service_type, body as Parameters<typeof ops.update_preset>[1]);
      json(res, result.ok ? 200 : 404, result);
      return true;
    }
    // DELETE: { service_type } — 삭제
    if (req.method === "DELETE") {
      const body = await read_body(req);
      const service_type = String(body?.service_type || "").trim();
      if (!service_type) { json(res, 400, { error: "service_type_required" }); return true; }
      const result = await ops.unregister_preset(service_type);
      json(res, result.ok ? 200 : 404, result);
      return true;
    }
  }

  // ── Integrations ──

  if (url.pathname === "/api/oauth/integrations") {
    const ops = options.oauth_ops;
    if (!ops) { json(res, 503, { error: "oauth_ops_unavailable" }); return true; }

    if (req.method === "GET") {
      json(res, 200, await ops.list());
      return true;
    }
    // POST: 생성 또는 액션 (action 필드로 구분)
    if (req.method === "POST") {
      const body = await read_body(req);
      if (!body) { json(res, 400, { error: "invalid_body" }); return true; }
      const action = String((body as Record<string, unknown>).action || "").trim();

      if (action === "auth") {
        const id = String((body as Record<string, unknown>).id || "").trim();
        if (!id) { json(res, 400, { error: "id_required" }); return true; }
        const client_secret = (body as Record<string, unknown>).client_secret as string | undefined;
        const origin = resolve_request_origin(req);
        const result = await ops.start_auth(id, client_secret, origin);
        json(res, result.ok ? 200 : 400, result);
        return true;
      }
      if (action === "refresh") {
        const id = String((body as Record<string, unknown>).id || "").trim();
        if (!id) { json(res, 400, { error: "id_required" }); return true; }
        const result = await ops.refresh(id);
        json(res, result.ok ? 200 : 400, result);
        return true;
      }
      if (action === "test") {
        const id = String((body as Record<string, unknown>).id || "").trim();
        if (!id) { json(res, 400, { error: "id_required" }); return true; }
        const result = await ops.test(id);
        json(res, result.ok ? 200 : 400, result);
        return true;
      }
      if (action === "get") {
        const id = String((body as Record<string, unknown>).id || "").trim();
        if (!id) { json(res, 400, { error: "id_required" }); return true; }
        const info = await ops.get(id);
        json(res, info ? 200 : 404, info ?? { error: "not_found" });
        return true;
      }

      // action 없으면 생성
      const result = await ops.create(body as Parameters<typeof ops.create>[0]);
      json(res, result.ok ? 201 : 400, result);
      return true;
    }
    // PUT: { id, ...fields } — 수정
    if (req.method === "PUT") {
      const body = await read_body(req);
      if (!body) { json(res, 400, { error: "invalid_body" }); return true; }
      const id = String((body as Record<string, unknown>).id || "").trim();
      if (!id) { json(res, 400, { error: "id_required" }); return true; }
      const result = await ops.update(id, body as Parameters<typeof ops.update>[1]);
      json(res, result.ok ? 200 : 400, result);
      return true;
    }
    // DELETE: { id } — 삭제
    if (req.method === "DELETE") {
      const body = await read_body(req);
      const id = String(body?.id || "").trim();
      if (!id) { json(res, 400, { error: "id_required" }); return true; }
      const result = await ops.remove(id);
      json(res, result.ok ? 200 : 404, result);
      return true;
    }
  }

  // ── OAuth callback ──

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
