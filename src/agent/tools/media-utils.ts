/** 미디어 파일 타입 감지 + 로컬 파일 → MediaItem 변환 유틸리티. */
import type { MediaItem } from "../../bus/types.js";
import { is_local_reference, normalize_local_candidate_path, resolve_local_reference } from "../../utils/local-ref.js";
import { existsSync, statSync } from "node:fs";
import { basename, extname } from "node:path";

export function detect_media_type(path_value: string): MediaItem["type"] {
  const lower = String(path_value || "").toLowerCase();
  if (/\.(png|jpg|jpeg|gif|webp|svg)$/.test(lower)) return "image";
  if (/\.(mp4|mov|webm|mkv|avi)$/.test(lower)) return "video";
  if (/\.(mp3|wav|ogg|m4a)$/.test(lower)) return "audio";
  if (/\.(pdf|txt|md|csv|json|zip|tar|gz)$/.test(lower)) return "file";
  const ext = extname(lower);
  if (!ext) return "file";
  return "file";
}

export function to_local_media_item(value: string, workspace: string): MediaItem | null {
  const candidate = normalize_local_candidate_path(value);
  if (!candidate) return null;
  if (!is_local_reference(candidate)) return null;
  const local_path = resolve_local_reference(workspace, candidate);
  if (!existsSync(local_path)) return null;
  try {
    if (!statSync(local_path).isFile()) return null;
  } catch {
    return null;
  }
  return {
    type: detect_media_type(local_path),
    url: local_path,
    name: basename(local_path),
  };
}
