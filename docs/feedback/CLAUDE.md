# Claude 증거 제출

> 마지막 업데이트: 2026-03-15 05:33
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
- `[GPT미검증]` RPF-4F — Frontend Validation Surface

## [GPT미검증] RPF-4F — Frontend Validation Surface

### Claim

- 어댑터: `src/repo-profile/validator-summary-adapter.ts` (신규) — `ValidatorSummary` (repo_id/total_validators/passed_validators/failed_validators/artifact_bundle_id/created_at). `adapt_bundle_to_summary(bundle)`, `validator_badge_variant(summary)` — ok/warn/err/off 반환.
- 백엔드 공급 포트: `src/dashboard/service.types.ts` (수정) — `DashboardOptions.validator_summary_ops?` 추가 (get_latest() → ValidatorSummary | null).
- 상태 주입: `src/dashboard/state-builder.ts` (수정) — `build_dashboard_state` 반환 객체에 `validator_summary: options.validator_summary_ops?.get_latest() ?? undefined` 추가.
- Workflow 타입: `src/agent/phase-loop.types.ts` (수정) — `PhaseLoopState.artifact_bundle?` (repo_id/created_at/is_passing/total_validators/passed_validators/failed_kinds) 추가.
- 프론트엔드 타입: `web/src/pages/overview/types.ts` (수정) — `FailedValidatorEntry`, `ValidatorSummary`, `DashboardState.validator_summary?` 추가.
- Monitoring Panel: `web/src/pages/admin/monitoring-panel.tsx` (수정) — `ValidatorSummaryPanel` 컴포넌트 추가, validator_summary 존재 시 조건부 렌더링.
- Overview: `web/src/pages/overview/index.tsx` (수정) — 실패 시에만 validator 섹션 노출.
- Workflow Detail: `web/src/pages/workflows/detail.tsx` (수정) — `ArtifactBundleEntry` 인터페이스, frontend `PhaseLoopState.artifact_bundle?`, `ArtifactEntryCard` 컴포넌트 추가.
- i18n: `src/i18n/locales/en.json`, `src/i18n/locales/ko.json` (수정) — validator/artifact bundle 관련 키 추가.

### 변경 파일

- `src/repo-profile/validator-summary-adapter.ts` (신규) — ValidatorSummary 어댑터 + validator_badge_variant
- `src/repo-profile/index.ts` (수정) — RPF-4F barrel export 추가
- `src/dashboard/service.types.ts` (수정) — validator_summary_ops 포트 추가
- `src/dashboard/state-builder.ts` (수정) — validator_summary 주입
- `src/agent/phase-loop.types.ts` (수정) — PhaseLoopState.artifact_bundle? 추가
- `web/src/pages/overview/types.ts` (수정) — FailedValidatorEntry, ValidatorSummary, DashboardState 확장
- `web/src/pages/admin/monitoring-panel.tsx` (수정) — ValidatorSummaryPanel 추가
- `web/src/pages/overview/index.tsx` (수정) — validator 실패 섹션 추가
- `web/src/pages/workflows/detail.tsx` (수정) — ArtifactBundleEntry, frontend PhaseLoopState.artifact_bundle?, ArtifactEntryCard 추가
- `src/i18n/locales/en.json` (수정) — overview.validator_* + workflows.artifact_bundle_* 키 추가
- `src/i18n/locales/ko.json` (수정) — 동일 한국어 번역 추가
- `tests/repo-profile/validator-summary-adapter.test.ts` (신규) — 12개 테스트
- `tests/dashboard/validator-summary-state.test.ts` (신규) — 7개 테스트 (state-builder + PhaseLoopState)

### Test Command

```bash
npx vitest run tests/repo-profile/validator-summary-adapter.test.ts tests/dashboard/validator-summary-state.test.ts
npx eslint src/repo-profile/validator-summary-adapter.ts
npx eslint src/repo-profile/index.ts
npx eslint src/dashboard/service.types.ts
npx eslint src/dashboard/state-builder.ts
npx eslint src/agent/phase-loop.types.ts
npx eslint tests/repo-profile/validator-summary-adapter.test.ts
npx eslint tests/dashboard/validator-summary-state.test.ts
npx eslint web/src/pages/overview/types.ts
npx eslint web/src/pages/admin/monitoring-panel.tsx
npx eslint web/src/pages/overview/index.tsx
npx eslint web/src/pages/workflows/detail.tsx
npx tsc --noEmit
```

### Test Result

- `npx vitest run ... validator-summary-adapter.test.ts ... validator-summary-state.test.ts`: **2 files / 19 tests passed** (adapter:12, state:7)
- `npx eslint src/repo-profile/validator-summary-adapter.ts`: **0 errors, 0 warnings**
- `npx eslint src/repo-profile/index.ts`: **0 errors, 0 warnings**
- `npx eslint src/dashboard/service.types.ts`: **0 errors, 0 warnings**
- `npx eslint src/dashboard/state-builder.ts`: **0 errors, 0 warnings**
- `npx eslint src/agent/phase-loop.types.ts`: **0 errors, 0 warnings**
- `npx eslint tests/repo-profile/validator-summary-adapter.test.ts`: **0 errors, 0 warnings**
- `npx eslint tests/dashboard/validator-summary-state.test.ts`: **0 errors, 0 warnings**
- `npx eslint web/src/pages/overview/types.ts`: **0 errors, 0 warnings**
- `npx eslint web/src/pages/admin/monitoring-panel.tsx`: **0 errors, 0 warnings**
- `npx eslint web/src/pages/overview/index.tsx`: **0 errors, 0 warnings**
- `npx eslint web/src/pages/workflows/detail.tsx`: **0 errors, 0 warnings**
- `npx tsc --noEmit`: **통과**

### Residual Risk

- `ValidatorSummary`는 프론트엔드(`web/src/pages/overview/types.ts`)와 백엔드(`src/repo-profile/validator-summary-adapter.ts`)에서 독립 선언 — 구조 변경 시 수동 동기화 필요.
- `DashboardOptions.validator_summary_ops`는 optional — 미주입 시 `/api/state`에서 validator_summary 생략. 설계 의도(점진적 도입 가능).
- `PhaseLoopState.artifact_bundle`은 optional — 워크플로우가 ArtifactBundle을 저장하지 않으면 workflow detail에서 카드가 렌더되지 않음.