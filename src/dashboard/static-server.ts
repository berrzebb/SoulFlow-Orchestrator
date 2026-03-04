/** 정적 파일 서빙 (dist/web/ SPA). service.ts에서 분리. */

import type { ServerResponse } from "node:http";
import { join, extname } from "node:path";
import { accessSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { set_no_cache } from "./route-context.js";
import { get_mime_type } from "./media-store.js";

const __dirname = join(fileURLToPath(import.meta.url), "..");
const PROJECT_ROOT = join(__dirname, "..", "..");

export function resolve_web_dir(): string {
  const candidates = [
    join(PROJECT_ROOT, "dist", "web"),
    join(__dirname, "..", "web"),
  ];
  for (const dir of candidates) {
    try { accessSync(join(dir, "index.html")); return dir; } catch { /* next */ }
  }
  return candidates[0];
}

/** dist/web/ 정적 파일 서빙. 파일 없으면 index.html (SPA fallback). */
export async function serve_static(web_dir: string, pathname: string, res: ServerResponse): Promise<void> {
  const rel = pathname.replace(/^\/web\/?/, "") || "index.html";
  const safe = rel.replace(/\.\./g, "");
  const file_path = join(web_dir, safe);
  try {
    const data = await readFile(file_path);
    const ext = extname(file_path);
    res.statusCode = 200;
    res.setHeader("Content-Type", get_mime_type(ext));
    if (ext === ".html") set_no_cache(res);
    else res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.end(data);
  } catch {
    try {
      const index = await readFile(join(web_dir, "index.html"));
      set_no_cache(res);
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(index);
    } catch {
      res.statusCode = 404;
      res.end("not_found");
    }
  }
}
