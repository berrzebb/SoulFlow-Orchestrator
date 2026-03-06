import type { RouteContext } from "../route-context.js";

export async function handle_secret(ctx: RouteContext): Promise<boolean> {
  const { req, url, res, options, json, read_body } = ctx;
  const path = url.pathname;

  // GET /api/secrets
  if (path === "/api/secrets" && req.method === "GET") {
    const vault = options.secrets;
    if (!vault) { json(res, 503, { error: "secrets_unavailable" }); return true; }
    const names = await vault.list_names();
    json(res, 200, { names });
    return true;
  }

  // POST /api/secrets { name, value }
  if (path === "/api/secrets" && req.method === "POST") {
    const vault = options.secrets;
    if (!vault) { json(res, 503, { error: "secrets_unavailable" }); return true; }
    const body = await read_body(req);
    const name = String(body?.name || "").trim();
    const value = String(body?.value ?? "");
    if (!name) { json(res, 400, { error: "name_required" }); return true; }
    const result = await vault.put_secret(name, value);
    json(res, result.ok ? 200 : 400, result);
    return true;
  }

  // DELETE /api/secrets/:name
  const del_match = path.match(/^\/api\/secrets\/([^/]+)$/);
  if (del_match && req.method === "DELETE") {
    const vault = options.secrets;
    if (!vault) { json(res, 503, { error: "secrets_unavailable" }); return true; }
    const name = decodeURIComponent(del_match[1]);
    const removed = await vault.remove_secret(name);
    json(res, removed ? 200 : 404, { removed });
    return true;
  }

  return false;
}
