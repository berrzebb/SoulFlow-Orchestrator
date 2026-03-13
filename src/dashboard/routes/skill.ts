import type { RouteContext } from "../route-context.js";
import { create_scoped_skill_ops } from "../ops/skill.js";

function get_skill_ops(ctx: RouteContext) {
  const base = ctx.options.skill_ops ?? null;
  if (!base) return null;
  // personal_dir이 있으면 upload 경로를 사용자별로 격리
  return ctx.personal_dir ? create_scoped_skill_ops(base, ctx.personal_dir) : base;
}

function skill_ops_or_503(ctx: RouteContext) {
  const ops = get_skill_ops(ctx);
  if (!ops) ctx.json(ctx.res, 503, { error: "skills_unavailable" });
  return ops;
}

export async function handle_skill(ctx: RouteContext): Promise<boolean> {
  const { req, url, res, json, read_body } = ctx;
  const path = url.pathname;

  // GET /api/skills
  if (path === "/api/skills" && req.method === "GET") {
    const ops = skill_ops_or_503(ctx);
    if (!ops) return true;
    json(res, 200, ops.list_skills());
    return true;
  }

  // POST /api/skills { name, zip_b64 } — import (= 생성)
  if (path === "/api/skills" && req.method === "POST") {
    const ops = skill_ops_or_503(ctx);
    if (!ops) return true;
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
    const ops = skill_ops_or_503(ctx);
    if (!ops) return true;
    ops.refresh();
    json(res, 200, { ok: true });
    return true;
  }

  // GET /api/skills/:name
  const name_match = path.match(/^\/api\/skills\/([^/]+)$/);
  if (name_match && req.method === "GET") {
    const ops = skill_ops_or_503(ctx);
    if (!ops) return true;
    const name = decodeURIComponent(name_match[1]);
    const detail = ops.get_skill_detail(name);
    json(res, detail.metadata ? 200 : 404, detail);
    return true;
  }

  // PUT /api/skills/:name/files { file, content }
  const files_match = path.match(/^\/api\/skills\/([^/]+)\/files$/);
  if (files_match && req.method === "PUT") {
    const ops = skill_ops_or_503(ctx);
    if (!ops) return true;
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
