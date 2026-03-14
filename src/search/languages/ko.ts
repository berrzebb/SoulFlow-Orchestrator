/** 한국어 토큰화 규칙 — 조사 탈락 + 불용어 필터. */

import type { LanguageRuleLike } from "../types.js";

const STOP_WORDS = new Set([
  "은","는","이","가","을","를","의","에","에서","로","으로","와","과",
  "도","만","까지","부터","한테","에게","께","처럼","같이","보다",
  "마다","밖에","대로",
  "나","나는","내가","나를","너","우리","저","저희","그","그녀","그들",
  "이것","저것","그것","여기","저기","거기",
  "있다","없다","하다","되다","이다","아니다","보다","주다","오다","가다",
  "것","거","등","수","때","곳","중","분",
  "잘","더","또","매우","정말","아주","많이","너무","좀",
  "그리고","하지만","그래서","그런데","그러나","또는","그러면",
  "왜","어떻게","뭐","언제","어디","누구","무엇","어떤",
  "어제","오늘","내일","최근","지금","아까","나중","전에",
  "제발","부탁",
]);

/** 한국어 조사 — 길이 내림차순 정렬 (긴 조사 우선 매칭). */
const PARTICLES = [
  "에서","으로","에게","한테","처럼","같이","보다","까지","부터","마다","밖에","대로",
  "은","는","이","가","을","를","의","에","로","와","과","도","만",
].sort((a, b) => b.length - a.length);

const RE_HANGUL = /[\uac00-\ud7af\u3131-\u3163]/;

function strip_particle(token: string): string | null {
  for (const p of PARTICLES) {
    if (token.length > p.length && token.endsWith(p)) return token.slice(0, -p.length);
  }
  return null;
}

function is_useful_stem(stem: string): boolean {
  if (RE_HANGUL.test(stem)) return stem.length >= 2;
  return /^[a-z0-9_]+$/i.test(stem);
}

export const KOREAN_RULES: LanguageRuleLike = {
  lang: "ko",

  matches_script(segment: string): boolean {
    return RE_HANGUL.test(segment);
  },

  tokenize_segment(segment: string): string[] {
    const tokens: string[] = [];
    const stem = strip_particle(segment);
    const stem_is_stop = stem !== null && STOP_WORDS.has(stem);
    if (!STOP_WORDS.has(segment) && !stem_is_stop) tokens.push(segment);
    if (stem && !STOP_WORDS.has(stem) && is_useful_stem(stem)) tokens.push(stem);
    return tokens;
  },

  is_stop_word(token: string): boolean {
    return STOP_WORDS.has(token);
  },

  is_valid_keyword(token: string): boolean {
    if (!token) return false;
    if (RE_HANGUL.test(token)) return token.length >= 2;
    if (/^\d+$/.test(token)) return false;
    return /^[a-z0-9_]+$/i.test(token);
  },
};
