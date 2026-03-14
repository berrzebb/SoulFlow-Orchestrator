/**
 * Unicode61 기반 기본 토크나이저 — TokenizerPolicyLike + QueryNormalizerLike 구현.
 *
 * 기존 memory-query-expansion.ts의 다언어 토크나이저 로직을 공유 계약으로 래핑.
 * 한국어 조사 탈락, CJK 바이그램, EN/KO 불용어 처리를 포함.
 */

import type { TokenizerPolicyLike, QueryNormalizerLike } from "./types.js";

// ── 불용어 사전 ──────────────────────────────────────────────────────────────

const STOP_EN = new Set([
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

const STOP_KO = new Set([
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

// ── 한국어 조사 탈락 ────────────────────────────────────────────────────────

const KO_PARTICLES = [
  "에서","으로","에게","한테","처럼","같이","보다","까지","부터","마다","밖에","대로",
  "은","는","이","가","을","를","의","에","로","와","과","도","만",
].sort((a, b) => b.length - a.length);

function strip_ko_particle(token: string): string | null {
  for (const p of KO_PARTICLES) {
    if (token.length > p.length && token.endsWith(p)) return token.slice(0, -p.length);
  }
  return null;
}

function is_useful_ko_stem(stem: string): boolean {
  if (/[\uac00-\ud7af]/.test(stem)) return stem.length >= 2;
  return /^[a-z0-9_]+$/i.test(stem);
}

// ── 유효 키워드 판별 ────────────────────────────────────────────────────────

function is_valid_keyword(token: string): boolean {
  if (!token || token.length === 0) return false;
  if (/^[a-zA-Z]+$/.test(token) && token.length < 3) return false;
  if (/^\d+$/.test(token)) return false;
  if (/^[\p{P}\p{S}]+$/u.test(token)) return false;
  return true;
}

// ── FTS5 이스케이프 ─────────────────────────────────────────────────────────

function escape_fts_term(term: string): string {
  return `"${term.replace(/"/g, '""')}"`;
}

// ── Unicode61Tokenizer ──────────────────────────────────────────────────────

/**
 * 다언어 지원 기본 토크나이저.
 *
 * - 영어: 공백/구두점 분할 + 소문자 정규화
 * - 한국어: 조사 탈락 + 유효 형태소 필터
 * - 중국어: 유니그램 + 바이그램 분리
 */
export class Unicode61Tokenizer implements TokenizerPolicyLike, QueryNormalizerLike {
  tokenize(text: string): string[] {
    const tokens: string[] = [];
    const normalized = text.toLowerCase().trim();
    const segments = normalized.split(/[\s\p{P}]+/u).filter(Boolean);

    for (const seg of segments) {
      if (/[\uac00-\ud7af\u3131-\u3163]/.test(seg)) {
        const stem = strip_ko_particle(seg);
        const stem_is_stop = stem !== null && STOP_KO.has(stem);
        if (!STOP_KO.has(seg) && !stem_is_stop) tokens.push(seg);
        if (stem && !STOP_KO.has(stem) && is_useful_ko_stem(stem)) tokens.push(stem);
      } else if (/[\u4e00-\u9fff]/.test(seg)) {
        const chars = Array.from(seg).filter((c) => /[\u4e00-\u9fff]/.test(c));
        tokens.push(...chars);
        for (let i = 0; i < chars.length - 1; i++) tokens.push(chars[i] + chars[i + 1]);
      } else {
        tokens.push(seg);
      }
    }
    return tokens;
  }

  is_stop_word(token: string): boolean {
    return STOP_EN.has(token) || STOP_KO.has(token);
  }

  extract_keywords(query: string): string[] {
    const tokens = this.tokenize(query);
    const keywords: string[] = [];
    const seen = new Set<string>();

    for (const token of tokens) {
      if (this.is_stop_word(token)) continue;
      if (!is_valid_keyword(token)) continue;
      if (seen.has(token)) continue;
      seen.add(token);
      keywords.push(token);
    }
    return keywords;
  }

  build_fts_query(query: string): string {
    const keywords = this.extract_keywords(query);
    if (keywords.length > 0) {
      return keywords.map(escape_fts_term).join(" OR ");
    }
    const terms = String(query || "").split(/\s+/).map((v) => v.trim()).filter(Boolean);
    if (terms.length === 0) return "";
    return terms.map(escape_fts_term).join(" ");
  }
}

/** 공유 싱글턴 인스턴스 — 상태 없는 토크나이저이므로 안전. */
export const DEFAULT_TOKENIZER = new Unicode61Tokenizer();
