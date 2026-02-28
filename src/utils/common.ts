import { access, mkdir, readFile } from "node:fs/promises";

export function now_ms(): number {
  return Date.now();
}

export function now_iso(): string {
  return new Date().toISOString();
}

export function today_key(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export async function file_exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function ensure_dir(path: string): Promise<string> {
  await mkdir(path, { recursive: true });
  return path;
}

export function safe_filename(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_");
}

/** TTL + maxSize 기반 Map 정리. get_ts_ms로 각 엔트리의 타임스탬프를 추출. */
export function prune_ttl_map<V>(
  map: Map<string, V>,
  get_ts_ms: (value: V) => number,
  ttl_ms: number,
  max_size: number,
): void {
  if (map.size === 0) return;
  const now = Date.now();
  for (const [key, value] of map) {
    if (now - get_ts_ms(value) > ttl_ms) map.delete(key);
  }
  if (map.size <= max_size) return;
  let overflow = map.size - max_size;
  for (const key of map.keys()) {
    if (overflow-- <= 0) break;
    map.delete(key);
  }
}

export function escape_regexp(value: string): string {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function escape_html(input: string): string {
  return String(input || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/** unknown 값을 Record<string, unknown>으로 안전 변환. 배열·null·프리미티브 → null. */
export function ensure_json_object(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

/** 공백 정규화 + trim. lowercase 옵션 지원 (dedupe key 등). */
export function normalize_text(value: unknown, lowercase = false): string {
  const s = String(value || "").replace(/\s+/g, " ").trim();
  return lowercase ? s.toLowerCase() : s;
}

/** 문자열을 불리언으로 파싱. "1"/"true"/"yes"/"on" → true, "0"/"false"/"no"/"off" → false. */
export function parse_bool_like(raw: string | undefined, fallback: boolean): boolean {
  const v = String(raw || "").trim().toLowerCase();
  if (!v) return fallback;
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return fallback;
}

export async function read_text_if_exists(path: string): Promise<string | null> {
  if (!(await file_exists(path))) return null;
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

