/** Reference 문서 관리 REST API. */

import { existsSync } from "node:fs";
import { writeFile, unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { RouteContext } from "../route-context.js";

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
    const filename = String(body?.filename || "").replace(/[/\\:*?"<>|]/g, "_");
    if (!filename) { json(res, 400, { error: "filename required" }); return true; }

    const refs_dir = join(options.workspace || "workspace", "references");
    await mkdir(refs_dir, { recursive: true });

    if (body?.base64) {
      // 바이너리 파일 (PDF/DOCX/PPTX/HWPX/이미지): base64 디코딩 후 원본 바이너리로 저장
      const buf = Buffer.from(String(body.base64), "base64");
      await writeFile(join(refs_dir, filename), buf);
    } else {
      const content = String(body?.content || "");
      if (!content) { json(res, 400, { error: "content or base64 required" }); return true; }
      await writeFile(join(refs_dir, filename), content, "utf-8");
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
    const refs_dir = join(options.workspace || "workspace", "references");
    const filepath = join(refs_dir, filename);
    if (!existsSync(filepath)) { json(res, 404, { error: "file not found" }); return true; }

    await unlink(filepath);
    json(res, 200, { ok: true, deleted: filename });
    void store.sync({ force: true }).catch(() => {});
    return true;
  }

  return false;
}
