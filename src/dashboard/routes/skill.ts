import type { RouteContext } from "../route-context.js";

export async function handle_skill(ctx: RouteContext): Promise<boolean> {
  const { req, url, res, options, json, read_body } = ctx;

  if (url.pathname === "/api/skills" && req.method === "GET") {
    const ops = options.skill_ops;
    if (!ops) { json(res, 503, { error: "skills_unavailable" }); return true; }
    json(res, 200, ops.list_skills());
    return true;
  }
  if (url.pathname === "/api/skills/refresh" && req.method === "POST") {
    const ops = options.skill_ops;
    if (!ops) { json(res, 503, { error: "skills_unavailable" }); return true; }
    ops.refresh();
    json(res, 200, { ok: true });
    return true;
  }
  if (url.pathname === "/api/skills/import" && req.method === "POST") {
    const ops = options.skill_ops;
    if (!ops) { json(res, 503, { error: "skills_unavailable" }); return true; }
    const body = await read_body(req);
    const name = String(body?.name || "").trim();
    const zip_b64 = String(body?.zip_b64 || "").trim();
    if (!name || !/^[\w][\w.-]*$/.test(name)) { json(res, 400, { error: "invalid_name" }); return true; }
    if (!zip_b64) { json(res, 400, { error: "zip_required" }); return true; }
    const zip_buffer = Buffer.from(zip_b64, "base64");
    const result = ops.upload_skill(name, zip_buffer);
    json(res, result.ok ? 200 : 500, result);
    return true;
  }
  const detail_match = url.pathname.match(/^\/api\/skills\/([^/]+)$/);
  if (detail_match && req.method === "GET") {
    const ops = options.skill_ops;
    if (!ops) { json(res, 503, { error: "skills_unavailable" }); return true; }
    const detail = ops.get_skill_detail(decodeURIComponent(detail_match[1]));
    json(res, detail.metadata ? 200 : 404, detail);
    return true;
  }
  if (detail_match && req.method === "PUT") {
    const ops = options.skill_ops;
    if (!ops) { json(res, 503, { error: "skills_unavailable" }); return true; }
    const body = await read_body(req);
    const file = String(body?.file || "").trim();
    const content = String(body?.content ?? "");
    if (!file) { json(res, 400, { error: "file_required" }); return true; }
    const result = ops.write_skill_file(decodeURIComponent(detail_match[1]), file, content);
    json(res, result.ok ? 200 : 500, result);
    return true;
  }

  return false;
}
