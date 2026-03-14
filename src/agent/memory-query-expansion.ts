/**
 * FTS 쿼리 확장 — 불용어 제거 + 한국어 조사 탈락 + CJK 바이그램.
 * 임베딩 불가 환경의 FTS-only 검색, 또는 하이브리드 FTS 경로에서 사용.
 *
 * 구현은 src/search/unicode61-tokenizer.ts의 DEFAULT_TOKENIZER로 위임.
 */

import { DEFAULT_TOKENIZER } from "../search/index.js";

/** 쿼리에서 의미 있는 키워드를 추출. FTS 조건에 쓸 용도. */
export function extract_query_keywords(query: string): string[] {
  return DEFAULT_TOKENIZER.extract_keywords(query);
}

/**
 * FTS5 MATCH 쿼리 생성.
 * 키워드 추출 성공 시 OR 결합 → 더 넓은 매칭.
 * 모두 불용어인 경우 원문 AND 쿼리로 폴백.
 */
export function build_fts_query_expanded(query: string): string {
  return DEFAULT_TOKENIZER.build_fts_query(query);
}
