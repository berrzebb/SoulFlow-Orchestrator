import { access } from "node:fs/promises";
import { randomUUID } from "node:crypto";

export function now_ms(): number {
  return Date.now();
}

export function now_iso(): string {
  return new Date().toISOString();
}

const SEOUL_FORMATTER = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Seoul",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
  hour12: false,
});

/** Asia/Seoul KST ISO 형식 타임스탬프. sv-SE locale → "YYYY-MM-DD HH:mm:ss" 형식. */
export function now_seoul_iso(): string {
  return SEOUL_FORMATTER.format(new Date()).replace(" ", "T") + "+09:00";
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

/** unknown 값을 안전하게 문자열로 변환. JSON 직렬화 실패 시 String() 폴백. */
export function safe_stringify(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  try { return JSON.stringify(value, null, 2); }
  catch { return String(value); }
}

/** unknown 에러를 메시지 문자열로 변환. */
export function error_message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** 공백 정규화 + trim. lowercase 옵션 지원 (dedupe key 등). */
export function normalize_text(value: unknown, lowercase = false): string {
  const s = String(value || "").replace(/\s+/g, " ").trim();
  return lowercase ? s.toLowerCase() : s;
}

/** UUID 기반 짧은 ID 생성. */
export function short_id(length: 8 | 12 = 12): string {
  return randomUUID().slice(0, length);
}

/** 문자열을 불리언으로 파싱. "1"/"true"/"yes"/"on" → true, "0"/"false"/"no"/"off" → false. */
export function parse_bool_like(raw: string | undefined, fallback: boolean): boolean {
  const v = String(raw || "").trim().toLowerCase();
  if (!v) return fallback;
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return fallback;
}

/** 의도적 fire-and-forget. Promise 결과/에러를 무시한다. */
export function swallow(p: void | Promise<unknown>): void {
  if (p instanceof Promise) void p.catch(() => {});
}

/** AbortSignal.timeout + 외부 시그널 병합. 외부 시그널 없으면 타임아웃 전용 반환. */
export function make_abort_signal(timeout_ms: number, external?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeout_ms);
  return external ? AbortSignal.any([external, timeout]) : timeout;
}


