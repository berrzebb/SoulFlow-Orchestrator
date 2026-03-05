import type { RouteContext } from "../route-context.js";

export async function handle_secret(ctx: RouteContext): Promise<boolean> {
  const { req, url, res, options, json, read_body } = ctx;

  if (url.pathname !== "/api/secrets") return false;

  // GET /api/secrets — 이름 목록
  if (req.method === "GET") {
    const vault = options.secrets;
    if (!vault) { json(res, 503, { error: "secrets_unavailable" }); return true; }
    const names = await vault.list_names();
    json(res, 200, { names });
    return true;
  }

  // POST /api/secrets { name, value } — 생성/갱신
  if (req.method === "POST") {
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

  // DELETE /api/secrets { name } — 삭제
  if (req.method === "DELETE") {
    const vault = options.secrets;
    if (!vault) { json(res, 503, { error: "secrets_unavailable" }); return true; }
    const body = await read_body(req);
    const name = String(body?.name || "").trim();
    if (!name) { json(res, 400, { error: "name_required" }); return true; }
    const removed = await vault.remove_secret(name);
    json(res, removed ? 200 : 404, { removed });
    return true;
  }

  return false;
}
