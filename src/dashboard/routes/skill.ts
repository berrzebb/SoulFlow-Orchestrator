import type { RouteContext } from "../route-context.js";

export async function handle_skill(ctx: RouteContext): Promise<boolean> {
  const { req, url, res, options, json, read_body } = ctx;
  const path = url.pathname;

  // GET /api/skills
  if (path === "/api/skills" && req.method === "GET") {
    const ops = options.skill_ops;
    if (!ops) { json(res, 503, { error: "skills_unavailable" }); return true; }
    json(res, 200, ops.list_skills());
    return true;
  }

  // POST /api/skills { name, zip_b64 } — import (= 생성)
  if (path === "/api/skills" && req.method === "POST") {
    const ops = options.skill_ops;
    if (!ops) { json(res, 503, { error: "skills_unavailable" }); return true; }
    const body = await read_body(req);
    const name = String(body?.name || "").trim();
    const zip_b64 = String(body?.zip_b64 || "").trim();
    if (!name || !/^[\w][\w.-]*$/.test(name)) { json(res, 400, { error: "invalid_name" }); return true; }
    if (!zip_b64) { json(res, 400, { error: "zip_required" }); return true; }
    const zip_buffer = Buffer.from(zip_b64, "base64");
    const result = ops.upload_skill(name, zip_buffer);
    json(res, result.ok ? 201 : 500, result);
    return true;
  }

  // POST /api/skills/refresh — 목록 새로고침
  if (path === "/api/skills/refresh" && req.method === "POST") {
    const ops = options.skill_ops;
    if (!ops) { json(res, 503, { error: "skills_unavailable" }); return true; }
    ops.refresh();
    json(res, 200, { ok: true });
    return true;
  }

  // GET /api/skills/:name
  const name_match = path.match(/^\/api\/skills\/([^/]+)$/);
  if (name_match && req.method === "GET") {
    const ops = options.skill_ops;
    if (!ops) { json(res, 503, { error: "skills_unavailable" }); return true; }
    const name = decodeURIComponent(name_match[1]);
    const detail = ops.get_skill_detail(name);
    json(res, detail.metadata ? 200 : 404, detail);
    return true;
  }

  // PUT /api/skills/:name/files { file, content }
  const files_match = path.match(/^\/api\/skills\/([^/]+)\/files$/);
  if (files_match && req.method === "PUT") {
    const ops = options.skill_ops;
    if (!ops) { json(res, 503, { error: "skills_unavailable" }); return true; }
    const name = decodeURIComponent(files_match[1]);
    const body = await read_body(req);
    const file = String(body?.file || "").trim();
    const content = String(body?.content ?? "");
    if (!file) { json(res, 400, { error: "file_required" }); return true; }
    const result = ops.write_skill_file(name, file, content);
    json(res, result.ok ? 200 : 500, result);
    return true;
  }

  return false;
}
