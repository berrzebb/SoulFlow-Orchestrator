import type { MediaItem } from "../bus/types.js";
import { existsSync, statSync } from "node:fs";
import { is_local_reference, normalize_local_candidate_path, resolve_local_reference } from "../utils/local-ref.js";

/** 렌더링 텍스트에서 로컬 미디어 참조를 추출하고, 텍스트에서 제거. */
export function extract_media_items(text: string, workspace_dir: string): { content: string; media: MediaItem[] } {
  let content = String(text || "");
  const media: MediaItem[] = [];
  const seen = new Set<string>();

  const try_push = (url_raw: string, alt?: string): boolean => {
    const candidate = normalize_local_candidate_path(String(url_raw || "").trim());
    if (!candidate || !is_local_reference(candidate)) return false;
    const path = resolve_local_reference(workspace_dir, candidate);
    if (!path || seen.has(path)) return false;
    try { if (!existsSync(path) || !statSync(path).isFile()) return false; } catch { return false; }
    const type = detect_media_type(path);
    if (!type) return false;
    seen.add(path);
    media.push({ type, url: path, name: alt?.slice(0, 120) });
    return true;
  };

  content = content.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (m, alt, url) => try_push(url, alt) ? "" : m);
  content = content.replace(/<(?:img|video)[^>]*src=["']([^"']+)["'][^>]*>/gi, (m, url) => try_push(url) ? "" : m);
  content = content.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (m, label, url) => try_push(url, label) ? "" : m);

  return { content: content.replace(/\n{3,}/g, "\n\n").trim(), media };
}

function detect_media_type(url: string): MediaItem["type"] | null {
  const lower = String(url || "").toLowerCase();
  if (/\.(png|jpg|jpeg|gif|webp|svg)(\?.*)?$/.test(lower)) return "image";
  if (/\.(mp4|mov|webm|mkv|avi)(\?.*)?$/.test(lower)) return "video";
  if (/\.(mp3|wav|ogg|m4a)(\?.*)?$/.test(lower)) return "audio";
  if (/\.(pdf|txt|md|csv|json|zip|tar|gz)(\?.*)?$/.test(lower)) return "file";
  return null;
}
