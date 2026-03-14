/** 영어 토큰화 규칙. */

import type { LanguageRuleLike } from "../types.js";

const STOP_WORDS = new Set([
  "a","an","the","this","that","these","those",
  "i","me","my","we","our","you","your","he","she","it","they","them",
  "is","are","was","were","be","been","being","have","has","had",
  "do","does","did","will","would","could","should","can","may","might",
  "in","on","at","to","for","of","with","by","from","about","into",
  "through","during","before","after","above","below","between","under","over",
  "and","or","but","if","then","because","as","while","when","where",
  "what","which","who","how","why","please","help","find","show","get","tell","give",
  "yesterday","today","tomorrow","earlier","later","recently","just","now",
  "thing","things","stuff","something","anything","everything","nothing",
]);

export const ENGLISH_RULES: LanguageRuleLike = {
  lang: "en",

  matches_script(_segment: string): boolean {
    return true; // fallback — 다른 규칙에 매칭되지 않은 모든 세그먼트
  },

  tokenize_segment(segment: string): string[] {
    return [segment];
  },

  is_stop_word(token: string): boolean {
    return STOP_WORDS.has(token);
  },

  is_valid_keyword(token: string): boolean {
    if (!token) return false;
    if (/^[a-zA-Z]+$/.test(token) && token.length < 3) return false;
    if (/^\d+$/.test(token)) return false;
    if (/^[\p{P}\p{S}]+$/u.test(token)) return false;
    return true;
  },
};
