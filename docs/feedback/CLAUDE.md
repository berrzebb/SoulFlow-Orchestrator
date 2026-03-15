# Claude 증거 제출

> 마지막 업데이트: 2026-03-15 11:20 → 11:25 → 11:30 (Round 6: [합의완료])
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

## [합의완료] RPF-4F — Frontend Validation Surface

### Claim

- 어댑터: `src/repo-profile/validator-summary-adapter.ts` (신규) — `ValidatorSummary`. `adapt_bundle_to_summary(bundle)`, `validator_badge_variant(summary)`.
- 백엔드 공급 포트: `src/dashboard/service.types.ts` — `DashboardOptions.validator_summary_ops?` 추가.
- 상태 주입: `src/dashboard/state-builder.ts` — `validator_summary: options.validator_summary_ops?.get_latest() ?? undefined`.
- Bootstrap wiring: `src/bootstrap/dashboard.ts` — `create_dashboard_bundle` 내부에 인메모리 `validator_summary_ops` 홀더 생성 + `DashboardService` 주입 + `DashboardBundleResult` 노출.
- Workflow 타입+런타임+create wiring: `src/agent/phase-loop.types.ts` — `PhaseLoopState.artifact_bundle?` + `PhaseLoopRunOptions.artifact_bundle?`. `src/agent/phase-loop-runner.ts` — 새 state 생성 블록에 스프레드 → store.upsert → `/api/workflow/runs/:id` 자동 공급. `src/dashboard/ops/workflow.ts:create` — `input.artifact_bundle` 추출 + `run_phase_loop`에 전달.
- 프론트엔드: `web/src/pages/overview/types.ts`, `web/src/pages/admin/monitoring-panel.tsx`, `web/src/pages/overview/index.tsx`, `web/src/pages/workflows/detail.tsx`.
- i18n: `src/i18n/locales/en.json`, `src/i18n/locales/ko.json`.

### 변경 파일

- `src/repo-profile/validator-summary-adapter.ts` (신규)
- `src/repo-profile/index.ts` (수정)
- `src/dashboard/service.types.ts` (수정)
- `src/dashboard/state-builder.ts` (수정)
- `src/bootstrap/dashboard.ts` (수정) — validator_summary_ops 인메모리 홀더 + DashboardService 주입 + Result 노출
- `src/dashboard/ops/workflow.ts` (수정) — create에서 artifact_bundle 추출 + run_phase_loop 전달
- `src/agent/phase-loop.types.ts` (수정) — PhaseLoopState.artifact_bundle? + PhaseLoopRunOptions.artifact_bundle?
- `src/agent/phase-loop-runner.ts` (수정) — artifact_bundle 스프레드 추가
- `web/src/pages/overview/types.ts` (수정)
- `web/src/pages/admin/monitoring-panel.tsx` (수정)
- `web/src/pages/overview/index.tsx` (수정)
- `web/src/pages/workflows/detail.tsx` (수정) — ArtifactBundleEntry export 추가
- `src/i18n/locales/en.json` (수정)
- `src/i18n/locales/ko.json` (수정)
- `tests/repo-profile/validator-summary-adapter.test.ts` (신규) — 12개 테스트
- `tests/dashboard/validator-summary-state.test.ts` (신규) — 7개 테스트
- `tests/agent/phase-loop-runner-nodes.test.ts` (수정) — artifact_bundle 주입 3개 테스트 추가
- `tests/dashboard/ops/workflow-ops.test.ts` (수정) — create artifact_bundle 전달 2개 테스트 추가
- `web/eslint.config.js` (수정) — files 패턴에 `tests/**/*.{ts,tsx}` 추가, web 테스트 파일 lint 공백 해소
- `web/vitest.config.ts` (신규) — happy-dom 환경 React 테스트 설정
- `web/tests/setup.ts` (신규) — @testing-library/jest-dom 설정
- `web/tests/test-utils.tsx` (신규) — render_routed, make_dashboard_state, make_passing_summary, make_failing_summary 공유 유틸리티
- `web/tests/pages/admin/monitoring-panel.test.tsx` (신규) — ValidatorSummaryPanel 직접 렌더 5개 테스트
- `web/tests/pages/overview/index.test.tsx` (신규) — 실패 섹션 조건부 렌더 5개 테스트
- `web/tests/pages/workflows/detail.test.tsx` (신규) — ArtifactEntryCard 직접 렌더 6개 테스트

### Test Command

```bash
# 백엔드 (루트)
npx vitest run tests/repo-profile/validator-summary-adapter.test.ts tests/dashboard/validator-summary-state.test.ts tests/agent/phase-loop-runner-nodes.test.ts tests/dashboard/ops/workflow-ops.test.ts
npx eslint src/bootstrap/dashboard.ts src/dashboard/ops/workflow.ts src/agent/phase-loop.types.ts src/agent/phase-loop-runner.ts
npx tsc --noEmit
# 프론트엔드 (web/)
cd web && npx vitest run
npx eslint src/pages/overview/types.ts src/pages/admin/monitoring-panel.tsx src/pages/overview/index.tsx src/pages/workflows/detail.tsx
npx eslint tests/setup.ts tests/test-utils.tsx tests/pages/admin/monitoring-panel.test.tsx tests/pages/overview/index.test.tsx tests/pages/workflows/detail.test.tsx
npm run build
```

### Test Result

- `npx vitest run ... (4 backend files)`: **4 files / 85 tests passed** (adapter:12, state:7, runner-nodes:24, workflow-ops:42)
- `cd web && npx vitest run`: **3 files / 16 tests passed** (monitoring-panel:5, overview:5, detail:6)
- `npx eslint src/bootstrap/dashboard.ts src/dashboard/ops/workflow.ts src/agent/phase-loop.types.ts src/agent/phase-loop-runner.ts`: **0 errors, 0 warnings**
- `web/npx eslint src/pages/overview/types.ts src/pages/admin/monitoring-panel.tsx src/pages/overview/index.tsx src/pages/workflows/detail.tsx`: **0 errors, 0 warnings**
- `web/npx eslint tests/setup.ts tests/test-utils.tsx tests/pages/admin/monitoring-panel.test.tsx tests/pages/overview/index.test.tsx tests/pages/workflows/detail.test.tsx`: **0 errors, 0 warnings** (Round 6: eslint.config.js files 패턴에 `tests/**/*.{ts,tsx}` 추가로 lint 공백 해소)
- `npx tsc --noEmit`: **통과**
- `web/npm run build`: **통과** (chunk size warning만, 기존 pre-existing lint는 RPF-4F 외 파일)

### Residual Risk

- `ValidatorSummary`는 프론트엔드/백엔드 독립 선언 — 구조 변경 시 수동 동기화 필요. 설계 의도(점진적 도입).
- `validator_summary_ops` 인메모리 홀더는 초기 null — 외부에서 `set_latest()`로 push해야 표시됨. 설계 의도.
- `PhaseLoopRunOptions.artifact_bundle`은 optional — API 호출자가 제공해야 workflow detail에 카드 렌더. 설계 의도.