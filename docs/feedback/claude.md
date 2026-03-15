# Claude 증거 제출

> 마지막 업데이트: 2026-03-15 (FE-6 Round 4 — events user_id + state-builder passthrough 테스트 보강)
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
- `[합의완료]` FE-6 — Frontend Regression Bundle (Cross-User Isolation + Regression Lock)

## [합의완료] FE-6 — Frontend Regression Bundle (Cross-User Isolation + Regression Lock)

> 마지막 업데이트: 2026-03-15

---

### FE-6 — Frontend Regression Bundle

#### Round 4 수정 (GPT 계류 응답 — test-gap [major] 해결: events user_id + state-builder passthrough)

GPT 지적: `events/service.ts`의 `user_id` 저장/필터와 `state-builder.ts`의 `user_id` passthrough에 전용 직접 호출 테스트 부재.

- `tests/events/workflow-event-service.test.ts` (+6 tests) — `user_id` 저장·필터 직접 검증: (1) append user_id 저장 + 반환 (2) user_id 미지정 → 빈 문자열 (3) list user_id 필터로 해당 사용자만 조회 (4) list user_id 미지정 → 전체 반환 (5) user_id DB 컬럼 직접 조회 (6) team_id + user_id 조합 필터
- `tests/dashboard/state-builder.test.ts` (+2 tests) — `workflow_events.user_id` passthrough 직접 검증: (1) user_id 포함 시 응답에 반영 (2) user_id 없으면 undefined (레거시 호환)

#### Round 3 수정 (GPT 계류 응답 — lint-gap [major] 해결)

- `tests/dashboard/session-route-ownership.test.ts:L71` — `TEAM_B` 미사용 변수 삭제.

#### Round 2 수정 (GPT 계류 응답 — test-gap [major] 해결)

GPT 지적: 백엔드 수정 6파일을 claim에 포함하면서 직접 호출 테스트가 증거 패키지에 없음.

**추가한 백엔드 직접 호출 테스트:**

- `tests/dashboard/route-context.test.ts` — `get_filter_user_id()` 직접 호출 4개 케이스: (1) auth 비활성 → undefined (2) superadmin → undefined (3) 일반 유저 → `auth_user.sub` (4) auth_user null → 빈 문자열
- `tests/dashboard/session-route-ownership.test.ts` — `GET /api/sessions` 목록 user_id 필터 직접 호출 4개 케이스: (1) web 6파트 키에서 본인 세션만 반환 + 타인 세션 제외 (2) chat_id가 user_id와 혼동 없이 올바르게 파싱됨 (3) external 5파트 키에서 user_id undefined로 반환 (필터 통과) (4) superadmin은 모든 user_id 세션 반환
- `tests/dashboard/idor-ownership.test.ts` — `GET /api/tasks/:id/detail` ownership 직접 호출 3개 케이스: (1) 타팀 태스크 → 404 + `get_task` scope 전달 검증 + `read_task_detail` 미호출 검증 (2) 자기 팀 태스크 → 200 + detail content 반환 (3) superadmin → 200 + team_id undefined 전달

#### 보안 감사 결과 요약

독립 보안 감사(Opus 에이전트)를 통해 45개 API 엔드포인트의 스코핑 상태를 전수 조사.

**이번 이터레이션에서 수정한 취약점 (3건):**

| 엔드포인트 | 파일:라인 | 변경 전 | 변경 후 |
|---|---|---|---|
| `GET /api/sessions` | `session.ts:9-33` | `team_id`만 필터. 6파트 web 키를 5파트로 잘못 파싱 | `parse_session_key()` 6파트/5파트 분리. `get_filter_user_id` user 필터 추가 |
| `GET /api/tasks/:id/detail` | `task.ts:49-55` | 스코핑 없음 | `task_ops.get_task(id, scope)` 소유권 검증 추가 |
| Workflow Events DB | `events/service.ts` + `events/types.ts` | `user_id` 컬럼 없음 | `ALTER TABLE ADD COLUMN user_id` + INSERT/SELECT/WHERE 반영 |

**미수정 취약점 (다음 이터레이션):**

| 심각도 | 엔드포인트 | 파일 | 문제 |
|---|---|---|---|
| CRITICAL | `/api/workflow/runs/*` | `routes/workflows.ts:24-87` | team_id 스코핑 없음 |
| CRITICAL | `/api/workflow/events` | `routes/health.ts:90-103` | team_id 미포함 |
| CRITICAL | `/api/usage/*` | `routes/usage.ts:16-53` | LLM 비용 데이터 전체 노출 |
| CRITICAL | `/api/dlq/*` | `routes/health.ts:31-87` | DLQ 메시지 내용 전체 노출 |
| HIGH | `/api/kanban/cards/:id/*` | `routes/kanban.ts:189-250` | board 소유권 검사 우회 |
| HIGH | `/api/agents/providers/:id` GET | `routes/agent-provider.ts:111-119` | scope 검사 없음 |
| HIGH | `/api/agent-definitions/:id` GET | `routes/agent-definition.ts:82-91` | scope 검사 없음 |
| HIGH | `/api/agents/connections` GET | `routes/agent-provider.ts:158-163` | 전체 connection 노출 |

#### Claim

**백엔드 수정 (6파일):**

- `src/dashboard/route-context.ts:100-108` — `get_filter_user_id(ctx)` 추가
- `src/dashboard/routes/session.ts:4-32` — `parse_session_key()` 6파트/5파트 분리 + user_id 필터
- `src/dashboard/routes/task.ts:52-54` — `/api/tasks/:id/detail` ownership 검증
- `src/events/types.ts:29,47,62` — `WorkflowEvent.user_id`, `AppendWorkflowEventInput.user_id`, `ListWorkflowEventsFilter.user_id`
- `src/events/service.ts:124-127,221,319,339,385-388` — DB 마이그레이션 + INSERT/SELECT/WHERE user_id
- `src/dashboard/state-builder.ts:131` — `workflow_events` 응답에 `user_id` 포함

**프론트엔드 방어 레이어 (2파일):**

- `web/src/pages/workspace/memory.tsx:1,16,28-29,87-96` — events `user_id` 클라이언트 필터
- `web/src/pages/workspace/agents.tsx:1,17,80-93` — processes `sender_id` 클라이언트 필터

**백엔드 직접 호출 테스트 (3파일 보강):**

- `tests/dashboard/route-context.test.ts` (+4 tests) — `get_filter_user_id` 싱글유저/superadmin/user/null 분기
- `tests/dashboard/session-route-ownership.test.ts` (+4 tests) — `/api/sessions` 목록 user_id 필터 + `parse_session_key` 6파트/5파트
- `tests/dashboard/idor-ownership.test.ts` (+3 tests) — `/api/tasks/:id/detail` ownership 검사 타팀/자팀/superadmin

**프론트엔드 회귀 테스트 (5파일 신규):**

- `web/tests/regression/type-contract.test.ts` (12 tests)
- `web/tests/regression/access-policy-regression.test.ts` (6 tests)
- `web/tests/regression/cross-user-isolation.test.tsx` (5 tests)

#### 변경 파일

**백엔드 수정:** `src/dashboard/route-context.ts`, `src/dashboard/routes/session.ts`, `src/dashboard/routes/task.ts`, `src/events/types.ts`, `src/events/service.ts`, `src/dashboard/state-builder.ts`
**프론트엔드 수정:** `web/src/pages/workspace/memory.tsx`, `web/src/pages/workspace/agents.tsx`
**백엔드 테스트 보강:** `tests/dashboard/route-context.test.ts`, `tests/dashboard/session-route-ownership.test.ts`, `tests/dashboard/idor-ownership.test.ts`, `tests/events/workflow-event-service.test.ts`, `tests/dashboard/state-builder.test.ts`
**프론트엔드 신규 테스트:** `web/tests/regression/type-contract.test.ts`, `web/tests/regression/access-policy-regression.test.ts`, `web/tests/regression/cross-user-isolation.test.tsx`

#### Test Command

```bash
# 백엔드 직접 호출 테스트
npx vitest run tests/dashboard/route-context.test.ts tests/dashboard/session-route-ownership.test.ts tests/dashboard/idor-ownership.test.ts tests/events/workflow-event-service.test.ts tests/dashboard/state-builder.test.ts
npx eslint src/dashboard/route-context.ts src/dashboard/routes/session.ts src/dashboard/routes/task.ts src/dashboard/state-builder.ts src/events/service.ts src/events/types.ts --max-warnings=0
npx tsc --noEmit

# 프론트엔드 회귀 테스트
cd web && npx vitest run tests/regression/ tests/pages/admin/ tests/workspace/ tests/pages/chat-status-bar.test.tsx tests/layouts/root-sse-stale.test.tsx tests/pages/workflows/detail-badges.test.tsx tests/prompting/run-result-eval.test.tsx tests/pages/workflows/inspector-schema-badge.test.tsx tests/pages/access-policy.test.ts tests/hooks/use-page-access.test.ts
npx eslint src/pages/workspace/memory.tsx src/pages/workspace/agents.tsx --max-warnings=0
npx tsc --noEmit
```

#### Test Result

- 백엔드 `npx vitest run ...`: **5 files / 128 tests passed** (route-context 8, session-ownership 16, idor-ownership 22, workflow-event-service 42, state-builder 40)
- 프론트엔드 `npx vitest run ...`: **15 files / 145 tests passed**
- `npx eslint ...` (backend + frontend): **0 errors, 0 warnings**
- `npx tsc --noEmit` (backend + frontend): **통과**

#### Residual Risk

- 미수정 CRITICAL 4건 + HIGH 4건은 다음 이터레이션 대상 (위 테이블 참조)
- `workflow_events` 기존 레코드는 `user_id = ''` — 레거시 호환을 위해 프론트엔드 `!e.user_id` 조건으로 통과
- 이벤트 발행 caller에서 `user_id` 전달 수정이 추가 필요 (`orchestration/service.ts`, `phase-workflow.ts`)
- 프론트엔드 방어 필터는 2차 경계 — 1차 경계는 백엔드 `get_filter_user_id(ctx)`

