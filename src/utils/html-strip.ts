/**
 * HTML → 마크다운 변환 공통 유틸.
 * output-sanitizer, rendering 두 파이프라인이 공유.
 */

/** 빠른 HTML 존재 여부 체크. false면 변환 불필요. */
export const RE_HAS_HTML = /<[a-z/][a-z0-9]*[\s>/]/i;

// ── 사전 계산 정규식 (모듈 로드 시 1회) ───────────────────────────────────────

/** `<script>`, `<style>`, `<iframe>` 등 위험 블록 태그 + 내용 제거. */
const RE_DANGEROUS_BLOCKS = /<(?:script|style|iframe|object|embed)[^>]*>[\s\S]*?<\/(?:script|style|iframe|object|embed)>/gi;

/** 위험 인라인 태그 (self-closing 포함) 제거. */
const RE_DANGEROUS_INLINE = /<(?:script|style|iframe|object|embed|img)[^>]*\/?>/gi;

const RE_CODE   = /<code>([^<]*)<\/code>/gi;
const RE_BOLD   = /<(?:b|strong)>([^<]*)<\/(?:b|strong)>/gi;
const RE_ITALIC = /<(?:i|em)>([^<]*)<\/(?:i|em)>/gi;
const RE_ANCHOR = /<a\s+href="([^"]+)"[^>]*>([^<]*)<\/a>/gi;
const RE_BR     = /<br\s*\/?>/gi;

/**
 * 6개 공통 HTML → 마크다운 변환 적용.
 * 위험 태그 제거 + 포맷팅 태그를 마크다운 등가물로 변환.
 */
export function apply_html_to_markdown(text: string): string {
  return text
    .replace(RE_DANGEROUS_BLOCKS, "")
    .replace(RE_DANGEROUS_INLINE, "")
    .replace(RE_CODE,   "`$1`")
    .replace(RE_BOLD,   "**$1**")
    .replace(RE_ITALIC, "*$1*")
    .replace(RE_ANCHOR, "[$2]($1)")
    .replace(RE_BR,     "\n");
}
