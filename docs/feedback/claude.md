# Claude 증거 제출

> 마지막 업데이트: 2026-03-15 (FE-4 + FE-5 증거 제출)
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
- `[합의완료]` FE-2 + FE-3 — Chat/Session Surface + Workflow/Eval/Schema Surface
- `[합의완료]` FE-4 + FE-5 — Admin/Security/Monitoring + Repository/Retrieval/Artifact Surface

## [합의완료] FE-4 + FE-5 — Admin/Security/Monitoring + Repository/Retrieval/Artifact Surface

> 마지막 업데이트: 2026-03-15

---

### FE-4 + FE-5 — Admin/Security/Monitoring + Repository/Retrieval/Artifact Surface

#### Claim

**FE-4: Admin/Security/Monitoring Surface**

- `web/src/pages/overview/types.ts` — `ProcessInfo`에 `request_class?` (GW 분류 결과) + `guardrail_blocked?` (EG 차단 여부) 추가. `DashboardState`에 `request_class_summary?` (분류별 집계) + `guardrail_stats?` (차단/전체) 추가. `WorkflowEvent`에 `retrieval_source?` + `novelty_score?` 추가. `RequestClass` 타입 정의
- `web/src/pages/admin/monitoring-panel.tsx` — `RequestClassPanel` 컴포넌트: request class 분류별 배지 + 비율(%) 내림차순 렌더, guardrail 통계 (blocked/total) 섹션. 빈 데이터면 패널 미렌더 (graceful degradation)
- `web/src/pages/admin/index.tsx` — `UsersPanel`에 `session_count?` 배지 추가. 0이거나 없으면 미렌더
- `web/src/hooks/use-auth.ts` — `AdminUserRecord`에 `session_count?` 필드 추가

**FE-5: Repository/Retrieval/Artifact Surface**

- `web/src/pages/workspace/memory.tsx` — `WorkflowEvent`에 `retrieval_source?` + `novelty_score?` 필드 추가. events 테이블에 Retrieval 컬럼: source 배지 + novelty 퍼센트 (색상: ≥0.7 ok / ≥0.4 warn / <0.4 err)
- `web/src/pages/workspace/tools.tsx` — `ToolSchema`에 `usage_count?` + `last_used_at?` 추가. ToolCard에 호출 횟수 + 마지막 사용 시간 렌더. `time_ago` import 추가

#### 변경 파일

**수정:**
- `web/src/pages/overview/types.ts`
- `web/src/pages/admin/monitoring-panel.tsx`
- `web/src/pages/admin/index.tsx`
- `web/src/hooks/use-auth.ts`
- `web/src/pages/workspace/memory.tsx`
- `web/src/pages/workspace/tools.tsx`

**신규/확장 테스트:**
- `web/tests/pages/admin/monitoring-panel.test.tsx` (기존 10 + 신규 8 = 18 tests)
- `web/tests/pages/admin/admin-user-sessions.test.tsx` (3 tests)
- `web/tests/workspace/memory-retrieval.test.tsx` (6 tests)
- `web/tests/workspace/tools-usage.test.tsx` (7 tests)

#### Test Command

```bash
cd web && npx vitest run tests/pages/admin/monitoring-panel.test.tsx tests/pages/admin/admin-user-sessions.test.tsx tests/workspace/memory-retrieval.test.tsx tests/workspace/tools-usage.test.tsx
npx eslint src/pages/overview/types.ts src/pages/admin/monitoring-panel.tsx src/pages/admin/index.tsx src/hooks/use-auth.ts src/pages/workspace/memory.tsx src/pages/workspace/tools.tsx tests/pages/admin/monitoring-panel.test.tsx tests/pages/admin/admin-user-sessions.test.tsx tests/workspace/memory-retrieval.test.tsx tests/workspace/tools-usage.test.tsx --max-warnings=0
npx tsc --noEmit
```

#### Test Result

- `npx vitest run ...`: **4 files / 34 tests passed** (기존 FE-2+FE-3 포함 시 10 files / 74 tests)
- `npx eslint ...`: **0 errors, 0 warnings**
- `npx tsc --noEmit`: **통과**

#### Residual Risk

- 모든 신규 필드는 optional (`?`) — 백엔드가 필드를 전송하지 않으면 UI에 해당 요소가 렌더되지 않음 (graceful degradation)
- `request_class_summary`는 백엔드에서 집계하여 전송해야 동작 — 미구현 시 Request Classification 패널 미표시
- `guardrail_stats`도 백엔드 집계 의존 — 미전송 시 guardrail 섹션 미표시
- `retrieval_source`/`novelty_score`는 TR 트랙 백엔드가 workflow event에 포함해야 표시됨
- `usage_count`/`last_used_at`는 tool registry가 사용량 추적 시 전송 — 미구현 시 호출 횟수 미표시
- `admin/index.tsx`의 하드코딩 한글 문자열은 FE-4 범위 밖 (기존 상태 유지)

