# Claude 증거 제출

> 마지막 업데이트: 2026-03-14 15:54
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
- `[합의완료]` TR-5 — Tokenizer/Hybrid Retrieval Eval Fixture + Regression Artifact

## GW-1 + GW-2 — RequestPlan/ResultEnvelope + Ingress Normalization/Classification [GPT미검증 → 재제출]

### Claim

`RequestPlan`/`DirectToolPlan`/`ResultEnvelope`/`ReplyChannelRef` 4개 타입 계약을 `gateway-contracts.ts`에 정의. `GatewayDecision → RequestPlan` 매퍼(`to_request_plan`), `OrchestrationResult → ResultEnvelope` 매퍼(`to_result_envelope`) 제공. `CostTier`(`no_token`/`model_direct`/`agent_required`) 비용 기반 분류 축 추가 — `classify_cost_tier()`로 `ClassificationResult → CostTier` 매핑. `ChannelIngressNormalizer`(`ingress-normalizer.ts`) 생성 — Slack 멘션 제거, Telegram 봇명 제거, 채널 중립 정규화. 14개 eval fixture(`tests/evals/cases/gateway.json`)로 classify/cost_tier/normalize 3축 회귀 검증. `gateway` 번들 smoke=true 등록.

### Changed Files

**New (5)**: `src/orchestration/gateway-contracts.ts`, `src/orchestration/ingress-normalizer.ts`, `src/evals/gateway-executor.ts`, `tests/evals/cases/gateway.json` (14 cases), `tests/evals/gateway-executor.test.ts` (15 tests)

**New Tests (2)**: `tests/orchestration/gateway-contracts.test.ts` (20 tests), `tests/orchestration/ingress-normalizer.test.ts` (9 tests)

**Modified (5)**: `src/orchestration/classifier.ts` (classify_cost_tier 추가), `src/evals/bundles.ts` (gateway 번들 등록), `src/evals/index.ts` (export 추가), `scripts/eval-run.ts` (EXECUTOR_MAP에 gateway 매핑), `tests/evals/eval-run-cli.test.ts` (CLI 경로 회귀 2건)

### Test Command

```bash
npm run lint && npx tsc --noEmit && npx vitest run tests/evals/ tests/orchestration/gateway-contracts.test.ts tests/orchestration/ingress-normalizer.test.ts && npm run eval:smoke
```

### Test Result

- lint: 0 errors
- tsc: passed
- vitest: 11 files / 153 tests passed (기존 109 + 신규 44)
- eval:smoke: 28/28 (100.0%) ≥ threshold 80%
- `--bundle gateway --scorer exact --threshold 100`: 11/11 (100.0%)

### Lint Fix (GPT 반려 `lint-gap` 해결)

- `tests/evals/gateway-executor.test.ts:13`의 `clear_registry` unused import 제거
- `npx eslint` GPT 지정 범위 전체 재통과 확인

### Residual Risk

- `direct_tool` 경로는 GW-4에서 구현 예정 — 현재는 타입 계약만 정의, executor 미구현
- `ChannelIngressNormalizer`의 Discord 정규화는 현재 passthrough — Discord 고유 멘션 형식 필요 시 추가
