/**
 * Output Sanitizer — 프로바이더 출력에서 노이즈, 프로토콜 누출, 페르소나 노출을 제거.
 *
 * 핵심 원칙: 코드블록(``` ... ```) 내부는 필터링하지 않는다.
 * 라인 필터는 prose 영역에만 적용되고, 코드블록은 통과시킨다.
 */

import { escape_regexp, normalize_text } from "../utils/common.js";

// ── Line Matchers ──

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
  /^\s*\{?\s*"tool_calls"\s*:\s*\[/i,
  /^\s*\{?\s*"tool_call_id"\s*:/i,
  /^\s*"id"\s*:\s*"call_[A-Za-z0-9_]+"\s*[,}]/i,
];

const PROVIDER_NOISE_PATTERNS: RegExp[] = [
  /^오케스트레이터\s*(?:직접\s*처리|분배|분류|라우팅)/i,
  /^orchestrator\s*(?:direct|route|routing|dispatch|classification)/i,
  /^(?:execution\s*mode|mode|route|routing)\s*[:=]\s*(?:once|task|agent)\b/i,
  /^(?:분류|라우팅|모드)\s*[:=]\s*(?:once|task|agent)\b/i,
  /^[[\]{}(),;:]{3,}$/,
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
  // 내부 URI / 메모리 메타데이터 누출 방지
  /^\[?sqlite:\/\/(?:workspace|runtime|data)\//i,
  /^\[(?:daily|longterm|archive)\//i,
  // 내부 컨텍스트 마커 누출 방지
  /^\[(?:CURRENT_REQUEST|REFERENCE_RECENT_CONTEXT|ATTACHED_FILES)\]/i,
  /\bCURRENT_REQUEST\b.*\bREFERENCE\b.*\b참고용/,
];

const PERSONA_LEAK_PATTERNS: RegExp[] = [
  /^<\s*\/?\s*instructions?\s*>$/i,
  /^you are (?:codex|chatgpt|claude|gemini|an ai assistant|a coding agent)\b/i,
  /^(?:developer|system)\s+(?:message|instruction|instructions)\b/i,
  /\b(?:agents|soul|heart|tools|user)\.md\b/i,
  /^(?:#\s*)?role:\s*/i,
  /^(?:#\s*)?(?:identity|mission|responsibilities|constraints|execution ethos|communication rules)\b/i,
  /\b(?:collaboration mode|approved command prefixes|sandbox_permissions)\b/i,
  // 모델명 자기소개 라인 제거
  /^(?:저는|나는)\s*(?:Codex|ChatGPT|GPT-?\d*|Claude|Gemini|AI\s*(?:코딩\s*)?(?:어시스턴트|에이전트|비서|도우미)|언어\s*모델)\b/i,
  /^I\s*(?:am|'m)\s*(?:Codex|ChatGPT|GPT-?\d*|Claude|Gemini|an?\s*AI\s*(?:coding\s*)?(?:assistant|agent|helper)|a\s*language\s*model)\b/i,
];

const SENSITIVE_COMMAND_PATTERNS: RegExp[] = [
  /^(?:Bash|PowerShell) command\b/i,
  /^Do you want to proceed\?/i,
  /^(?:yes|no),?\s*allow\b/i,
  /^PS [A-Za-z]:\\.*>/,
  /^[A-Za-z]:\\.*>(?:\s|$)/,
  /^(?:\$|#|PS>)\s+(?:cd|ls|rm|mkdir|chmod|git|npm|cargo)\b/,
  /^\$env:[A-Za-z_][A-Za-z0-9_]*\s*=/,
  /^(?:export|set)\s+[A-Za-z_][A-Za-z0-9_]*=/,
];

export const is_tool_protocol_leak_line = create_line_matcher(TOOL_PROTOCOL_LEAK_PATTERNS);
export const is_persona_leak_line = create_line_matcher(PERSONA_LEAK_PATTERNS);
export const is_sensitive_command_line = create_line_matcher(SENSITIVE_COMMAND_PATTERNS);

export function is_provider_noise_line(line: string): boolean {
  const l = String(line || "").trim();
  if (!l) return false;
  return is_tool_protocol_leak_line(l) || PROVIDER_NOISE_PATTERNS.some((p) => p.test(l));
}

export function is_stream_noise_line(line: string): boolean {
  const l = String(line || "").trim();
  if (!l) return false;
  return is_provider_noise_line(l);
}

// ── Code-block-aware line filtering ──

const CODE_FENCE_RE = /^(`{3,}|~{3,})/;

type LineFilter = (line: string) => boolean;

/** 코드블록 내부를 건너뛰며 prose 영역에만 reject 필터를 적용. */
function filter_lines(text: string, reject: LineFilter[]): string {
  const lines = text.split("\n");
  const result: string[] = [];
  let fence: string | null = null; // 현재 열린 코드블록의 펜스 문자열

  for (const raw of lines) {
    const trimmed = raw.trimEnd();
    const fence_match = trimmed.match(CODE_FENCE_RE);

    if (fence) {
      // 코드블록 내부 — 닫는 펜스인지 확인
      if (fence_match && trimmed.startsWith(fence) && trimmed.slice(fence.length).trim() === "") {
        fence = null;
      }
      result.push(trimmed);
      continue;
    }

    // 여는 펜스 감지
    if (fence_match) {
      fence = fence_match[1]!;
      result.push(trimmed);
      continue;
    }

    // prose 영역 — reject 필터 적용
    if (!reject.some((fn) => fn(trimmed))) {
      result.push(trimmed);
    }
  }

  return result.join("\n");
}

// ── Block-level strippers ──

const ORCH_TOOL_BLOCK_RE = /<?<ORCH_TOOL_CALLS>?>[^<]{0,50000}<?<(?:\/ORCH_TOOL_CALLS|ORCH_TOOL_CALLS_END)>?>(?:\n?)/gi;
const PERSONA_BLOCK_RE = /```[^`]{0,10000}(?:AGENTS\.md|SOUL\.md|HEART\.md|TOOLS\.md|USER\.md)[^`]{0,10000}```/gi;
const CODEX_BLOCK_RE = /```[^`]{0,10000}\bYou are Codex\b[^`]{0,10000}```/gi;

export function strip_tool_protocol_leaks(raw: string): string {
  if (!raw) return "";
  const after_blocks = raw.replace(ORCH_TOOL_BLOCK_RE, "");
  return filter_lines(after_blocks, [is_tool_protocol_leak_line]);
}

export function strip_persona_leak_blocks(raw: string): string {
  if (!raw) return "";
  return raw.replace(PERSONA_BLOCK_RE, "").replace(CODEX_BLOCK_RE, "").trim();
}

// ── Inline cleaners ──

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

/** 위험 HTML 태그만 제거. 안전한 포맷팅 태그는 마크다운 등가물로 변환. 코드블록 내부는 건드리지 않음. */
function strip_dangerous_html(input: string): string {
  const out = String(input || "");
  if (!/<[a-z/][a-z0-9]*[\s>/]/i.test(out)) return out;

  // 코드블록을 플레이스홀더로 대체 → HTML 변환 → 복원
  const blocks: string[] = [];
  const placeholder = (i: number) => `\x00CB${i}\x00`;
  const preserved = out.replace(/(`{3,}|~{3,})[^\n]*\n[\s\S]*?\1/g, (match) => {
    blocks.push(match);
    return placeholder(blocks.length - 1);
  });

  const cleaned = preserved
    .replace(/<(?:script|style|iframe|object|embed)[^>]*>[\s\S]*?<\/(?:script|style|iframe|object|embed)>/gi, "")
    .replace(/<(?:script|style|iframe|object|embed|img)[^>]*\/?>/gi, "")
    .replace(/<code>([^<]*)<\/code>/gi, "`$1`")
    .replace(/<(?:b|strong)>([^<]*)<\/(?:b|strong)>/gi, "**$1**")
    .replace(/<(?:i|em)>([^<]*)<\/(?:i|em)>/gi, "*$1*")
    .replace(/<a\s+href="([^"]*)"[^>]*>([^<]*)<\/a>/gi, "[$2]($1)")
    .replace(/<br\s*\/?>/gi, "\n");

  // 플레이스홀더를 원본 코드블록으로 복원
  return cleaned.replace(/\x00CB(\d+)\x00/g, (_, i) => blocks[Number(i)] ?? "");
}

// ── Public sanitize functions ──

const FINAL_OUTPUT_LINE_FILTERS: LineFilter[] = [
  is_provider_noise_line,
  is_persona_leak_line,
];

const STREAM_LINE_FILTERS: LineFilter[] = [
  is_stream_noise_line,
  is_persona_leak_line,
  is_sensitive_command_line,
];

export function sanitize_provider_output(raw: string): string {
  const text = strip_secret_reference_tokens(strip_ansi(String(raw || "")).replace(/\r/g, ""));
  if (!text) return "";
  const blocks_stripped = strip_tool_protocol_leaks(text);
  const filtered = filter_lines(blocks_stripped, FINAL_OUTPUT_LINE_FILTERS);
  return strip_dangerous_html(strip_persona_leak_blocks(filtered)).trim();
}

const ORCH_FINAL_RE = /<<ORCH_FINAL(?:_END)?>>/g;
const STREAM_ENV_RE = /^\s*(?:\$\s*env:|export\s+[A-Za-z_]|set\s+[A-Za-z_])/i;

export function sanitize_stream_chunk(raw: string): string {
  const clean = strip_dangerous_html(strip_secret_reference_tokens(strip_ansi(String(raw || ""))))
    .replace(/\r/g, "")
    .replace(ORCH_FINAL_RE, "");
  if (!clean) return "";
  const filtered = filter_lines(clean, STREAM_LINE_FILTERS)
    .split("\n")
    .filter((l) => !STREAM_ENV_RE.test(l))
    .join("\n");
  return strip_tool_protocol_leaks(filtered).replace(/\n{3,}/g, "\n\n");
}

// ── Agent reply normalization ──

const RE_LEADING_MENTIONS = /^(\s*@[A-Za-z0-9._-]+\s*)+/;

/** 모델명/AI 정체성 자기소개 패턴 — prose 첫 문장에서 제거. */
const MODEL_IDENTITY_INTROS: RegExp[] = [
  /^(?:안녕하세요[,!.\s]*)?(?:저는|나는)\s*(?:Codex|코덱스(?:\s*\(Codex\))?|ChatGPT|챗지피티|GPT-?\d*|Claude|클로드|Gemini|제미니|AI\s*(?:코딩\s*)?(?:어시스턴트|에이전트|비서|도우미)|언어\s*모델)[^.\n]*[.!]?\s*/i,
  /^(?:hello[,!.\s]*)?i\s*(?:am|'m)\s*(?:Codex|ChatGPT|GPT-?\d*|Claude|Gemini|an?\s*AI\s*(?:coding\s*)?(?:assistant|agent|helper)|a\s*language\s*model)[^.\n]*[.!]?\s*/i,
  /^(?:I\s*am|I'm)\s+(?:Codex|ChatGPT|Claude|Gemini)[^.\n]*[.!]?\s*/i,
  /^(?:저는|나는)\s*(?:OpenAI|Anthropic|Google)\s*(?:에서|이|가)\s*(?:만든|개발한)[^.\n]*[.!]?\s*/i,
];

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
  for (const pattern of MODEL_IDENTITY_INTROS) {
    cleaned = cleaned.replace(pattern, "").trim();
  }

  return cleaned || null;
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
