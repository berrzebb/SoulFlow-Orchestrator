/** 내장 EvalScorer 구현. */

import type { EvalScorerLike } from "./contracts.js";

/** 정확 일치 (대소문자 무시, 앞뒤 공백 제거). */
export const EXACT_MATCH_SCORER: EvalScorerLike = {
  score(_input, expected, actual) {
    if (expected === undefined) return { passed: true, score: 1 };
    const match = actual.trim().toLowerCase() === expected.trim().toLowerCase();
    return { passed: match, score: match ? 1 : 0 };
  },
};

/** 부분 문자열 포함 여부 (대소문자 무시). */
export const CONTAINS_SCORER: EvalScorerLike = {
  score(_input, expected, actual) {
    if (expected === undefined) return { passed: true, score: 1 };
    const match = actual.toLowerCase().includes(expected.toLowerCase());
    return { passed: match, score: match ? 1 : 0 };
  },
};

/** 정규식 매치. expected를 regex 패턴으로 해석. */
export const REGEX_SCORER: EvalScorerLike = {
  score(_input, expected, actual) {
    if (expected === undefined) return { passed: true, score: 1 };
    try {
      const match = new RegExp(expected, "i").test(actual);
      return { passed: match, score: match ? 1 : 0 };
    } catch {
      return { passed: false, score: 0 };
    }
  },
};
