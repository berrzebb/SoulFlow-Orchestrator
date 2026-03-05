import type { RouteContext } from "../route-context.js";

export async function handle_promise(ctx: RouteContext): Promise<boolean> {
  const { req, url, res, options, json, read_body } = ctx;

  if (url.pathname !== "/api/promises") return false;

  // GET /api/promises — 목록
  if (req.method === "GET") {
    const all = await options.promises.list_promises({ status: "active", limit: 100 });
    json(res, 200, all.map((p) => ({ id: p.id, canonical_key: p.canonical_key, value: p.value, priority: p.priority, scope: p.scope, source: p.source, rationale: p.rationale })));
    return true;
  }

  // POST /api/promises { key, value, ... } — 생성
  if (req.method === "POST") {
    const body = await read_body(req);
    if (!body || !body.key || !body.value) { json(res, 400, { error: "key_and_value_required" }); return true; }
    const result = await options.promises.append_promise({
      scope: (body.scope as "global") || "global",
      key: String(body.key),
      value: String(body.value),
      priority: (typeof body.priority === "number" && [0, 1, 2, 3].includes(body.priority) ? body.priority : 0) as 0 | 1 | 2 | 3,
      source: "user",
      rationale: body.rationale ? String(body.rationale) : undefined,
    });
    json(res, 201, { action: result.action, id: result.record.id });
    return true;
  }

  // DELETE /api/promises { id } — 아카이브
  if (req.method === "DELETE") {
    const body = await read_body(req);
    const id = String(body?.id || "").trim();
    if (!id) { json(res, 400, { error: "id_required" }); return true; }
    const ok = await options.promises.archive_promise(id);
    json(res, ok ? 200 : 404, ok ? { archived: true } : { error: "not_found" });
    return true;
  }

  return false;
}
