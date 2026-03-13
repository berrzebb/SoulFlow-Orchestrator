/** Reference 문서 관리 REST API. */

import { existsSync } from "node:fs";
import { writeFile, unlink, mkdir } from "node:fs/promises";
import { join, resolve as path_resolve, sep } from "node:path";
import type { RouteContext } from "../route-context.js";
import { sanitize_filename, is_inside } from "../ops/shared.js";

export async function handle_references(ctx: RouteContext): Promise<boolean> {
  const { req, url, res, options, json, read_body } = ctx;
  const path = url.pathname;
  const store = options.reference_store;

  if (!store) { json(res, 503, { error: "reference_store_unavailable" }); return path.startsWith("/api/references"); }

  // GET /api/references — 문서 목록 + 통계
  if (path === "/api/references" && req.method === "GET") {
    const docs = store.list_documents();
    const stats = store.get_stats();
    json(res, 200, { documents: docs, stats });
    return true;
  }

  // POST /api/references/sync — 수동 동기화 트리거
  if (path === "/api/references/sync" && req.method === "POST") {
    const result = await store.sync();
    json(res, 200, { ok: true, ...result });
    return true;
  }

  // POST /api/references/search — 검색
  if (path === "/api/references/search" && req.method === "POST") {
    const body = await read_body(req);
    const query = String(body?.query || "");
    if (!query) { json(res, 400, { error: "query required" }); return true; }
    const limit = Number(body?.limit) || 8;
    const doc_filter = body?.doc_filter ? String(body.doc_filter) : undefined;
    const results = await store.search(query, { limit, doc_filter });
    json(res, 200, { results });
    return true;
  }

  // POST /api/references/upload — 파일 업로드 (JSON: { filename, content } 또는 { filename, base64 })
  if (path === "/api/references/upload" && req.method === "POST") {
    const body = await read_body(req);
    const filename = sanitize_filename(String(body?.filename || ""));
    if (!filename) { json(res, 400, { error: "filename required" }); return true; }

    const refs_dir = join(ctx.workspace_runtime?.user_content ?? ctx.personal_dir, "references");
    await mkdir(refs_dir, { recursive: true });

    const filepath = join(refs_dir, filename);
    if (!is_inside(refs_dir, filepath)) { json(res, 400, { error: "invalid filename" }); return true; }

    if (body?.base64) {
      const buf = Buffer.from(String(body.base64), "base64");
      await writeFile(filepath, buf);
    } else {
      const content = String(body?.content || "");
      if (!content) { json(res, 400, { error: "content or base64 required" }); return true; }
      await writeFile(filepath, content, "utf-8");
    }

    // 파일 저장 즉시 응답 — 인덱싱은 백그라운드에서 비동기 처리
    json(res, 200, { ok: true, filename });
    void store.sync({ force: true }).catch(() => {});
    return true;
  }

  // DELETE /api/references/:filename — 파일 삭제
  const del_match = path.match(/^\/api\/references\/([^/]+)$/);
  if (del_match && req.method === "DELETE") {
    const filename = decodeURIComponent(del_match[1]);
    const refs_dir = join(ctx.workspace_runtime?.user_content ?? ctx.personal_dir, "references");
    const filepath = join(refs_dir, filename);

    // path traversal 차단: resolve() 정규화 후 base dir 포함 여부 확인
    const base = path_resolve(refs_dir) + sep;
    const target = path_resolve(filepath);
    if (!target.startsWith(base)) { json(res, 400, { error: "invalid filename" }); return true; }

    if (!existsSync(filepath)) { json(res, 404, { error: "file not found" }); return true; }

    await unlink(filepath);
    json(res, 200, { ok: true, deleted: filename });
    void store.sync({ force: true }).catch(() => {});
    return true;
  }

  return false;
}
