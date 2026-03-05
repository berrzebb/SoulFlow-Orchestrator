/** 메모리 검색 결과의 내부 URI를 사용자 친화적 라벨로 변환. */

const SQLITE_PREFIX = "sqlite://memory/";

/** `sqlite://memory/daily/2026-03-04` → `daily/2026-03-04`, `sqlite://memory/longterm` → `longterm`. */
export function strip_memory_uri(uri: string): string {
  const s = String(uri || "").trim();
  if (s.startsWith(SQLITE_PREFIX)) return s.slice(SQLITE_PREFIX.length);
  // sqlite:// 이외의 내부 경로도 방어적으로 처리
  if (s.startsWith("sqlite://")) return s.slice("sqlite://".length);
  return s;
}
