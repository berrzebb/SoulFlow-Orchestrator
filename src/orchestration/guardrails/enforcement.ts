/**
 * EG-3 / EG-4: Enforcement Layer.
 *
 * - session evidence 구축 (session_history → SessionEvidenceSnapshot)
 * - reuse decision → 사용자 응답 포맷
 * - run-wide budget tracker (mutable counter)
 */

import type { SessionEvidenceSnapshot, SearchReuseDecision } from "./session-reuse.js";
import { normalize_query } from "./session-reuse.js";
import { STOP_REASON_BUDGET_EXCEEDED } from "./budget-policy.js";

// ── Session Evidence ──

/** 세션 히스토리 항목 (타임스탬프 선택 포함). */
type HistoryEntry = { role: string; content: string; timestamp_ms?: number };

/**
 * session_history (role/content 배열) → SessionEvidenceSnapshot 변환.
 *
 * - user 메시지만 질의 후보로 추출
 * - 실패 응답(빈 content, 응답 없음)은 failed_queries로 분류
 * - timestamp_ms가 있으면 실제 타임스탬프 사용, 없으면 합성 타임스탬프
 * - 현재 incoming 질의(마지막 user 메시지)는 제외 — 자기 자신과 비교 방지
 */
export function build_session_evidence(
  session_history: ReadonlyArray<HistoryEntry>,
  now_ms: number,
  freshness_window_ms: number,
): SessionEvidenceSnapshot {
  const user_indices: number[] = [];
  for (let i = 0; i < session_history.length; i++) {
    if (session_history[i].role === "user") user_indices.push(i);
  }
  // 마지막 user 메시지는 현재 질의 → 제외
  const past_indices = user_indices.slice(0, -1);
  if (past_indices.length === 0) return { recent_queries: [], failed_queries: [] };

  const window = Math.max(freshness_window_ms, 1);
  const step = past_indices.length > 1 ? window / past_indices.length : 0;

  const succeeded: SessionEvidenceSnapshot["recent_queries"][number][] = [];
  const failed: NonNullable<SessionEvidenceSnapshot["failed_queries"]>[number][] = [];

  for (let pi = 0; pi < past_indices.length; pi++) {
    const idx = past_indices[pi];
    const msg = session_history[idx];
    const ts = msg.timestamp_ms ?? (now_ms - window + (pi * step));

    // 다음 assistant 응답 탐색
    const response_ok = has_successful_response(session_history, idx);

    if (response_ok) {
      succeeded.push({
        normalized: normalize_query(msg.content),
        original: msg.content,
        timestamp_ms: ts,
        had_tool_calls: false,
      });
    } else {
      failed.push({
        normalized: normalize_query(msg.content),
        original: msg.content,
        timestamp_ms: ts,
      });
    }
  }

  return { recent_queries: succeeded, failed_queries: failed };
}

/** user 메시지 다음에 비어있지 않은 assistant 응답이 있는지 판별. */
function has_successful_response(
  history: ReadonlyArray<HistoryEntry>,
  user_idx: number,
): boolean {
  for (let j = user_idx + 1; j < history.length; j++) {
    if (history[j].role === "user") return false;
    if (history[j].role === "assistant") {
      return !!history[j].content.trim();
    }
  }
  return false;
}

// ── Reuse Reply ──

/** reuse/same_topic decision → 사용자 응답 텍스트. */
export function format_reuse_reply(decision: SearchReuseDecision): string {
  if (decision.kind === "reuse_summary") {
    return `이 질문은 최근에 이미 처리한 내용과 동일합니다. 이전 답변을 참고해주세요.\n\n_(동일 질의 감지: "${decision.matched_query}")_`;
  }
  if (decision.kind === "same_topic") {
    return `이 질문은 최근 탐색한 주제와 매우 유사합니다. 이전 답변을 먼저 확인해주세요.\n\n_(유사 질의 감지: "${decision.matched_query}")_`;
  }
  return "";
}

// ── Budget Tracker ──

/** run 전체 tool call budget — mutable counter. handler에 전달하여 공유. */
export type BudgetTracker = {
  readonly max: number;
  used: number;
};

export function create_budget_tracker(max_tool_calls_per_run: number): BudgetTracker {
  return { max: max_tool_calls_per_run, used: 0 };
}

export function is_over_budget(tracker: BudgetTracker): boolean {
  return tracker.max > 0 && tracker.used >= tracker.max;
}

export function remaining_budget(tracker: BudgetTracker): number {
  return tracker.max <= 0 ? Infinity : Math.max(0, tracker.max - tracker.used);
}

export { STOP_REASON_BUDGET_EXCEEDED };
