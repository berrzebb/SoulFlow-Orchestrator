/**
 * F2: Acceptance Rubric — eval scorecard 기반 pass/warn/fail 판정.
 *
 * Scorecard의 각 dimension에 임계값을 적용하여 명시적 합격 기준을 고정.
 * "예외 없이 통과"를 품질 신호로 취급하지 않는다.
 */

import type { Scorecard } from "../evals/judges.js";

export type RubricVerdict = "pass" | "warn" | "fail";

/** 단일 차원의 pass/warn 임계값. warn_at ≤ score < pass_at → warn, score < warn_at → fail. */
export interface DimensionThreshold {
  /** 이 값 이상 → pass */
  pass_at: number;
  /** 이 값 이상 → warn (미만 → fail) */
  warn_at: number;
}

/** 차원별 임계값 집합 + fallback. */
export interface AcceptanceRubric {
  /** 차원명 → 임계값. 미지정 차원은 default_threshold 사용. */
  dimensions: Partial<Record<string, DimensionThreshold>>;
  default_threshold: DimensionThreshold;
}

export interface DimensionVerdict {
  dimension: string;
  score: number;
  verdict: RubricVerdict;
}

export interface RubricResult {
  case_id: string;
  /** 모든 dimension 중 가장 나쁜 verdict (fail > warn > pass). */
  overall_verdict: RubricVerdict;
  dimensions: DimensionVerdict[];
}

/** 합리적인 기본 임계값: 0.8 이상 pass, 0.5 이상 warn, 미만 fail. */
export const DEFAULT_RUBRIC: AcceptanceRubric = {
  dimensions: {},
  default_threshold: { pass_at: 0.8, warn_at: 0.5 },
};

/** Scorecard + AcceptanceRubric → RubricResult. */
export function apply_rubric(scorecard: Scorecard, rubric: AcceptanceRubric): RubricResult {
  const dim_verdicts: DimensionVerdict[] = scorecard.entries.map((entry) => {
    const threshold = rubric.dimensions[entry.dimension] ?? rubric.default_threshold;
    return {
      dimension: entry.dimension,
      score: entry.score,
      verdict: verdict_for(entry.score, threshold),
    };
  });

  const overall_verdict = worst_verdict(dim_verdicts.map((d) => d.verdict));

  return { case_id: scorecard.case_id, overall_verdict, dimensions: dim_verdicts };
}

function verdict_for(score: number, threshold: DimensionThreshold): RubricVerdict {
  if (score >= threshold.pass_at) return "pass";
  if (score >= threshold.warn_at) return "warn";
  return "fail";
}

const VERDICT_RANK: Record<RubricVerdict, number> = { fail: 2, warn: 1, pass: 0 };
const RANK_TO_VERDICT: RubricVerdict[] = ["pass", "warn", "fail"];

function worst_verdict(verdicts: RubricVerdict[]): RubricVerdict {
  if (verdicts.length === 0) return "pass";
  const max_rank = verdicts.reduce((acc, v) => Math.max(acc, VERDICT_RANK[v]), 0);
  return RANK_TO_VERDICT[max_rank];
}
