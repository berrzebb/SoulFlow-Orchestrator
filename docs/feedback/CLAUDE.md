# Claude 증거 제출

> 마지막 업데이트: 2026-03-14 19:10
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

## `[합의완료]` RP-5 + RP-6 — UI Migration + Golden Tests

### Claim

- RP-5: `list_roles()` API가 `PromptProfileCompiler` 경유로 마이그레이션. `RolePreset` 타입에 `use_when`, `not_use_for`, `preferred_model`, `shared_protocols`, `rendered_prompt` 추가. 프론트엔드 `applyRole()`이 soul+heart 수동 조립 대신 `rendered_prompt` 사용.
- RP-6: role resolve → compile → render 파이프라인의 golden test 17개. 4개 role archetype (concierge, implementer, reviewer, minimal) + coverage validation.

### 변경 파일

- `src/dashboard/ops/workflow.ts` (수정) — `list_roles()` compiler 경유, enriched 반환
- `src/dashboard/service.types.ts` (수정) — `list_roles()` 반환 타입 enrichment
- `web/src/pages/workflows/workflow-types.ts` (수정) — `RolePreset` 인터페이스 enrichment
- `web/src/pages/workflows/builder-modals.tsx` (수정) — `applyRole()` → `rendered_prompt` + `preferred_model` 사용
- `web/src/pages/workflows/inspector-params.tsx` (수정) — `applyRole()` 동일 마이그레이션
- `tests/dashboard/ops/workflow-ops.test.ts` (수정) — `list_roles()` enriched 필드 검증 + resolver 미매칭 fallback 테스트
- `tests/orchestration/role-protocol-golden.test.ts` (신규) — 17개 golden test

### Test Command

```bash
npx vitest run tests/dashboard/ops/workflow-ops.test.ts tests/orchestration/role-protocol-golden.test.ts tests/orchestration/prompt-profile-compiler.test.ts tests/orchestration/role-policy-resolver.test.ts tests/orchestration/protocol-resolver.test.ts tests/orchestration/service.test.ts
npx eslint src/dashboard/ops/workflow.ts src/dashboard/service.types.ts tests/dashboard/ops/workflow-ops.test.ts tests/orchestration/role-protocol-golden.test.ts
npx tsc --noEmit
```

### Test Result

- `npx vitest run ...`: **6 files / 129 tests passed**
- `npx eslint` 대상 4파일: **0 errors, 0 warnings**
- `npx tsc --noEmit`: **통과**

### Residual Risk

- `applyRole()`이 `rendered_prompt`를 `system_prompt`에 설정. phase-loop-runner는 `agent_def.system_prompt`를 직접 사용하므로, 기존 soul+heart 조립 대신 compiler 렌더링 결과가 사용됨. 동일 정보의 구조화된 표현이므로 의미적 회귀 없음.



