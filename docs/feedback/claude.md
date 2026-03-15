# Claude 증거 제출

> 마지막 업데이트: 2026-03-15 (FE-2 + FE-3 단독 감사 분리)
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

## [합의완료] FE-2 + FE-3 — Chat/Session Surface + Workflow/Eval/Schema Surface

> 마지막 업데이트: 2026-03-15

---

### FE-2 + FE-3 — Chat/Session Surface + Workflow/Eval/Schema Surface

#### Claim

**FE-2: Chat/Session Surface Integration**

- `web/src/pages/workspace/sessions.tsx` — `user_id?` 필드 + `scoped_sessions` memo: auth 활성 + 비superadmin → `auth_user.sub`으로 클라이언트측 필터. superadmin은 "전체/내것" 토글 + 외부 세션에 `⚠` 표시
- `web/src/layouts/root.tsx` — SSE freshness 감지: `last_event_at` ref + 5초 interval 체크 (30초 임계값). 모든 SSE 이벤트 핸들러에 `mark_event()` 호출. `sse_stale` 상태로 topbar에 `topbar__conn--stale` 클래스 표시
- `web/src/pages/chat/chat-status-bar.tsx` — `requested_channel?` + `delivered_channel?` + `session_reuse?` 프롭 추가. 채널 미스매치 `⚡` 배지 + 세션 재사용 `↩` 칩. `BusyBar` 서브 컴포넌트로 분리
- `web/src/hooks/use-ndjson-stream.ts` — `routing` NDJSON 이벤트 타입 + `RoutingInfo` 상태: 스트림 시작 시 초기화, `routing` 이벤트 수신 시 상태 업데이트
- `web/src/pages/chat.tsx` — `init_def` lazy useState init + useEffect async-only 정리 (`react-hooks/set-state-in-effect` 해소)

**FE-3: Workflow/Eval/Schema Surface Integration**

- `web/src/pages/workflows/detail.tsx` — `PhaseAgentState`에 `retry_count?/eval_score?/schema_valid?` 추가, AgentCard에 점수/재시도/스키마 배지
- `web/src/pages/prompting/run-result.tsx` — `RunResultValue`에 `eval_score?` 추가, 점수 칩
- `web/src/pages/workflows/node-inspector.tsx` — `NodeExecutionState`에 `schema_valid?/schema_repaired?` 추가
- `web/src/pages/workflows/inspector-output.tsx` — 스키마 배지 행 (✓/✗/↩)

#### 변경 파일

**수정:**
- `web/src/hooks/use-ndjson-stream.ts`
- `web/src/pages/chat.tsx`
- `web/src/pages/workspace/sessions.tsx`
- `web/src/layouts/root.tsx`
- `web/src/pages/chat/chat-status-bar.tsx`
- `web/src/pages/workflows/detail.tsx`
- `web/src/pages/prompting/run-result.tsx`
- `web/src/pages/workflows/node-inspector.tsx`
- `web/src/pages/workflows/inspector-output.tsx`

**신규 테스트:**
- `web/tests/pages/chat-status-bar.test.tsx` (8 tests)
- `web/tests/layouts/root-sse-stale.test.tsx` (3 tests)
- `web/tests/workspace/sessions-user-scope.test.tsx` (7 tests)
- `web/tests/pages/workflows/detail-badges.test.tsx` (10 tests)
- `web/tests/prompting/run-result-eval.test.tsx` (6 tests)
- `web/tests/pages/workflows/inspector-schema-badge.test.tsx` (6 tests)

#### Test Command

```bash
cd web && npx vitest run tests/pages/chat-status-bar.test.tsx tests/layouts/root-sse-stale.test.tsx tests/workspace/sessions-user-scope.test.tsx tests/pages/workflows/detail-badges.test.tsx tests/prompting/run-result-eval.test.tsx tests/pages/workflows/inspector-schema-badge.test.tsx
npx eslint src/pages/chat.tsx src/hooks/use-ndjson-stream.ts src/pages/workspace/sessions.tsx src/layouts/root.tsx src/pages/chat/chat-status-bar.tsx src/pages/workflows/detail.tsx src/pages/prompting/run-result.tsx src/pages/workflows/node-inspector.tsx src/pages/workflows/inspector-output.tsx tests/pages/chat-status-bar.test.tsx tests/layouts/root-sse-stale.test.tsx --max-warnings=0
npx tsc --noEmit
```

#### Test Result

- `npx vitest run ...`: **6 files / 40 tests passed**
- `npx eslint ...`: **0 errors, 0 warnings** (chat.tsx 포함)
- `npx tsc --noEmit`: **통과**

#### Residual Risk

- `sessions.tsx` 클라이언트 필터는 방어 레이어 — 실제 보안 경계는 백엔드 `/api/sessions` 쿼리 필터 (이미 team_id 스코프 적용됨)
- `user_id`가 백엔드 응답에 없으면 필터 미작동 (백엔드 스코프에 위임) — 주석으로 명시
- SSE stale 감지는 30초 임계값 하드코딩 — 네트워크 환경에 따라 오탐 가능하나 표시만 하고 재연결은 별도 로직
- `routing` 이벤트는 백엔드가 스트림에 전송해야 동작 — 백엔드 미구현 시 배지/칩은 렌더되지 않음 (graceful degradation)

