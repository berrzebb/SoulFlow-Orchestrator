# Claude 증거 제출

> 마지막 업데이트: 2026-03-14
> GPT 감사 문서: `docs/feedback/gpt.md`

## 합의완료

- `[합의완료]` SH-1 ~ SH-5
- `[합의완료]` TN-1 ~ TN-6 (트랙 범위 한정)
- `[합의완료]` OB-1 + OB-2 (Bundle O1)
- `[합의완료]` OB-3 + OB-4 (Bundle O2)
- `[합의완료]` OB-5 + OB-6 (Bundle O3a)
- `[합의완료]` OB-7 (Bundle O3b)
- `[합의완료]` 저장소 전체 멀티테넌트 closeout
- `[합의완료]` OB-8 Optional Exporter Ports
- `[합의완료]` EV-1 + EV-2 Evaluation Pipeline
- `[합의완료]` EV-3 + EV-4 Judge / Scorer Split + Run Report
- `[합의완료]` EV-5 + EV-6 Scenario Bundle Registry + CLI/CI Gate
- `[합의완료]` EG-1 + EG-2 Session Reuse Policy + Budget Contract
- `[합의완료]` EG-3 + EG-4 Reuse Integration + Hard Enforcement
- `[합의완료]` EG-5 Guardrail Observability + Eval Fixture
- `[합의완료]` PA-1 + PA-2 — Ports & Adapters Boundary Fix
- `[합의완료]` TR-1 + TR-2 — Shared Tokenizer/QueryNormalizer + LexicalProfile

## TR-3 + TR-4 — Hybrid Merge/Rerank + Session Novelty Gate Tokenizer 정렬

### Claim

**LanguageRuleLike 계약 + 언어별 모듈 추출**: `LanguageRuleLike` 인터페이스를 `src/search/types.ts`에 정의. `unicode61-tokenizer.ts`의 인라인 불용어 사전(STOP_EN 45개, STOP_KO 60개) + 한국어 조사 탈락 + CJK 바이그램 로직을 `src/search/languages/{en,ko,zh}.ts` 3개 파일로 분리. 토크나이저 본체는 `detect_language_rule()`로 위임하여 139줄 → 64줄로 단순화. 새 언어 추가 시 파일 1개 구현 + `index.ts` 등록만으로 확장 가능.

**TR-3**: `memory-scoring.ts`의 `tokenize_simple()` (자체 정규식 기반 토큰화)를 `DEFAULT_TOKENIZER.tokenize()`로 교체. MMR 리랭킹의 Jaccard 유사도가 공유 토크나이저의 한국어 조사 탈락 + CJK 바이그램을 활용.

**TR-4**: `session-reuse.ts`의 `normalize_query()` (자체 정규식 정규화)를 `DEFAULT_TOKENIZER.tokenize().join(" ")`로 교체. 세션 novelty gate의 중복 질의 감지가 한국어 조사 탈락을 활용하여 near-duplicate 감지 정확도 향상.

### Changed Files

**New files (4)**: `src/search/languages/en.ts`, `src/search/languages/ko.ts`, `src/search/languages/zh.ts`, `src/search/languages/index.ts`

**Refactored (3)**: `src/search/types.ts` (LanguageRuleLike 추가), `src/search/unicode61-tokenizer.ts` (languages/ 위임), `src/search/index.ts` (barrel export 확장)

**Migrated consumers (2)**: `src/agent/memory-scoring.ts` (tokenize_simple 제거, DEFAULT_TOKENIZER 사용), `src/orchestration/guardrails/session-reuse.ts` (normalize_query → DEFAULT_TOKENIZER)

**Test (2)**: `tests/search/tokenizer-policy.test.ts` (36 tests — LanguageRuleLike 계약 + TR-3/TR-4 소비자 회귀), `tests/orchestration/guardrails/session-reuse.test.ts` (23 tests — 조사 탈락 near-duplicate 테스트 추가)

### Test Command

```bash
npm run lint && npx tsc --noEmit && npx vitest run tests/search/tokenizer-policy.test.ts tests/agent/memory-scoring.test.ts tests/orchestration/guardrails/session-reuse.test.ts tests/agent/memory-service-search.test.ts
```

### Test Result

- lint: 0 errors
- tsc: passed
- vitest: 4 files / 110 tests passed

### Residual Risk

- `memory.service.ts`의 FTS5 테이블 생성 시 `tokenize='unicode61 remove_diacritics 2'` 하드코딩 잔존 — `MEMORY_CHUNK_PROFILE` 적용은 후속 작업
- `tool-index.ts`의 in-memory `tokenize()` EN-only 유지 (도구 도메인 전용, 공유 계약 범위 외)
- `compute_similarity()`의 Jaccard는 독립 구현 유지 — `memory-scoring.ts`의 `jaccard()`과 중복이나, 입력 타입(string vs Set) 및 컨텍스트 상이하여 통합 대상 아님
