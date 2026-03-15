# Claude 증거 제출

> 마지막 업데이트: 2026-03-15 13:06
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
- `[합의완료]` FE-0 + FE-1 — Page Access Policy Inventory + Visibility Contract

## [합의완료] FE-0 + FE-1 — Page Access Policy Inventory + Visibility Contract

### Round 2 수정 (GPT 계류 응답)

- **test-gap [major] 해결**: `usePageAccess()` 훅 직접 테스트 10개 추가 — auth 로딩 경계(`data=undefined` → `auth_enabled=false`), auth 비활성/활성, team 역할(viewer/manager/owner), superadmin, public tier 전체 검증
- **claim-drift [minor] 해결**: 테스트의 인라인 `ROUTER_PATHS` 복사본 제거 → `web/src/router-paths.ts` 단일 소스로 추출. `router.tsx`도 `PATHS` 상수에서 import하도록 변경 → 진짜 링크 강제

### Claim

- `VisibilityTier` 6단계 타입 + `PagePolicy` 인터페이스 + `TEAM_ROLE_RANK` 서열 맵 — `web/src/pages/access-policy.ts`
- `PAGE_POLICIES` 18개 항목 — `web/src/router-paths.ts`의 `ROUTER_PATHS`와 1:1 대응 (테스트로 양방향 잠금)
- `tier_satisfied()` 순수 함수 + `usePageAccess()` 훅 — `web/src/hooks/use-page-access.ts`
- `web/src/router-paths.ts` — `PATHS` 상수 + `ROUTER_PATHS` 배열: router.tsx와 테스트 공유 단일 소스
- `web/src/router.tsx` — `PATHS` 상수에서 경로 import, `r()` 헬퍼로 leading `/` 제거

### 변경 파일

- `web/src/router-paths.ts` (신규) — PATHS 상수 + ROUTER_PATHS 배열 (단일 소스)
- `web/src/router.tsx` (수정) — PATHS에서 import
- `web/src/pages/access-policy.ts` (신규) — FE-0: 인벤토리 + 타입
- `web/src/hooks/use-page-access.ts` (신규) — FE-1: `tier_satisfied()` + `usePageAccess()`
- `web/tests/pages/access-policy.test.ts` (수정) — ROUTER_PATHS를 router-paths.ts에서 import
- `web/tests/hooks/use-page-access.test.ts` (수정) — usePageAccess() 훅 직접 테스트 10개 추가

### Test Command

```bash
cd web && npx vitest run tests/pages/access-policy.test.ts tests/hooks/use-page-access.test.ts
npx eslint src/router-paths.ts src/router.tsx src/pages/access-policy.ts src/hooks/use-page-access.ts tests/pages/access-policy.test.ts tests/hooks/use-page-access.test.ts
npx tsc --noEmit
```

### Test Result

- `npx vitest run ...`: **2 files / 48 tests passed** (access-policy:11, use-page-access:37)
- `npx eslint ...`: **0 errors, 0 warnings**
- `npx tsc --noEmit`: **통과**

### Residual Risk

- `router-paths.ts` → `router.tsx` 링크는 컴파일 타임에 강제됨. `PAGE_POLICIES`와 `router-paths.ts` 동기화는 테스트로 양방향 잠김. 신규 라우트 추가 시 두 파일 모두 업데이트 필요.
- `usePageAccess()`는 UI-level 제어용 — 실제 보안 경계는 백엔드 API 403. FE-2에서 `RequireRole` 래퍼 구현 예정.
- auth 비활성 시 모든 tier 통과는 싱글유저 모드 지원 의도.

