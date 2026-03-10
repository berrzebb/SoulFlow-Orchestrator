/** 실행 모드 분류: 키워드 휴리스틱 기반 once/agent/task/builtin/inquiry/identity 판정. LLM 미사용. */

import type { Logger } from "../logger.js";
import type { ClassificationResult } from "./types.js";

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

const IDENTITY_TOKEN_SETS = [
  "너 누구야", "너 누구니", "너 누구세요",
  "당신 누구세요", "당신은 누구세요",
  "넌 누구야", "넌 뭐야", "너 뭐야",
  "자기소개 해줘", "자기 소개 해줘", "자기소개해줘",
  "누구", "넌 누구", "너 누구",
  "who are you", "what are you", "introduce yourself",
].map(tokenize);

const INQUIRY_TOKEN_SETS = [
  "작업 어떻게 됐어", "작업 됐어", "작업 끝났어", "작업 완료됐어",
  "태스크 상태 어때", "태스크 진행 어떻게", "백그라운드 작업 어때",
  "진행 중인 작업", "작업 진행상황",
  "what's the status", "how's the task", "task done", "task finished",
  "is it done", "task progress", "background task status",
].map(tokenize);

/** 단일 토큰 다단계 연결어 집합 — 토큰 교집합으로 "하고싶어요" 오매칭 방지. */
const AGENT_CONNECTOR_TOKENS = new Set([
  "하고", "하고서", "그다음", "그리고", "후에",
  "then",
]);

/** 다단계 연결 구문 (두 단어 이상) — 토큰 분리 불가하여 구문 매칭 유지. */
const AGENT_CONNECTOR_PHRASES = ["하고 나서", "그 다음에", "그리고 나서", "한 다음", "그 후", "and then", "after that"];

/** 명시적 비동기 실행 신호 — 구문 의미가 중요하여 구문 매칭 유지. */
const TASK_SIGNAL_PHRASES = [
  "백그라운드", "비동기", "나중에 알려", "background", "async", "schedule", "notify when done", "run in background",
];

/** 도구 조합 쌍 — 두 토큰이 모두 있으면 다단계 작업으로 판단. */
const AGENT_TOOL_PAIRS: [string, string][] = [
  ["파일", "보내"], ["읽", "요약"], ["검색", "정리"],
  ["분석", "보고"], ["가져", "저장"],
  ["file", "send"], ["read", "summar"], ["search", "send"], ["fetch", "save"],
];

// ── 유사도 판별 함수 ──────────────────────────────────────────────────────────

function is_identity_question(text: string): boolean {
  const tokens = tokenize(text);
  return tokens.size > 0 && exceeds_similarity(tokens, IDENTITY_TOKEN_SETS, IDENTITY_THRESHOLD);
}

function is_inquiry_question(text: string): boolean {
  const tokens = tokenize(text);
  return tokens.size > 0 && exceeds_similarity(tokens, INQUIRY_TOKEN_SETS, INQUIRY_THRESHOLD);
}

// ── 복잡도 휴리스틱 ──────────────────────────────────────────────────────────

/**
 * once/agent/task 중 하나를 결정.
 *
 * - `task`: 명시적 백그라운드/비동기/스케줄 신호
 * - `agent`: 다단계 동사 연결 or 도구 조합 쌍 감지
 * - `once`: 단일 질문/조회/응답 (기본값 — 불확실하면 once로 시작 후 에스컬레이션)
 */
function classify_execution_complexity(text: string, _ctx: ClassifierContext): "once" | "agent" | "task" {
  const lower = text.toLowerCase();
  const tokens = tokenize(text);

  if (TASK_SIGNAL_PHRASES.some((s) => lower.includes(s))) return "task";

  // 단일 연결어: 토큰 교집합 (오매칭 방지)
  if ([...tokens].some((t) => AGENT_CONNECTOR_TOKENS.has(t))) return "agent";
  // 다단계 연결 구문: 구문 매칭
  if (AGENT_CONNECTOR_PHRASES.some((p) => lower.includes(p))) return "agent";
  // 도구 조합 쌍
  if (AGENT_TOOL_PAIRS.some(([a, b]) => lower.includes(a) && lower.includes(b))) return "agent";

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
 * 4. once/agent/task — 복잡도 휴리스틱
 */
export function classify_execution_mode(
  task: string,
  ctx: ClassifierContext,
  _providers: unknown,
  logger: Logger,
): Promise<ClassificationResult> {
  const result = fast_classify(task, ctx);
  logger.info("classify_result", { mode: result.mode, source: "heuristic" });
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

  // 2. identity: 봇 소개 질문 (유사도 기반)
  if (is_identity_question(text)) {
    return { mode: "identity" };
  }

  // 3. inquiry: 활성 태스크 있을 때 상태 조회
  const has_active = (ctx.active_tasks?.length ?? 0) > 0;
  if (has_active && is_inquiry_question(text)) {
    return { mode: "inquiry" };
  }

  // 4. once / agent / task
  return { mode: classify_execution_complexity(text, ctx) };
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
