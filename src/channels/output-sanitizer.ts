/**
 * Output Sanitizer — 프로바이더 출력에서 노이즈, 프로토콜 누출, 페르소나 노출을 제거하는 순수 함수 모듈.
 *
 * 핵심 추상화: `LineMatcher` — 정규식 리스트 기반 라인 필터링의 공통 구조.
 * is_provider_noise_line, is_persona_leak_line, is_sensitive_command_line, is_tool_protocol_leak_line
 * 4개 함수가 모두 동일한 "정규식 리스트 → 하나라도 매칭 → true" 패턴이므로 추상화.
 */

type LineMatcher = (line: string) => boolean;

function create_line_matcher(patterns: RegExp[]): LineMatcher {
  return (line: string): boolean => {
    const l = String(line || "").trim();
    if (!l) return false;
    return patterns.some((p) => p.test(l));
  };
}

const TOOL_PROTOCOL_LEAK_PATTERNS: RegExp[] = [
  /^tool_calls:\s*\[\d+\s*items?\]/i,
  /"tool_calls"\s*:/i,
  /"tool_call_id"\s*:/i,
  /"id"\s*:\s*"call_[^"]+"/i,
  /^\{"id":"call_[^"]+"/i,
  /^\{"tool_calls":\[/i,
];

const PROVIDER_NOISE_PATTERNS: RegExp[] = [
  /^오케스트레이터\s*(?:직접\s*처리|분배|분류|라우팅)/i,
  /^orchestrator\s*(?:direct|route|routing|dispatch|classification)/i,
  /^(?:execution\s*mode|mode|route|routing)\s*[:=]\s*(?:once|task|agent)\b/i,
  /^(?:분류|라우팅|모드)\s*[:=]\s*(?:once|task|agent)\b/i,
  /^[[\]{}(),;:]+$/,
  /^OpenAI Codex v/i,
  /^WARNING: proceeding, even though we could not update PATH:/i,
  /^(?:workdir|model|provider|approval|sandbox|session id|mcp startup):\s*/i,
  /^reasoning /i,
  /^Reconnecting\.\.\./i,
  /^\d{4}-\d{2}-\d{2}T.*codex_core::/i,
  /^<?<ORCH_TOOL_CALLS(?:_END)?>?>$/i,
  /^<\/ORCH_TOOL_CALLS>$/i,
  /unexpected argument ['"]-a['"] found/i,
  /^error:\s+unexpected argument ['"][^'"]+['"] found$/i,
  /^tip:\s+to pass ['"][^'"]+['"] as a value, use ['"]--\s+[^'"]+['"]$/i,
  /^for more information, try ['"]--help['"]\.?$/i,
  /^usage:\s+codex\b/i,
  /^-{3,}$/,
  /^user$/i,
];

const PERSONA_LEAK_PATTERNS: RegExp[] = [
  /^<\s*\/?\s*instructions?\s*>$/i,
  /^you are (?:codex|chatgpt|an ai assistant|a coding agent)\b/i,
  /^(?:developer|system)\s+(?:message|instruction|instructions)\b/i,
  /\b(?:agents|soul|heart|tools|user)\.md\b/i,
  /^(?:#\s*)?role:\s*/i,
  /^(?:#\s*)?(?:identity|mission|responsibilities|constraints|execution ethos|communication rules)\b/i,
  /\b(?:collaboration mode|approved command prefixes|sandbox_permissions)\b/i,
];

const SENSITIVE_COMMAND_PATTERNS: RegExp[] = [
  /^(?:Bash|PowerShell) command\b/i,
  /^Do you want to proceed\?/i,
  /^(?:yes|no),?\s*allow\b/i,
  /^PS [A-Za-z]:\\.*>/,
  /^[A-Za-z]:\\.*>/,
  /^(?:\$|#|PS>)\s+/,
  /^\$env:[A-Za-z_][A-Za-z0-9_]*\s*=/,
  /^(?:export|set)\s+[A-Za-z_][A-Za-z0-9_]*=/,
  /^(?:bash|sh|zsh|powershell|pwsh|cmd(?:\.exe)?)\b/i,
  /^(?:cd|ls|dir|cat|grep|awk|sed|find|rg|npm|node|python|pip|cargo|git|dotnet|msbuild|chmod|chown|cp|mv|rm|mkdir|touch|echo)\b/i,
  /^\s*dotnet\s+build\b/i,
  /^\s*npm\s+run\s+\S+/i,
  /^\s*cargo\s+(build|test|check|run)\b/i,
  /^```(?:bash|sh|zsh|powershell|pwsh|cmd|shell|ps1|bat)?$/i,
];

export const is_tool_protocol_leak_line = create_line_matcher(TOOL_PROTOCOL_LEAK_PATTERNS);
export const is_persona_leak_line = create_line_matcher(PERSONA_LEAK_PATTERNS);
export const is_sensitive_command_line = create_line_matcher(SENSITIVE_COMMAND_PATTERNS);

export function is_provider_noise_line(line: string): boolean {
  const l = String(line || "").trim();
  if (!l) return false;
  return is_tool_protocol_leak_line(l) || PROVIDER_NOISE_PATTERNS.some((p) => p.test(l));
}

/** 스트리밍 전용: 빈 줄도 노이즈로 취급하여 청크 크기를 줄인다. */
export function is_stream_noise_line(line: string): boolean {
  const l = String(line || "").trim();
  if (!l) return true;
  return is_provider_noise_line(l);
}

const ORCH_TOOL_BLOCK_RE = /<?<ORCH_TOOL_CALLS>?>[^<]{0,50000}<?<(?:\/ORCH_TOOL_CALLS|ORCH_TOOL_CALLS_END)>?>(?:\n?)/gi;
const PERSONA_BLOCK_RE = /```[^`]{0,10000}(?:AGENTS\.md|SOUL\.md|HEART\.md|TOOLS\.md|USER\.md)[^`]{0,10000}```/gi;
const CODEX_BLOCK_RE = /```[^`]{0,10000}\bYou are Codex\b[^`]{0,10000}```/gi;
const SHELL_BLOCK_RE = /```(?:bash|sh|zsh|powershell|pwsh|cmd|shell|ps1|bat)[^`]{0,50000}```/gi;

export function strip_tool_protocol_leaks(raw: string): string {
  if (!raw) return "";
  return raw
    .replace(ORCH_TOOL_BLOCK_RE, "")
    .split("\n")
    .filter((l) => !is_tool_protocol_leak_line(l.trimEnd()))
    .join("\n")
    .trim();
}

export function strip_persona_leak_blocks(raw: string): string {
  if (!raw) return "";
  return raw.replace(PERSONA_BLOCK_RE, "").replace(CODEX_BLOCK_RE, "").trim();
}

export function strip_sensitive_command_blocks(raw: string): string {
  if (!raw) return "";
  return strip_persona_leak_blocks(raw.replace(SHELL_BLOCK_RE, "")).trim();
}

const ANSI_RE = /\x1B\[[0-9;]*[A-Za-z]/g;
const SECRET_REF_RE = /\{\{\s*secret:[^}]+\}\}/gi;
const CIPHERTEXT_RE = /\bsv1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;

export function strip_ansi(v: string): string {
  return String(v || "").replace(ANSI_RE, "");
}

export function strip_secret_reference_tokens(raw: string): string {
  return String(raw || "")
    .replace(SECRET_REF_RE, "[REDACTED:SECRET_REF]")
    .replace(CIPHERTEXT_RE, "[REDACTED:CIPHERTEXT]");
}

type LineFilter = (line: string) => boolean;

function filter_lines(text: string, reject: LineFilter[]): string {
  return text
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => !reject.some((fn) => fn(l)))
    .join("\n");
}

/** 최종 응답용: 민감 명령 필터 제외 (에이전트의 자연어 응답을 보존). */
const FINAL_OUTPUT_LINE_FILTERS: LineFilter[] = [
  is_provider_noise_line,
  is_persona_leak_line,
];

/** 스트리밍용: 민감 명령 + 빈 줄까지 적극 필터링. */
const STREAM_LINE_FILTERS: LineFilter[] = [
  is_stream_noise_line,
  is_persona_leak_line,
  is_sensitive_command_line,
];

export function sanitize_provider_output(raw: string): string {
  const text = strip_secret_reference_tokens(strip_ansi(String(raw || "")).replace(/\r/g, ""));
  if (!text) return "";
  // 블록 정규식을 라인 필터보다 먼저 실행 (구분자가 라인 단위 제거되면 블록 매칭 불가)
  const blocks_stripped = strip_tool_protocol_leaks(text);
  const filtered = filter_lines(blocks_stripped, FINAL_OUTPUT_LINE_FILTERS);
  return strip_persona_leak_blocks(filtered).trim();
}

/** LLM이 생성한 인라인 HTML 태그를 텍스트 등가물로 변환 (스트리밍 중간 표시용). */
function strip_inline_html(input: string): string {
  const out = String(input || "");
  if (!/<[a-z][a-z0-9]*[\s>]/i.test(out)) return out;
  return out
    .replace(/<code>([^<]+)<\/code>/gi, "`$1`")
    .replace(/<(?:b|strong)>([^<]+)<\/(?:b|strong)>/gi, "$1")
    .replace(/<(?:i|em)>([^<]+)<\/(?:i|em)>/gi, "$1")
    .replace(/<a\s+href="[^"]*"[^>]*>([^<]+)<\/a>/gi, "$1")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(?:p|div|span)[^>]*>/gi, "");
}

const ORCH_FINAL_RE = /<<ORCH_FINAL(?:_END)?>>/g;
const STREAM_ENV_RE = /^\s*(?:\$\s*env:|export\s+[A-Za-z_]|set\s+[A-Za-z_])/i;

export function sanitize_stream_chunk(raw: string): string {
  const clean = strip_inline_html(strip_secret_reference_tokens(strip_ansi(String(raw || ""))))
    .replace(/\r/g, "")
    .replace(ORCH_FINAL_RE, "");
  if (!clean) return "";
  const filtered = filter_lines(clean, STREAM_LINE_FILTERS)
    .split("\n")
    .filter((l) => !STREAM_ENV_RE.test(l))
    .join("\n");
  return strip_tool_protocol_leaks(filtered).slice(0, 800).trim();
}

export function normalize_agent_reply(raw: string, alias: string, sender_id: string): string | null {
  const text = String(raw || "").trim();
  if (!text || is_provider_error_reply(text)) return null;

  let cleaned = text;
  const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // 선행 멘션 체인 제거
  cleaned = cleaned.replace(/^(\s*@[A-Za-z0-9._-]+\s*)+/g, "").trim();
  // 자기소개 패턴 제거
  cleaned = cleaned.replace(new RegExp(`^안녕하세요[,!\\s]*@?${esc(alias)}[^\\n]*`, "i"), "").trim();
  cleaned = cleaned.replace(new RegExp(`^(hello|hi)[,!\\s]*i\\s*(am|\\'m)\\s*@?${esc(alias)}[^\\n]*`, "i"), "").trim();
  // 발신자 멘션 에코 제거
  if (sender_id) {
    cleaned = cleaned.replace(new RegExp(`^@${esc(sender_id)}\\s+`, "i"), "").trim();
  }

  return cleaned || text || null;
}

export function extract_provider_error(text: string): string | null {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const match = raw.match(/^Error calling ([A-Za-z0-9_-]+):\s*(.*)$/i);
  if (!match) return null;
  const body = String(match[2] || "").trim();
  if (!body) return `provider_error:${String(match[1] || "unknown").toLowerCase()}`;
  return body.replace(/\s+/g, " ").slice(0, 180);
}

const PROVIDER_ERROR_INDICATORS = [
  "error calling claude:",
  "error calling claude_code:",
  "error calling chatgpt:",
  "error calling openrouter:",
  "error calling phi4_local:",
  "\"type\":\"authentication_error\"",
  "invalid x-api-key",
  "not logged in",
  "please run /login",
  "stream disconnected before completion",
] as const;

export function is_provider_error_reply(text: string): boolean {
  const t = String(text || "").trim().toLowerCase();
  if (!t) return false;
  return PROVIDER_ERROR_INDICATORS.some((indicator) =>
    t.startsWith(indicator) || t.includes(indicator),
  );
}
