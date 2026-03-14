/**
 * 검색 도메인 공유 계약 — TokenizerPolicy, QueryNormalizer, LexicalProfile.
 *
 * 소비자: memory-query-expansion, tool-index, reference-store 등.
 * 어댑터: Unicode61Tokenizer (default), ICU/커스텀 (optional).
 */

// ── TR-1: TokenizerPolicy ───────────────────────────────────────────────────

/** 텍스트를 검색 가능한 토큰으로 분할하는 계약. */
export interface TokenizerPolicyLike {
  /** 텍스트를 소문자 토큰 배열로 분할. 구현체가 언어별 처리(조사 탈락, CJK 바이그램 등)를 결정. */
  tokenize(text: string): string[];
  /** 주어진 토큰이 불용어인지 판별. */
  is_stop_word(token: string): boolean;
}

// ── TR-1: QueryNormalizer ───────────────────────────────────────────────────

/** 검색 쿼리를 정규화하여 FTS5 MATCH 쿼리를 생성하는 계약. */
export interface QueryNormalizerLike {
  /** 쿼리에서 의미 있는 키워드를 추출 (불용어 제거, 유효성 필터). */
  extract_keywords(query: string): string[];
  /** FTS5 MATCH 쿼리 문자열 생성 (e.g. `"keyword1" OR "keyword2"`). */
  build_fts_query(query: string): string;
}

// ── TR-2: LexicalProfile ────────────────────────────────────────────────────

/** FTS5 인덱스 설정 프로파일. 테이블 생성 시 tokenizer 절 + BM25 가중치를 표준화. */
export interface LexicalProfile {
  /** FTS5 tokenize 절 문자열 (e.g. `"unicode61 remove_diacritics 2"`). */
  readonly fts5_tokenize: string;
  /** BM25 가중치 배열. 컬럼 순서에 대응. 미지정 시 FTS5 기본값(1.0). */
  readonly bm25_weights?: readonly number[];
}

// ── LanguageRuleLike ─────────────────────────────────────────────────────

/**
 * 언어별 토큰화 규칙 계약.
 * 새 언어 추가 시 이 인터페이스를 구현하고 languages/index.ts에 등록.
 */
export interface LanguageRuleLike {
  /** BCP 47 언어 코드. */
  readonly lang: string;
  /** 세그먼트가 이 언어의 스크립트에 속하는지 판별. */
  matches_script(segment: string): boolean;
  /**
   * 텍스트 세그먼트를 토큰으로 분해.
   * 언어별 특수 처리(조사 탈락, 바이그램 등) 및 불용어 필터링 포함.
   */
  tokenize_segment(segment: string): string[];
  /** 토큰이 불용어인지 판별. */
  is_stop_word(token: string): boolean;
  /** 토큰이 유효한 키워드인지 판별. */
  is_valid_keyword(token: string): boolean;
}

// ── TR-2: TokenizerAdapterLike ──────────────────────────────────────────────

/**
 * 커스텀 토크나이저 어댑터 계약 (ICU, MeCab, jieba 등).
 *
 * TokenizerPolicyLike를 확장하여 언어 감지 + 어댑터 식별을 추가.
 * 기본 구현(Unicode61Tokenizer)은 이 인터페이스를 implements하지 않아도 됨 —
 * ICU/커스텀 어댑터를 플러그인할 때만 사용.
 */
export interface TokenizerAdapterLike extends TokenizerPolicyLike {
  /** 어댑터 이름 (e.g. "icu", "mecab", "jieba"). */
  readonly adapter_name: string;
  /** 지원 언어 코드 목록 (e.g. ["ko", "ja", "zh"]). */
  readonly supported_languages: readonly string[];
  /** 텍스트의 주요 언어를 감지. 감지 불가 시 null. */
  detect_language(text: string): string | null;
}
