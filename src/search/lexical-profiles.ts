/**
 * 표준 FTS5 lexical profiles — 인덱스 생성 시 tokenizer/BM25 설정 표준화.
 *
 * 모든 FTS5 테이블은 이 프로파일 중 하나를 사용하여 일관된 검색 동작을 보장.
 */

import type { LexicalProfile } from "./types.js";

/** 기본 프로파일: unicode61 + 분음부호 제거. 대부분의 FTS5 테이블에 적합. */
export const UNICODE61_PROFILE: LexicalProfile = {
  fts5_tokenize: "unicode61 remove_diacritics 2",
};

/** 도구 검색 프로파일: name 5.0, description 2.0, tags 1.0 BM25 가중치. */
export const TOOL_INDEX_PROFILE: LexicalProfile = {
  fts5_tokenize: "unicode61 remove_diacritics 2",
  bm25_weights: [5.0, 2.0, 1.0],
};

/** 메모리 청크 프로파일: 단일 content 컬럼, BM25 기본값. */
export const MEMORY_CHUNK_PROFILE: LexicalProfile = {
  fts5_tokenize: "unicode61 remove_diacritics 2",
};

/** 메모리 문서 프로파일: content만 인덱싱, kind/day/path는 UNINDEXED. */
export const MEMORY_DOCUMENT_PROFILE: LexicalProfile = {
  fts5_tokenize: "unicode61 remove_diacritics 2",
};

/**
 * LexicalProfile에서 FTS5 CREATE VIRTUAL TABLE tokenize 절을 생성.
 * @example build_fts5_tokenize_clause(UNICODE61_PROFILE) → "tokenize='unicode61 remove_diacritics 2'"
 */
export function build_fts5_tokenize_clause(profile: LexicalProfile): string {
  return `tokenize='${profile.fts5_tokenize}'`;
}

/**
 * LexicalProfile에서 bm25() 함수 호출 문자열을 생성.
 * @param fts_table FTS5 테이블명
 * @example build_bm25_call(TOOL_INDEX_PROFILE, "tools_fts") → "bm25(tools_fts, 5.0, 2.0, 1.0)"
 */
export function build_bm25_call(profile: LexicalProfile, fts_table: string): string {
  if (!profile.bm25_weights || profile.bm25_weights.length === 0) {
    return `bm25(${fts_table})`;
  }
  const weights = profile.bm25_weights.join(", ");
  return `bm25(${fts_table}, ${weights})`;
}
