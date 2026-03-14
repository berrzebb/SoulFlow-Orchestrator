/** 중국어 토큰화 규칙 — 유니그램 + 바이그램 분할. */

import type { LanguageRuleLike } from "../types.js";

const RE_CJK = /[\u4e00-\u9fff]/;

export const CHINESE_RULES: LanguageRuleLike = {
  lang: "zh",

  matches_script(segment: string): boolean {
    return RE_CJK.test(segment);
  },

  tokenize_segment(segment: string): string[] {
    const chars = Array.from(segment).filter((c) => RE_CJK.test(c));
    const tokens = [...chars];
    for (let i = 0; i < chars.length - 1; i++) tokens.push(chars[i] + chars[i + 1]);
    return tokens;
  },

  is_stop_word(_token: string): boolean {
    return false;
  },

  is_valid_keyword(token: string): boolean {
    return !!token && RE_CJK.test(token);
  },
};
