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

## TR-1 + TR-2 — Shared Tokenizer/QueryNormalizer + LexicalProfile `[합의완료]`

### Claim

**TR-1**: `TokenizerPolicyLike` + `QueryNormalizerLike` 공유 인터페이스를 `src/search/types.ts`에 정의. `Unicode61Tokenizer` 기본 어댑터 구현. `memory-query-expansion.ts`의 130줄 자체 토크나이저(stop words, 조사 탈락, CJK 바이그램)를 `DEFAULT_TOKENIZER` 위임으로 교체 (23줄).

**TR-2**: `LexicalProfile` 타입으로 FTS5 tokenizer 절 + BM25 가중치를 표준화. `tool-index.ts`의 하드코딩된 `tokenize='unicode61 remove_diacritics 2'` 2곳을 `build_fts5_tokenize_clause(TOOL_INDEX_PROFILE)`로 교체. `TokenizerAdapterLike` 확장 계약으로 ICU/커스텀 어댑터 플러그인 가능.

### Changed Files

**New files (4)**: `src/search/types.ts`, `src/search/unicode61-tokenizer.ts`, `src/search/lexical-profiles.ts`, `src/search/index.ts`

**Migrated consumers (2)**: `src/agent/memory-query-expansion.ts` (DEFAULT_TOKENIZER 위임), `src/orchestration/tool-index.ts` (LexicalProfile FTS5 설정)

**Test (1)**: `tests/search/tokenizer-policy.test.ts` (28 tests — 계약 + 통합 회귀)

### Test Command

```bash
npm run lint && npx tsc --noEmit && npx vitest run tests/search/tokenizer-policy.test.ts tests/agent/memory-service-search.test.ts tests/orchestration/tool-index.test.ts
```

### Test Result

- lint: 0 errors
- tsc: passed
- vitest: 3 files / 118 tests passed

### Residual Risk

- `tool-index.ts`의 in-memory `tokenize()`는 의도적으로 EN-only — 다언어 `Unicode61Tokenizer`와 행동이 다르므로 유지
- `tool-index.ts`의 `KO_KEYWORD_MAP` (150+ 항목)은 도구 도메인 전용이라 공유 계약에 포함하지 않음
- `memory.service.ts`의 FTS5 테이블 생성도 하드코딩 — `MEMORY_CHUNK_PROFILE` 적용은 후속 작업
- `TokenizerAdapterLike`의 ICU 실 어댑터는 미구현 (계약만 정의, YAGNI)

