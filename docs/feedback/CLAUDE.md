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
- `[합의완료]` TR-3 + TR-4 — Hybrid Merge/Rerank + Session Novelty Gate Tokenizer 정렬

## TR-5 — Tokenizer/Hybrid Retrieval Eval Fixture + Regression Artifact

### Claim

`guardrail-executor.ts` 패턴을 따라 토크나이저 + 하이브리드 검색 파이프라인 전체를 `EvalExecutorLike`로 감싸는 `tokenizer-executor.ts` 생성. 6가지 입력 타입(tokenize, extract_keywords, build_fts_query, normalize_query, rrf_merge, mmr_rerank)을 지원. 12개 eval fixture 케이스를 `tests/evals/cases/tokenizer.json`에 정의 — 영어/한국어/중국어 토큰화, 불용어 필터링, 조사 탈락, FTS5 쿼리 생성, RRF 융합, MMR 다양성 리랭킹을 커버. `tokenizer` 번들을 smoke=true로 등록하여 CI에서 상시 회귀 감지.

**[계류] 반려 코드 수정**: `scripts/eval-run.ts`의 `EXECUTOR_MAP`에 `tokenizer: create_tokenizer_executor` 매핑 추가. `tests/evals/eval-run-cli.test.ts`에 `--bundle tokenizer --scorer exact --threshold 100` CLI 경로 회귀 테스트 + `--smoke` 테스트에 tokenizer 포함 검증 추가.

### Changed Files

**New (3)**: `src/evals/tokenizer-executor.ts`, `tests/evals/cases/tokenizer.json` (12 cases), `tests/evals/tokenizer-executor.test.ts` (16 tests)

**Modified (4)**: `src/evals/bundles.ts` (tokenizer 번들 등록), `src/evals/index.ts` (export 추가), `scripts/eval-run.ts` (EXECUTOR_MAP에 tokenizer 매핑), `tests/evals/eval-run-cli.test.ts` (CLI 경로 회귀 2건)

### Test Command

```bash
npm run lint && npx tsc --noEmit && npx vitest run tests/evals/ && npm run eval:smoke
```

### Test Result

- lint: 0 errors
- tsc: passed
- vitest: 8 files / 108 tests passed (기존 91 + 신규 17)
- eval:smoke: 17/17 (100.0%) ≥ threshold 80%
- `--bundle tokenizer --scorer exact --threshold 100`: 7/7 (100.0%)

### Residual Risk

- `apply_temporal_decay()`는 eval executor 미포함 — 시간 기반 함수라 deterministic fixture 구성 어려움. `memory-scoring.test.ts`에서 단위 테스트로 커버
