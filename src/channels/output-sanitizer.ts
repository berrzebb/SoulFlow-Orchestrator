/**
 * Output Sanitizer — 프로바이더 출력에서 노이즈, 프로토콜 누출, 페르소나 노출을 제거하는 순수 함수 모듈.
 *
 * 핵심 추상화: `LineMatcher` — 정규식 리스트 기반 라인 필터링의 공통 구조.
 * is_provider_noise_line, is_persona_leak_line, is_sensitive_command_line, is_tool_protocol_leak_line
 * 4개 함수가 모두 동일한 "정규식 리스트 → 하나라도 매칭 → true" 패턴이므로 추상화.
 */

import { escape_regexp, normalize_text } from "../utils/common.js";

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
  // 내부 URI / 메모리 메타데이터 누출 방지
  /\bsqlite:\/\/\S+/i,
  /^\[sqlite:\/\//i,
  /^\[(?:daily|longterm|archive)\//i,
  // 내부 컨텍스트 마커 누출 방지
  /^\[(?:CURRENT_REQUEST|REFERENCE_RECENT_CONTEXT|ATTACHED_FILES)\]/i,
  /\bCURRENT_REQUEST\b.*\bREFERENCE\b.*\b참고용/,
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

/** 스트리밍 전용: 프로바이더 노이즈 판별 (빈 줄은 paragraph break이므로 보존). */
export function is_stream_noise_line(line: string): boolean {
  const l = String(line || "").trim();
  if (!l) return false;
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
    .join("\n");
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
  return strip_inline_html(strip_persona_leak_blocks(filtered)).trim();
}

/** LLM이 생성한 인라인 HTML 태그를 텍스트 등가물로 변환. 잔여 태그는 catch-all로 제거. */
function strip_inline_html(input: string): string {
  const out = String(input || "");
  if (!/<[a-z/][a-z0-9]*[\s>/]/i.test(out)) return out;
  return out
    .replace(/<(?:script|style|iframe|object|embed)[^>]*>[\s\S]*?<\/(?:script|style|iframe|object|embed)>/gi, "")
    .replace(/<(?:script|style|iframe|object|embed|img)[^>]*\/?>/gi, "")
    .replace(/<code>([^<]*)<\/code>/gi, "`$1`")
    .replace(/<(?:b|strong)>([^<]*)<\/(?:b|strong)>/gi, "$1")
    .replace(/<(?:i|em)>([^<]*)<\/(?:i|em)>/gi, "$1")
    .replace(/<a\s+href="[^"]*"[^>]*>([^<]*)<\/a>/gi, "$1")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?[a-z][a-z0-9]*(?:\s[^>]*)?\/?>/gi, "");
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
  // 연속 빈 줄을 최대 1개로 축소 (paragraph break 보존, 과도한 공백 제거)
  return strip_tool_protocol_leaks(filtered).replace(/\n{3,}/g, "\n\n");
}

const RE_LEADING_MENTIONS = /^(\s*@[A-Za-z0-9._-]+\s*)+/;

const MAX_REGEX_CACHE = 200;
const normalize_regex_cache = new Map<string, { intro_ko: RegExp; intro_en: RegExp; sender: RegExp }>();

function get_normalize_regexes(alias: string, sender_id: string) {
  const key = `${alias}\0${sender_id}`;
  let cached = normalize_regex_cache.get(key);
  if (!cached) {
    if (normalize_regex_cache.size >= MAX_REGEX_CACHE) normalize_regex_cache.clear();
    cached = {
      intro_ko: new RegExp(`^안녕하세요[,!\\s]*@?${escape_regexp(alias)}[^\\n]*`, "i"),
      intro_en: new RegExp(`^(hello|hi)[,!\\s]*i\\s*(am|\\'m)\\s*@?${escape_regexp(alias)}[^\\n]*`, "i"),
      sender: sender_id ? new RegExp(`^@${escape_regexp(sender_id)}\\s+`, "i") : /(?!)/,
    };
    normalize_regex_cache.set(key, cached);
  }
  return cached;
}

export function normalize_agent_reply(raw: string, alias: string, sender_id: string): string | null {
  const text = String(raw || "").trim();
  if (!text || is_provider_error_reply(text)) return null;

  const re = get_normalize_regexes(alias, sender_id);

  let cleaned = text;
  cleaned = cleaned.replace(RE_LEADING_MENTIONS, "").trim();
  cleaned = cleaned.replace(re.intro_ko, "").trim();
  cleaned = cleaned.replace(re.intro_en, "").trim();
  if (sender_id) {
    cleaned = cleaned.replace(re.sender, "").trim();
  }

  return cleaned || text || null;
}

export const RE_PROVIDER_ERROR = /^Error calling ([A-Za-z0-9_-]+):\s*(.*)$/i;

export function extract_provider_error(text: string): string | null {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const match = raw.match(RE_PROVIDER_ERROR);
  if (!match) return null;
  const body = String(match[2] || "").trim();
  if (!body) return `provider_error:${String(match[1] || "unknown").toLowerCase()}`;
  return normalize_text(body).slice(0, 180);
}

const PROVIDER_ERROR_INDICATORS = [
  "error calling claude:",
  "error calling claude_code:",
  "error calling chatgpt:",
  "error calling openrouter:",
  "error calling orchestrator_llm:",
  "\"type\":\"authentication_error\"",
  "invalid x-api-key",
  "not logged in",
  "please run /login",
  "stream disconnected before completion",
] as const;

export function is_provider_error_reply(text: string): boolean {
  const t = String(text || "").trim().toLowerCase();
  if (!t) return false;
  return PROVIDER_ERROR_INDICATORS.some((indicator) => t.includes(indicator));
}
