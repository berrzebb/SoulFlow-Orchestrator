/** 실행 모드 분류: 키워드 휴리스틱 기반 once/agent/task/builtin/inquiry/identity 판정. LLM 미사용. */

import type { Logger } from "../logger.js";
import type { ClassificationResult } from "./types.js";
import { DEFAULT_CLASSIFIER_LOCALE } from "./classifier-locale.js";
import { extract_intents, intents_to_categories } from "./intent-patterns.js";

export type SkillEntry = { name: string; summary: string; triggers: string[]; aliases?: string[] };

export type ClassifierContext = {
  active_tasks?: import("../contracts.js").TaskState[];
  recent_history?: Array<{ role: string; content: string }>;
  available_tool_categories?: string[];
  available_skills?: SkillEntry[];
};

// ── 결정론적 패턴 ────────────────────────────────────────────────────────────

/** /커맨드 인자 파싱. */
const RE_BUILTIN = /^\/(\S+)(?:\s+(.*))?$/s;

/** 구두점 제거 후 공백 분리 토큰 집합 반환. */
function tokenize(text: string): Set<string> {
  return new Set(
    text.toLowerCase().replace(/[?!.,;:'"''""\s]+/g, " ").trim().split(" ").filter(Boolean),
  );
}

/** Jaccard 유사도: |교집합| / |합집합|. */
function jaccard(a: Set<string>, b: Set<string>): number {
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

/**
 * 사전 계산된 레퍼런스 토큰 집합과 비교.
 * 호출마다 tokenize() 재실행 없이 O(k·n) → 조기 종료.
 */
function exceeds_similarity(tokens: Set<string>, ref_sets: Set<string>[], threshold: number): boolean {
  for (const ref of ref_sets) {
    if (jaccard(tokens, ref) >= threshold) return true;
  }
  return false;
}

// ── 사전 계산 (모듈 로드 시 1회) ─────────────────────────────────────────────

const IDENTITY_THRESHOLD = 0.4;
const INQUIRY_THRESHOLD  = 0.3;

const IDENTITY_TOKEN_SETS = DEFAULT_CLASSIFIER_LOCALE.identity_phrases.map(tokenize);

const INQUIRY_TOKEN_SETS = DEFAULT_CLASSIFIER_LOCALE.inquiry_phrases.map(tokenize);

/**
 * 단일 토큰 다단계 연결어 집합.
 * 주의: "하고", "그리고"는 한국어 일반 조사로 오매칭 위험 (예: "파이썬 하고 자바 차이")
 * → 이들은 AGENT_CONNECTOR_PHRASES("하고 나서" 등)에만 포함.
 */
const AGENT_CONNECTOR_TOKENS = new Set(DEFAULT_CLASSIFIER_LOCALE.connector_tokens);

/** 다단계 연결 구문 (두 단어 이상) — 토큰 분리 불가하여 구문 매칭 유지. */
const AGENT_CONNECTOR_PHRASES = DEFAULT_CLASSIFIER_LOCALE.connector_phrases;

/** 명시적 비동기 실행 신호 — 구문 의미가 중요하여 구문 매칭 유지. */
const TASK_SIGNAL_PHRASES = DEFAULT_CLASSIFIER_LOCALE.task_signal_phrases;

/** 도구 조합 쌍 — 두 토큰이 모두 있으면 다단계 작업으로 판단. */
const AGENT_TOOL_PAIRS: [string, string][] = DEFAULT_CLASSIFIER_LOCALE.tool_pairs;

// ── 유사도 판별 함수 ──────────────────────────────────────────────────────────

/** 토큰 집합을 받아 identity 판정 — fast_classify에서 1회 토큰화 후 재사용. */
function is_identity_question(tokens: Set<string>): boolean {
  return tokens.size > 0 && exceeds_similarity(tokens, IDENTITY_TOKEN_SETS, IDENTITY_THRESHOLD);
}

/** 토큰 집합을 받아 inquiry 판정 — fast_classify에서 1회 토큰화 후 재사용. */
function is_inquiry_question(tokens: Set<string>): boolean {
  return tokens.size > 0 && exceeds_similarity(tokens, INQUIRY_TOKEN_SETS, INQUIRY_THRESHOLD);
}

/**
 * 최근 어시스턴트 메시지가 태스크 생성/실행을 언급한 직후 짧은 후속 메시지이면
 * inquiry 가능성이 높음 (예: "됐어?", "끝났어?").
 * 6토큰 이하 조건: 짧은 확인 질문에만 적용하여 오탐 방지.
 */
const RE_TASK_MENTION = new RegExp(DEFAULT_CLASSIFIER_LOCALE.task_mention_patterns.join("|"), "i");

function is_followup_inquiry(tokens: Set<string>, history: Array<{ role: string; content: string }> | undefined): boolean {
  if (!history?.length || tokens.size > 6) return false;
  const last_assistant = [...history].reverse().find(h => h.role === "assistant");
  return !!last_assistant && RE_TASK_MENTION.test(last_assistant.content);
}

/** 어시스턴트가 추가 정보를 요청했음을 나타내는 패턴 (locale 기반). */
const RE_ASSISTANT_INFO_REQUEST = new RegExp(
  DEFAULT_CLASSIFIER_LOCALE.assistant_info_request_patterns.join("|"), "i",
);

/** 사용자가 이전 맥락(위치/조건)을 참조하는 짧은 후속 메시지 패턴 (locale 기반). */
const RE_USER_CONTEXT_REFERENCE = new RegExp(
  DEFAULT_CLASSIFIER_LOCALE.user_context_reference_patterns.join("|"), "i",
);

/**
 * 짧은 후속 메시지일 때 대화 히스토리에서 도구 카테고리 힌트를 추출.
 *
 * 트리거 조건 (둘 중 하나):
 * A. 마지막 어시스턴트가 추가 정보를 요청한 후 사용자가 짧게 답하는 경우
 *    예: "위치를 알려주세요" → "야탐 아미고 타워 주변"
 * B. 사용자가 이미 제공한 맥락(위치/조건)을 참조하며 짧게 후속 요청하는 경우
 *    예: AI가 일반 추천 후 → "내가 있는 곳 기준으로", "거기 기준으로 다시"
 *
 * 두 경우 모두 이전 사용자 의도(예: 맛집 검색)의 tool categories를 현재 요청에 주입.
 */
function extract_history_tool_hints(
  tokens: Set<string>,
  history: Array<{ role: string; content: string }> | undefined,
): string[] | undefined {
  if (!history?.length || tokens.size > 12) return undefined;

  const last_assistant = [...history].reverse().find(h => h.role === "assistant");
  const is_info_followup = last_assistant && RE_ASSISTANT_INFO_REQUEST.test(last_assistant.content);
  const is_context_reference = RE_USER_CONTEXT_REFERENCE.test([...tokens].join(" "));

  if (!is_info_followup && !is_context_reference) return undefined;

  const categories = new Set<string>();
  for (const msg of history) {
    if (msg.role !== "user") continue;
    const intents = extract_intents(msg.content);
    for (const cat of intents_to_categories(intents)) {
      categories.add(cat);
    }
  }
  return categories.size ? [...categories] : undefined;
}

/**
 * 스킬 트리거/별칭 토큰화 결과 캐시 — 매 메시지마다 동일 문구를 재토큰화하지 않음.
 * 스킬 트리거는 런타임 중 변경되지 않으므로 영구 캐시 안전.
 */
const _phrase_token_cache = new Map<string, Set<string>>();
function tokenize_phrase(phrase: string): Set<string> {
  let cached = _phrase_token_cache.get(phrase);
  if (!cached) {
    cached = tokenize(phrase);
    _phrase_token_cache.set(phrase, cached);
  }
  return cached;
}

/**
 * 스킬 트리거/별칭과 Jaccard 유사도 비교.
 * 일치하면 스킬 이름을 반환 — 단일 호출(once)로 단락.
 */
const SKILL_TRIGGER_THRESHOLD = 0.45;

function match_skill_trigger(tokens: Set<string>, skills: SkillEntry[]): string | null {
  for (const skill of skills) {
    const candidates = [...skill.triggers, ...(skill.aliases ?? [])];
    for (const phrase of candidates) {
      const ref = tokenize_phrase(phrase);
      if (ref.size > 0 && jaccard(tokens, ref) >= SKILL_TRIGGER_THRESHOLD) return skill.name;
    }
  }
  return null;
}

// ── 복잡도 휴리스틱 ──────────────────────────────────────────────────────────

/** 토큰 수 기준 — 이 이상이면 다단계 복합 요청으로 판단. */
const AGENT_LENGTH_THRESHOLD = 50;

/**
 * once/agent/task 중 하나를 결정.
 * lower/tokens는 fast_classify에서 1회 계산하여 전달 — 재토큰화 없음.
 *
 * - `task`: 명시적 백그라운드/비동기/스케줄 신호
 * - `agent`: 다단계 동사 연결 or 도구 조합 쌍 or 문장 길이 임계치 초과
 * - `once`: 단일 질문/조회/응답 (기본값 — 불확실하면 once로 시작 후 에스컬레이션)
 *
 * 스킬 트리거 매칭 시 once 단락 — 스킬은 항상 단일 호출.
 */
function classify_execution_complexity(lower: string, tokens: Set<string>, ctx: ClassifierContext): "once" | "agent" | "task" {
  if (TASK_SIGNAL_PHRASES.some((s) => lower.includes(s))) return "task";

  // 스킬 트리거 직접 매칭 → 항상 once (LLM이 skill 호출)
  if (ctx.available_skills?.length && match_skill_trigger(tokens, ctx.available_skills)) return "once";

  // 단일 연결어: 토큰 교집합 (오매칭 방지)
  if ([...tokens].some((t) => AGENT_CONNECTOR_TOKENS.has(t))) return "agent";
  // 다단계 연결 구문: 구문 매칭
  if (AGENT_CONNECTOR_PHRASES.some((p) => lower.includes(p))) return "agent";
  // 도구 조합 쌍
  if (AGENT_TOOL_PAIRS.some(([a, b]) => lower.includes(a) && lower.includes(b))) return "agent";
  // 50토큰 이상 복잡 요청 → agent (단일 once 응답으로 처리하기엔 복잡도가 높음)
  if (tokens.size >= AGENT_LENGTH_THRESHOLD) return "agent";

  return "once";
}

// ── 공개 API ─────────────────────────────────────────────────────────────────

/**
 * 키워드 휴리스틱으로 실행 모드를 분류. 0ms, LLM 호출 없음.
 *
 * 우선순위:
 * 1. builtin  — /커맨드
 * 2. identity — 봇 정체성 질문
 * 3. inquiry  — 활성 태스크 상태 조회
 * 4. once/agent/task — 복잡도 휴리스틱 + 히스토리 기반 tool hints
 */
export function classify_execution_mode(
  task: string,
  ctx: ClassifierContext,
  _providers: unknown,
  logger: Logger,
): Promise<ClassificationResult> {
  const result = fast_classify(task, ctx);
  logger.info("classify_result", {
    mode: result.mode,
    source: "heuristic",
    task_preview: String(task || "").slice(0, 80),
    token_count: tokenize(task).size,
    active_tasks: ctx.active_tasks?.length ?? 0,
    tool_hints: "tools" in result ? result.tools : undefined,
  });
  return Promise.resolve(result);
}

/** @internal — exported for unit testing. */
export function fast_classify(task: string, ctx: ClassifierContext): ClassificationResult {
  const text = String(task || "").trim();
  if (!text) return { mode: "once" };

  // 1. builtin: /커맨드
  const builtin_match = text.match(RE_BUILTIN);
  if (builtin_match) {
    return { mode: "builtin", command: builtin_match[1], args: builtin_match[2]?.trim() || undefined };
  }

  // 나머지 판정은 동일 토큰 집합을 공유 — tokenize 1회
  const tokens = tokenize(text);
  const lower = text.toLowerCase();

  // 2. identity: 봇 소개 질문 (유사도 기반)
  if (is_identity_question(tokens)) {
    return { mode: "identity" };
  }

  // 3. inquiry: 활성 태스크 있을 때 상태 조회 or 태스크 언급 후 짧은 후속 질문
  const has_active = (ctx.active_tasks?.length ?? 0) > 0;
  if (has_active && (is_inquiry_question(tokens) || is_followup_inquiry(tokens, ctx.recent_history))) {
    return { mode: "inquiry" };
  }

  // 4. once / agent / task + 히스토리 기반 tool hints
  const mode = classify_execution_complexity(lower, tokens, ctx);

  // 짧은 후속 메시지(≤12 토큰)에서 대화 히스토리의 의도를 carry-forward.
  // (A) 어시스턴트가 추가 정보 요청 후 짧은 답변, 또는
  // (B) 사용자가 이전 제공 맥락을 참조("내가 있는 곳 기준으로" 등)하는 경우
  // 이전 사용자 의도(예: 맛집 검색)의 tool categories를 현재 요청에 주입.
  const history_tools = extract_history_tool_hints(tokens, ctx.recent_history);
  return history_tools ? { mode, tools: history_tools } : { mode };
}

// ── 이하 호환성 유지 (에스컬레이션 판별) ────────────────────────────────────

/** @internal — exported for unit testing. */
export function detect_escalation(text: string, source_mode: "once" | "agent" = "once"): string | null {
  const normalized = text.replace(/[\s_-]+/g, " ").toUpperCase().trim();
  if (normalized.includes("NEED TASK LOOP")) {
    return source_mode === "agent" ? "agent_requires_task_loop" : "once_requires_task_loop";
  }
  if (normalized.includes("NEED AGENT LOOP")) return "once_requires_agent_loop";
  return null;
}

export function is_once_escalation(error?: string | null): boolean {
  if (!error) return false;
  return error === "once_requires_task_loop" || error === "once_requires_agent_loop";
}

/** agent 모드에서 task 에스컬레이션이 필요한지 판별. */
export function is_agent_escalation(error?: string | null): boolean {
  if (!error) return false;
  return error === "agent_requires_task_loop";
}

/** @internal — exported for unit testing. */
export function parse_execution_mode(raw: string): ClassificationResult | null {
  const text = String(raw || "").trim();
  if (!text) return null;
  const RE_JSON_BLOCK = /\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/;
  const RE_MODE_WORD = /\b(?:once|task|agent|inquiry|identity|phase)\b/;
  const json_match = text.match(RE_JSON_BLOCK);
  if (json_match) {
    try {
      const obj = JSON.parse(json_match[0]) as Record<string, unknown>;
      const v = String(obj.mode || obj.route || "").trim().toLowerCase();
      if (v === "builtin") {
        const cmd = String(obj.command || "").trim();
        if (cmd) return { mode: "builtin", command: cmd, args: obj.args ? String(obj.args) : undefined };
        return null;
      }
      if (v === "inquiry") return { mode: "inquiry" };
      if (v === "identity") return { mode: "identity" };
      if (v === "phase") {
        const wid = obj.workflow_id ? String(obj.workflow_id) : undefined;
        const nodes = Array.isArray(obj.nodes)
          ? (obj.nodes as unknown[]).filter((t): t is string => typeof t === "string")
          : undefined;
        return { mode: "phase", workflow_id: wid, ...(nodes?.length ? { nodes } : {}) };
      }
      if (v === "once" || v === "task" || v === "agent") {
        const tools = Array.isArray(obj.tools)
          ? (obj.tools as unknown[]).filter((t): t is string => typeof t === "string")
          : undefined;
        return tools?.length ? { mode: v, tools } : { mode: v };
      }
    } catch { /* ignore */ }
  }
  const word = text.toLowerCase().match(RE_MODE_WORD);
  if (word) {
    if (word[0] === "phase") return { mode: "phase" };
    if (word[0] === "identity") return { mode: "identity" };
    return { mode: word[0] as "once" | "agent" | "task" | "inquiry" };
  }
  return null;
}
