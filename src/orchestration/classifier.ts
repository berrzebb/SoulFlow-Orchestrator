/** 실행 모드 분류: 키워드 휴리스틱 기반 once/agent/task/builtin/inquiry/identity 판정. LLM 미사용. */

import type { Logger } from "../logger.js";
import type { ClassificationResult } from "./types.js";

export type SkillEntry = { name: string; summary: string; triggers: string[] };

export type ClassifierContext = {
  active_tasks?: import("../contracts.js").TaskState[];
  recent_history?: Array<{ role: string; content: string }>;
  available_tool_categories?: string[];
  available_skills?: SkillEntry[];
};

// ── 결정론적 패턴 ────────────────────────────────────────────────────────────

/** /커맨드 인자 파싱. */
const RE_BUILTIN = /^\/(\S+)(?:\s+(.*))?$/s;

/** 봇 정체성 질문 레퍼런스 문장 — Jaccard 유사도 비교 대상. */
const IDENTITY_REFS = [
  "너 누구야", "너 누구니", "너 누구세요",
  "당신 누구세요", "당신은 누구세요",
  "넌 누구야", "넌 뭐야", "너 뭐야",
  "자기소개 해줘", "자기 소개 해줘", "자기소개해줘",
  "누구", "넌 누구", "너 누구",    // 단형 ("누구?", "넌 누구?" 커버)
  "who are you", "what are you", "introduce yourself",
];

/** 유사도 임계값: 이 값 이상이면 identity 분류. */
const IDENTITY_THRESHOLD = 0.4;

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

/** 레퍼런스 문장과의 최대 Jaccard 유사도가 임계값 이상이면 identity 질문으로 판단. */
function is_identity_question(text: string): boolean {
  const tokens = tokenize(text);
  if (tokens.size === 0) return false;
  return IDENTITY_REFS.some((ref) => jaccard(tokens, tokenize(ref)) >= IDENTITY_THRESHOLD);
}

/** 진행 중인 작업 조회 키워드 (active_tasks 존재 시에만 inquiry로 분류). */
const INQUIRY_WORDS = [
  "상태", "진행", "어떻게", "됐어", "됐나", "완료", "끝났어", "끝났나",
  "status", "progress", "done", "finished", "how is", "how's",
];

// ── 복잡도 휴리스틱 ──────────────────────────────────────────────────────────

/**
 * once/agent/task 중 하나를 결정하는 핵심 로직.
 *
 * 판단 기준:
 * - `task`: 장시간 실행 + 명시적 "백그라운드/비동기/나중에" 키워드
 * - `agent`: 여러 단계 수행 필요 + 도구 연계 필요
 * - `once`: 단일 질문/조회/응답
 *
 * 이 함수를 구현하세요 (5-10줄).
 * 힌트: 아래 상수들을 활용하거나 직접 정의하세요.
 */
function classify_execution_complexity(_text: string, _ctx: ClassifierContext): "once" | "agent" | "task" {
  // TODO: 직접 구현 — once/agent/task 구분 휴리스틱
  // 예시 접근법:
  //   task 신호: "백그라운드", "비동기", "나중에 알려줘", "background", "async", "schedule"
  //   agent 신호: 여러 동사 연결 ("하고", "그다음", "그리고 나서"), 파일 작업 + 전송 조합
  //   once: 그 외 단순 질문/대화
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

  const lower = text.toLowerCase();

  // 2. identity: 봇 소개 질문 (유사도 기반)
  if (is_identity_question(text)) {
    return { mode: "identity" };
  }

  // 3. inquiry: 활성 태스크 있을 때 상태 조회
  const has_active = (ctx.active_tasks?.length ?? 0) > 0;
  if (has_active && INQUIRY_WORDS.some((w) => lower.includes(w))) {
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
