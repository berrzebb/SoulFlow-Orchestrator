# Claude 증거 제출

> 마지막 업데이트: 2026-03-15 12:18
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
- `[합의완료]` GW-5 + GW-6 — Service Binding + Delivery Envelope Regression
- `[합의완료]` EG-R1 — Failed-Attempt-Aware Session Reuse
- `[합의완료]` RP-1 + RP-2 — RolePolicyResolver + ProtocolResolver
- `[합의완료]` RP-3 + RP-4 — PromptProfileCompiler + Runtime Binding
- `[합의완료]` RP-5 + RP-6 — UI Migration + Golden Tests
- `[합의완료]` SO-1 + SO-2 + SO-3 — Output Contract Inventory + Shared Result Contracts + OutputParserRegistry
- `[합의완료]` SO-4 + SO-5 — SchemaChain Validator/Normalizer + Bounded SchemaRepairLoop
- `[합의완료]` SO-6 + SO-7 — runtime/workflow/gateway binding + parser-repair regression artifact
- `[합의완료]` PAR-1 + PAR-2 — ParallelResultEnvelope + ConflictSet + DeterministicReconcilePolicy + ReconcileNode
- `[합의완료]` PAR-3 + PAR-4 — CriticGate/RetryBudget + CriticGateNode + workflow schema
- `[합의완료]` PAR-5 + PAR-6 — reconcile observability events + local read model + eval bundle
- `[합의완료]` E1 + E2 + E3 — ToolOutputReducer + PtyOutputReducer + prompt/display/storage projection split
- `[합의완료]` E4 + E5 — MemoryIngestionReducer + OutputReductionKpi
- `[합의완료]` F1 + F2 — Provider Error Taxonomy + Acceptance Rubric
- `[합의완료]` F3 + F4 + F5 — Route Calibration Policy + Workflow Compiler Policy + Memory Quality Rules
- `[합의완료]` RPF-1 + RPF-2 + RPF-3 — RepoProfile + RiskTierPolicy + ApprovalPolicy
- `[합의완료]` QG-1 ~ QG-4 — Pipeline Integration + Knip + Type Snapshot + Property Testing
- `[합의완료]` RPF-4 + RPF-5 — ValidatorPack + ArtifactBundle
- `[합의완료]` RPF-4F — Frontend Validation Surface
- `[합의완료]` RPF-6 — Feedback / Eval / Dashboard Integration

## [합의완료] RPF-6 — Feedback / Eval / Dashboard Integration

### Claim

- `ArtifactBundle.risk_tier?: RiskTier` 추가 (`src/repo-profile/artifact-bundle.ts`) — 생성/역직렬화 시 전달. 잘못된 값은 `undefined`로 처리.
- `ValidatorSummary.risk_tier?`, `ValidatorSummary.eval_score?` 추가 (`src/repo-profile/validator-summary-adapter.ts`) — `adapt_bundle_to_summary()`에서 bundle 값 전달.
- `next_task_hint(summary)` 신규 — 실패/위험/eval 순 우선순위 힌트 문자열 반환. `src/repo-profile/index.ts` export.
- `repo-profile` eval 번들 등록 (`src/evals/bundles.ts`) + eval cases (`tests/evals/cases/repo-profile.json`, 8 케이스).
- 프론트엔드 `ValidatorSummary` 타입에 `risk_tier?`, `eval_score?` 추가 (`web/src/pages/overview/types.ts`).
- `ValidatorSummaryPanel` risk tier 배지 + eval score 배지 조건부 렌더 (`web/src/pages/admin/monitoring-panel.tsx`).
- i18n 7개 키 추가: `overview.risk_tier`, `overview.risk_tier_{low,medium,high,critical}`, `overview.eval_score` (en + ko).
- **Round 2 추가**: `tests/evals/bundles.test.ts`에 `repo-profile` auto-registration 회귀 잠금 3개 테스트 추가 (등록 확인, 8-case 로드, smoke 포함).
- **Round 2 추가**: `tests/repo-profile/validator-summary-adapter.test.ts`에 `next_task_hint()` 우선순위 중첩 케이스 2개 추가 (실패+critical+저eval → 실패 우선, critical+저eval → critical 우선).

### 변경 파일

- `src/repo-profile/artifact-bundle.ts` (수정) — `risk_tier?: RiskTier` 추가
- `src/repo-profile/validator-summary-adapter.ts` (수정) — `risk_tier?`, `eval_score?`, `next_task_hint()` 추가
- `src/repo-profile/index.ts` (수정) — `next_task_hint` export
- `src/evals/bundles.ts` (수정) — `repo-profile` 번들 등록
- `tests/evals/cases/repo-profile.json` (신규) — 8개 eval cases
- `web/src/pages/overview/types.ts` (수정) — `risk_tier?`, `eval_score?` 추가
- `web/src/pages/admin/monitoring-panel.tsx` (수정) — risk tier + eval score 배지
- `src/i18n/locales/en.json` (수정) — 7개 키
- `src/i18n/locales/ko.json` (수정) — 7개 키
- `tests/repo-profile/artifact-bundle.test.ts` (수정) — risk_tier 4개 테스트 추가
- `tests/repo-profile/validator-summary-adapter.test.ts` (수정) — risk_tier+eval_score+next_task_hint 10개 테스트 추가 (Round 2: 우선순위 중첩 2개 추가)
- `web/tests/pages/admin/monitoring-panel.test.tsx` (수정) — risk_tier+eval_score 배지 4개 테스트 추가
- `tests/evals/bundles.test.ts` (수정) — repo-profile auto-registration 회귀 잠금 3개 추가

### Test Command

```bash
# 백엔드 (루트)
npx vitest run tests/repo-profile/validator-summary-adapter.test.ts tests/repo-profile/artifact-bundle.test.ts tests/evals/bundles.test.ts
npx eslint tests/evals/bundles.test.ts tests/repo-profile/validator-summary-adapter.test.ts
npx tsc --noEmit
# 프론트엔드 (web/)
cd web && npx vitest run
npm run build
```

### Test Result

- `npx vitest run tests/repo-profile/validator-summary-adapter.test.ts tests/repo-profile/artifact-bundle.test.ts tests/evals/bundles.test.ts`: **3 files / 59 tests passed** (adapter:22, bundle:23, bundles:14)
- `cd web && npx vitest run`: **3 files / 20 tests passed** (monitoring-panel:9, overview:5, detail:6)
- `npx eslint tests/evals/bundles.test.ts tests/repo-profile/validator-summary-adapter.test.ts`: **0 errors, 0 warnings**
- `npx tsc --noEmit`: **통과**
- `web/npm run build`: **통과** (chunk size warning만, pre-existing)

### Residual Risk

- `risk_tier`는 번들 생성 시점에 외부에서 주입 — `DashboardOptions.validator_summary_ops`가 이미 완성된 `ValidatorSummary`를 공급하므로 `risk_tier` 계산은 호출자 책임. 설계 의도.
- `repo-profile` eval 케이스는 LLM 분류 기반 — 실제 LLM 실행 없이는 score가 0이 될 수 있음. 회귀 잠금용 정의 목적.
- `next_task_hint()`는 영어 힌트 반환 — i18n 적용 대상 아님 (내부 로직 레이어, 설계 의도).

