/**
 * EV-3: Judge / Scorer Split.
 *
 * 다차원 채점 — route/schema/content 각각 독립 평가.
 * deterministic judge만 구현, LLM judge는 optional port로 남김.
 */

import type { EvalCase } from "./contracts.js";

/* ── Scorecard ──────────────────────────────── */

export interface ScorecardEntry {
  /** 평가 차원 (route, schema, content 등). */
  dimension: string;
  passed: boolean;
  /** 0~1 범위 점수. */
  score: number;
  /** 판정 근거. */
  detail?: string;
}

export interface Scorecard {
  case_id: string;
  entries: ScorecardEntry[];
  overall_passed: boolean;
  /** 전체 entries 평균 점수. */
  overall_score: number;
}

/* ── Judge 인터페이스 ──────────────────────────── */

/** 단일 케이스 → 다차원 Scorecard 생성. */
export interface EvalJudgeLike {
  judge(eval_case: EvalCase, actual: string): Scorecard;
}

/* ── Deterministic Judges ─────────────────────── */

/** route 필드 일치 여부 (metadata.expected_route vs metadata.actual_route). */
export class RouteMatchJudge implements EvalJudgeLike {
  judge(eval_case: EvalCase, _actual: string): Scorecard {
    const expected_route = eval_case.metadata?.expected_route as string | undefined;
    const actual_route = eval_case.metadata?.actual_route as string | undefined;

    if (!expected_route) {
      return make_scorecard(eval_case.id, [{ dimension: "route", passed: true, score: 1, detail: "no expected_route defined" }]);
    }

    const match = expected_route === actual_route;
    return make_scorecard(eval_case.id, [{
      dimension: "route",
      passed: match,
      score: match ? 1 : 0,
      detail: match ? `route matched: ${expected_route}` : `expected ${expected_route}, got ${actual_route ?? "none"}`,
    }]);
  }
}

/** JSON 출력의 필수 키 존재 여부 (metadata.expected_keys). */
export class SchemaMatchJudge implements EvalJudgeLike {
  judge(eval_case: EvalCase, actual: string): Scorecard {
    const expected_keys = eval_case.metadata?.expected_keys as string[] | undefined;

    if (!expected_keys?.length) {
      return make_scorecard(eval_case.id, [{ dimension: "schema", passed: true, score: 1, detail: "no schema keys defined" }]);
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(actual) as Record<string, unknown>;
    } catch {
      return make_scorecard(eval_case.id, [{ dimension: "schema", passed: false, score: 0, detail: "output is not valid JSON" }]);
    }

    const present = expected_keys.filter((k) => k in parsed);
    const score = present.length / expected_keys.length;
    const missing = expected_keys.filter((k) => !(k in parsed));
    return make_scorecard(eval_case.id, [{
      dimension: "schema",
      passed: missing.length === 0,
      score,
      detail: missing.length === 0 ? "all keys present" : `missing keys: ${missing.join(", ")}`,
    }]);
  }
}

/** 키워드 규칙: required 키워드 포함 + forbidden 키워드 미포함. */
export class KeywordRuleJudge implements EvalJudgeLike {
  private readonly required: string[];
  private readonly forbidden: string[];

  constructor(opts: { required?: string[]; forbidden?: string[] }) {
    this.required = opts.required ?? [];
    this.forbidden = opts.forbidden ?? [];
  }

  judge(eval_case: EvalCase, actual: string): Scorecard {
    const lower = actual.toLowerCase();
    const entries: ScorecardEntry[] = [];

    if (this.required.length > 0) {
      const found = this.required.filter((kw) => lower.includes(kw.toLowerCase()));
      const score = found.length / this.required.length;
      const missing = this.required.filter((kw) => !lower.includes(kw.toLowerCase()));
      entries.push({
        dimension: "keyword_required",
        passed: missing.length === 0,
        score,
        detail: missing.length === 0 ? "all required keywords found" : `missing: ${missing.join(", ")}`,
      });
    }

    if (this.forbidden.length > 0) {
      const found = this.forbidden.filter((kw) => lower.includes(kw.toLowerCase()));
      entries.push({
        dimension: "keyword_forbidden",
        passed: found.length === 0,
        score: found.length === 0 ? 1 : 0,
        detail: found.length === 0 ? "no forbidden keywords" : `found forbidden: ${found.join(", ")}`,
      });
    }

    if (entries.length === 0) {
      entries.push({ dimension: "keyword", passed: true, score: 1, detail: "no keyword rules defined" });
    }

    return make_scorecard(eval_case.id, entries);
  }
}

/** 여러 judge를 합성 → 하나의 Scorecard. */
export class CompositeJudge implements EvalJudgeLike {
  private readonly judges: EvalJudgeLike[];

  constructor(judges: EvalJudgeLike[]) {
    this.judges = judges;
  }

  judge(eval_case: EvalCase, actual: string): Scorecard {
    const entries: ScorecardEntry[] = [];
    for (const j of this.judges) {
      const sc = j.judge(eval_case, actual);
      entries.push(...sc.entries);
    }
    return make_scorecard(eval_case.id, entries);
  }
}

/** optional LLM judge port — 구현체는 외부에서 DI. */
export interface LlmJudgePort {
  evaluate(input: string, expected: string | undefined, actual: string, rubric?: string): Promise<{ score: number; reasoning: string }>;
}

/* ── helpers ───────────────────────────────── */

function make_scorecard(case_id: string, entries: ScorecardEntry[]): Scorecard {
  const overall_passed = entries.every((e) => e.passed);
  const overall_score = entries.length > 0
    ? entries.reduce((sum, e) => sum + e.score, 0) / entries.length
    : 1;
  return { case_id, entries, overall_passed, overall_score };
}
