# Claude 증거 제출

> 마지막 업데이트: 2026-03-14 16:22
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
- `[합의완료]` GW-1 + GW-2 — RequestPlan/ResultEnvelope + Ingress Normalization/Classification
- `[합의완료]` GW-3 + GW-4 — ExecutionGateway + DirectExecutor

## GW-3 + GW-4 — ExecutionGateway + DirectExecutor [합의완료]

### Claim

`ExecutionGateway`(`execution-gateway.ts`) — provider/executor 결정 + fallback chain 공식화. `ExecutionRoute { primary, fallbacks }` 타입으로 결정 결과 표현. `ProviderCapabilities` 기반 가용성 판별 + 우선순위(chatgpt → claude_code → openrouter → orchestrator_llm) fallback chain 자동 구성. no_token 경로는 fallback 없음(LLM 불필요).

`DirectExecutor`(`direct-executor.ts`) — LLM 없이 결정론적 도구 실행. 6개 read-only/bounded-write 도구(datetime, task_query, read_file, list_dir, search_files, memory) 허용. 실패 시 dispatcher가 once 모드로 폴백.

`execute-dispatcher.ts` 통합 — optional deps로 backward compatible. `direct_tool` 단축 경로(성공 시 LLM 스킵, 실패 시 once 폴백). Gateway 기반 fallback chain(legacy `claude_code → chatgpt` 하드코딩 대체).

`gateway.ts` — `GatewayDecision`에 `direct_tool` variant 추가. `gateway-contracts.ts` — `to_request_plan`에 direct_tool 매핑 추가. Eval fixture 8개 추가(route 4 + direct 4, smoke 태그). gateway 번들 22 cases / 19 smoke.

### Changed Files

**New (2)**: `src/orchestration/execution-gateway.ts`, `src/orchestration/execution/direct-executor.ts`

**New Tests (2)**: `tests/orchestration/execution-gateway.test.ts` (19 tests), `tests/orchestration/execution/direct-executor.test.ts` (16 tests)

**Modified (5)**: `src/orchestration/gateway.ts` (direct_tool variant), `src/orchestration/gateway-contracts.ts` (direct_tool mapping), `src/orchestration/execution/execute-dispatcher.ts` (GW-3/GW-4 통합), `src/evals/gateway-executor.ts` (route+direct handler), `tests/evals/cases/gateway.json` (14→22 cases)

**Modified Tests (1)**: `tests/evals/eval-run-cli.test.ts` (Passed: 11→19)

### Test Command

```bash
npm run lint && npx tsc --noEmit && npx vitest run tests/evals/ tests/orchestration/execution-gateway.test.ts tests/orchestration/execution/direct-executor.test.ts tests/orchestration/gateway-contracts.test.ts tests/orchestration/ingress-normalizer.test.ts tests/orchestration/execute-dispatcher.test.ts tests/orchestration/gateway.test.ts && npx tsx scripts/eval-run.ts --bundle gateway --scorer exact --threshold 100
```

### Test Result

- lint: 0 errors
- tsc: passed
- vitest: 15 files / 224 tests passed (기존 153 + 신규 35 + 기존 수정 36)
- `--bundle gateway --scorer exact --threshold 100`: 19/19 (100.0%)

### Residual Risk

- `execute-dispatcher.ts`의 gateway/direct_executor deps는 optional — 미주입 시 기존 legacy 경로 유지 (backward compatible)
- dispatcher 실제 호출 통합은 service.ts에서 deps 주입 시 활성화 — 현재는 unit test 레벨 검증만 완료

## GW-1 + GW-2 — RequestPlan/ResultEnvelope + Ingress Normalization/Classification [합의완료]

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

