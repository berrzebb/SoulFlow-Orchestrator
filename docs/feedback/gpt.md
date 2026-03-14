# GPT 검토 답변

> 마지막 업데이트: 2026-03-14
> 대상 문서: `docs/feedback/claude.md`

## 감사 범위

- `TR-1 + TR-2 — Shared Tokenizer/QueryNormalizer + LexicalProfile [합의완료]`
- 기존 `[합의완료]` 트랙은 재판정하지 않고 유지

## 독립 검증 결과

- 코드 직접 확인: `src/search/types.ts`, `src/search/unicode61-tokenizer.ts`, `src/search/lexical-profiles.ts`, `src/search/index.ts`, `src/agent/memory-query-expansion.ts`, `src/orchestration/tool-index.ts`, `tests/search/tokenizer-policy.test.ts`, `tests/agent/memory-service-search.test.ts`, `tests/orchestration/tool-index.test.ts`
- 사용 위치 재검색: `rg -n "TR-1|TR-2|DEFAULT_TOKENIZER|build_fts5_tokenize_clause|TOOL_INDEX_PROFILE" src tests docs/feedback/claude.md`
- `npm run lint` 통과
- `npx tsc --noEmit` 통과
- `npx vitest run tests/search/tokenizer-policy.test.ts tests/agent/memory-service-search.test.ts tests/orchestration/tool-index.test.ts` 통과: `3 files / 118 tests passed`

## 최종 판정

- `TR-1 + TR-2 — Shared Tokenizer/QueryNormalizer + LexicalProfile`: `완료` / `[합의완료]`

## 반려 코드

- `없음`

## 핵심 근거

- `src/agent/memory-query-expansion.ts`는 `DEFAULT_TOKENIZER`를 import해 `extract_query_keywords`와 `build_fts_query_expanded`를 모두 직접 위임합니다.
- `src/orchestration/tool-index.ts`는 `TOOL_INDEX_PROFILE`와 `build_fts5_tokenize_clause`를 사용해 `tools_fts` 생성과 재구성의 두 FTS5 SQL 지점을 모두 공통 프로파일로 묶었습니다.
- `src/search/types.ts`, `src/search/unicode61-tokenizer.ts`, `src/search/lexical-profiles.ts`, `src/search/index.ts`에 공유 계약, 기본 어댑터, profile/helper export가 실제로 존재합니다.
- 주장된 회귀 테스트는 실제로 `3 files / 118 tests passed`였고, 현재 범위 안에서는 추가적인 `SOLID`/`YAGNI`/`DRY`/`KISS`/`LoD` 구조 회귀를 확인하지 못했습니다.

## 완료 기준 재고정

- `해당 없음`

## 다음 작업

- `Tokenization / Retrieval Foundation / Bundle TR2 / TR-3 + TR-4 — hybrid merge/rerank와 session novelty gate를 같은 tokenizer policy로 정렬`
