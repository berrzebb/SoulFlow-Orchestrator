/** 미디어 토큰 발행/검증/서빙. workspace 경로 탈출 차단. */

import type { ServerResponse } from "node:http";
import { extname, relative, isAbsolute, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { short_id, now_ms, prune_ttl_map } from "../utils/common.js";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html", ".css": "text/css", ".js": "application/javascript",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8", ".md": "text/markdown; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".zip": "application/zip", ".gif": "image/gif",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".mp4": "video/mp4", ".mp3": "audio/mpeg",
};

/** MIME_TYPES 조회. static-server에서도 참조. */
export function get_mime_type(ext: string): string {
  return MIME_TYPES[ext] || "application/octet-stream";
}

type TokenEntry = { abs_path: string; name: string; mime: string; created_at: number };

const TOKEN_TTL_MS = 3_600_000;

const PRUNE_INTERVAL_MS = 60_000;

export class MediaTokenStore {
  private readonly tokens = new Map<string, TokenEntry>();
  private readonly workspace_dir: string;
  private last_prune_at = 0;

  constructor(workspace_dir: string) {
    this.workspace_dir = resolve(workspace_dir);
  }

  is_within_workspace(abs: string): boolean {
    const rel = relative(this.workspace_dir, abs);
    return !rel.startsWith("..") && !isAbsolute(rel);
  }

  register(abs_path: string): string | null {
    if (!this.is_within_workspace(abs_path)) return null;
    this.prune();
    const token = (short_id() + short_id(8)).replace(/-/g, "");
    const ext = extname(abs_path).toLowerCase();
    const name = abs_path.split(/[\\/]/).pop() || "file";
    this.tokens.set(token, { abs_path, name, mime: get_mime_type(ext), created_at: now_ms() });
    return token;
  }

  async serve(token: string, res: ServerResponse): Promise<void> {
    const entry = this.tokens.get(token);
    if (!entry || now_ms() - entry.created_at > TOKEN_TTL_MS) {
      this.tokens.delete(token);
      res.statusCode = 404; res.end("not_found"); return;
    }
    try {
      const data = await readFile(entry.abs_path);
      res.statusCode = 200;
      res.setHeader("Content-Type", entry.mime);
      const safe_name = entry.name.replace(/["\r\n\\]/g, "_");
      res.setHeader("Content-Disposition", `attachment; filename="${safe_name}"`);
      res.setHeader("Cache-Control", "no-store");
      res.end(data);
    } catch {
      res.statusCode = 404; res.end("not_found");
    }
  }

  private prune(): void {
    const now = now_ms();
    if (now - this.last_prune_at < PRUNE_INTERVAL_MS) return;
    this.last_prune_at = now;
    prune_ttl_map(this.tokens, (e) => e.created_at, TOKEN_TTL_MS, 10_000);
  }
}
