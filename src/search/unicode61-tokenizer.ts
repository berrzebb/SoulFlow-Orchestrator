/**
 * Unicode61 기반 기본 토크나이저 — TokenizerPolicyLike + QueryNormalizerLike 구현.
 *
 * 언어별 토큰화 규칙은 languages/ 모듈에 위임.
 * 새 언어 추가 시 languages/{lang}.ts 구현 + languages/index.ts에 등록.
 */

import type { TokenizerPolicyLike, QueryNormalizerLike } from "./types.js";
import { detect_language_rule } from "./languages/index.js";

function escape_fts_term(term: string): string {
  return `"${term.replace(/"/g, '""')}"`;
}

/**
 * 다언어 지원 기본 토크나이저.
 * 세그먼트의 스크립트를 감지하여 적절한 언어 규칙에 위임.
 */
export class Unicode61Tokenizer implements TokenizerPolicyLike, QueryNormalizerLike {
  tokenize(text: string): string[] {
    const normalized = text.toLowerCase().trim();
    const segments = normalized.split(/[\s\p{P}]+/u).filter(Boolean);
    const tokens: string[] = [];

    for (const seg of segments) {
      const rule = detect_language_rule(seg);
      tokens.push(...rule.tokenize_segment(seg));
    }
    return tokens;
  }

  is_stop_word(token: string): boolean {
    const rule = detect_language_rule(token);
    return rule.is_stop_word(token);
  }

  extract_keywords(query: string): string[] {
    const tokens = this.tokenize(query);
    const keywords: string[] = [];
    const seen = new Set<string>();

    for (const token of tokens) {
      if (this.is_stop_word(token)) continue;
      const rule = detect_language_rule(token);
      if (!rule.is_valid_keyword(token)) continue;
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
