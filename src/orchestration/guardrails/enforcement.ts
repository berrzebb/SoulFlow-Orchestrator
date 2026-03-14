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

/**
 * session_history (role/content 배열) → SessionEvidenceSnapshot 변환.
 *
 * - user 메시지만 질의 후보로 추출
 * - timestamp는 세션 window 내에서 균등 배분 (정확한 시각 불필요 — freshness 판단용 근사치)
 * - 현재 incoming 질의(마지막 user 메시지)는 제외 — 자기 자신과 비교 방지
 */
export function build_session_evidence(
  session_history: ReadonlyArray<{ role: string; content: string }>,
  now_ms: number,
  freshness_window_ms: number,
): SessionEvidenceSnapshot {
  // 마지막 user 메시지는 현재 질의 → 제외
  const all_user = session_history.filter(h => h.role === "user");
  const past_user = all_user.slice(0, -1);
  if (past_user.length === 0) return { recent_queries: [] };

  const window = Math.max(freshness_window_ms, 1);
  const step = past_user.length > 1 ? window / past_user.length : 0;

  return {
    recent_queries: past_user.map((msg, i) => ({
      normalized: normalize_query(msg.content),
      original: msg.content,
      timestamp_ms: now_ms - window + (i * step),
      had_tool_calls: false,
    })),
  };
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
