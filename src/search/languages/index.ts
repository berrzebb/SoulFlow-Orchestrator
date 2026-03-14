/** 언어 규칙 레지스트리 — 스크립트 감지 후 적절한 규칙 반환. */

import type { LanguageRuleLike } from "../types.js";
import { ENGLISH_RULES } from "./en.js";
import { KOREAN_RULES } from "./ko.js";
import { CHINESE_RULES } from "./zh.js";

export { ENGLISH_RULES, KOREAN_RULES, CHINESE_RULES };

/** 등록된 언어 규칙. 순서대로 script 매칭, ENGLISH_RULES는 fallback. */
const SCRIPT_RULES: readonly LanguageRuleLike[] = [
  KOREAN_RULES,
  CHINESE_RULES,
];

/** 세그먼트의 스크립트에 맞는 언어 규칙 반환. 매칭 없으면 영어(fallback). */
export function detect_language_rule(segment: string): LanguageRuleLike {
  for (const rule of SCRIPT_RULES) {
    if (rule.matches_script(segment)) return rule;
  }
  return ENGLISH_RULES;
}
