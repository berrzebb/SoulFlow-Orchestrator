/**
 * EG-1: Session Reuse / Novelty Policy.
 *
 * 세션 기록을 바탕으로 재탐색이 필요한지 판단하는 계약.
 * - 같은 질문 → reuse_summary
 * - 유사 질문 (동의어/near-duplicate) → same_topic
 * - freshness window 초과 → stale_retry
 * - 새로운 탐색 → new_search
 */

/** 세션에서 추출한 최근 탐색 근거. */
export interface SessionEvidenceSnapshot {
  /** 최근 탐색 질의 목록 (정규화된 형태). */
  recent_queries: ReadonlyArray<{
    /** 정규화된 질의 텍스트. */
    normalized: string;
    /** 원본 질의 텍스트. */
    original: string;
    /** 질의 시각 (epoch ms). */
    timestamp_ms: number;
    /** 도구 호출이 수반됐는지 여부. */
    had_tool_calls: boolean;
  }>;
}

/** 재사용 판단 결과. */
export type SearchReuseDecision =
  | { kind: "reuse_summary"; matched_query: string; age_ms: number }
  | { kind: "same_topic"; matched_query: string; age_ms: number }
  | { kind: "stale_retry"; matched_query: string; age_ms: number }
  | { kind: "new_search" };

/** 재사용 판단 옵션. */
export interface ReuseEvaluationOptions {
  /** freshness window (ms). 이 기간 내 탐색은 "신선"으로 간주. 0 = 비활성. */
  freshness_window_ms: number;
  /** 유사도 임계값 (0.0–1.0). 이 이상이면 same_topic으로 판단. */
  similarity_threshold: number;
}

/** 기본 옵션. */
export const DEFAULT_REUSE_OPTIONS: ReuseEvaluationOptions = {
  freshness_window_ms: 300_000, // 5분
  similarity_threshold: 0.85,
};

/**
 * 질의 정규화: 소문자 변환, 공백 정리, 구두점 제거.
 * 동의어/near-duplicate 비교의 전처리 단계.
 */
export function normalize_query(query: string): string {
  return query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 두 정규화된 질의 간 유사도 계산 (Jaccard coefficient).
 * 단어 집합 기반 — 간단하지만 동의어/어순 변경에 효과적.
 */
export function compute_similarity(a: string, b: string): number {
  if (a === b) return 1.0;
  const set_a = new Set(a.split(" ").filter(Boolean));
  const set_b = new Set(b.split(" ").filter(Boolean));
  if (set_a.size === 0 && set_b.size === 0) return 1.0;
  if (set_a.size === 0 || set_b.size === 0) return 0.0;

  let intersection = 0;
  for (const w of set_a) {
    if (set_b.has(w)) intersection++;
  }
  const union = set_a.size + set_b.size - intersection;
  return union === 0 ? 0.0 : intersection / union;
}

/**
 * 세션 근거를 바탕으로 재사용 판단.
 *
 * 판단 순서:
 * 1. 정확히 같은 질의 + fresh → reuse_summary
 * 2. 유사 질의 + fresh → same_topic
 * 3. 같은/유사 질의 + stale → stale_retry
 * 4. 매칭 없음 → new_search
 */
export function evaluate_reuse(
  incoming_query: string,
  evidence: SessionEvidenceSnapshot,
  now_ms: number,
  options: ReuseEvaluationOptions = DEFAULT_REUSE_OPTIONS,
): SearchReuseDecision {
  const normalized = normalize_query(incoming_query);
  if (!normalized) return { kind: "new_search" };

  const { freshness_window_ms, similarity_threshold } = options;
  const disabled = freshness_window_ms <= 0;

  let best_match: { normalized: string; age_ms: number; similarity: number } | null = null;

  for (const entry of evidence.recent_queries) {
    const sim = compute_similarity(normalized, entry.normalized);
    if (sim < similarity_threshold) continue;

    const age_ms = now_ms - entry.timestamp_ms;
    if (!best_match || sim > best_match.similarity || (sim === best_match.similarity && age_ms < best_match.age_ms)) {
      best_match = { normalized: entry.normalized, age_ms, similarity: sim };
    }
  }

  if (!best_match) return { kind: "new_search" };

  const is_fresh = !disabled && best_match.age_ms <= freshness_window_ms;
  const is_exact = best_match.similarity >= 0.999;

  if (is_exact && is_fresh) {
    return { kind: "reuse_summary", matched_query: best_match.normalized, age_ms: best_match.age_ms };
  }
  if (is_fresh) {
    return { kind: "same_topic", matched_query: best_match.normalized, age_ms: best_match.age_ms };
  }
  return { kind: "stale_retry", matched_query: best_match.normalized, age_ms: best_match.age_ms };
}

/** 빈 evidence snapshot. */
export const EMPTY_EVIDENCE: SessionEvidenceSnapshot = { recent_queries: [] };
