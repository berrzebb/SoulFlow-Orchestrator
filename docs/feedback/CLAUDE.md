# Claude 증거 제출

> 마지막 업데이트: 2026-03-14 18:48
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

## `[합의완료]` RP-3 + RP-4 — PromptProfileCompiler + Runtime Binding

### Claim

- RP-3: `PromptProfileCompiler` — `RolePolicyResolver` + `ProtocolResolver` 출력을 합성하여 `PromptProfile`(구조화된 중간 표현) 생성. `compile(role_id)` + `render_system_section(profile)` 계약.
- RP-4: `OrchestrationService`에 compiler 바인딩. `_build_system_prompt`의 role 경로에서 compiler를 통한 구조화된 프로필 합성으로 교체. concierge fallback도 compiler 경유.

### 변경 파일

- `src/orchestration/prompt-profile-compiler.ts` (신규) — `PromptProfile` 인터페이스, `PromptProfileCompilerLike` 계약, `create_prompt_profile_compiler()` 팩토리
- `src/orchestration/role-policy-resolver.ts` (수정) — `parse_description()` `string | undefined | null` 방어, `load_resource()` null path 방어, `normalize_role_policy()` tools/shared_protocols 기본값 `[]`
- `src/orchestration/service.ts` (수정) — compiler import, `_profile_compiler` 멤버 추가, 생성자에서 초기화, `_build_system_prompt` role 경로 교체
- `tests/orchestration/prompt-profile-compiler.test.ts` (신규) — 12개 테스트 (compile 6 + render 6)
- `tests/orchestration/service.test.ts` (수정) — role alias 테스트를 compiler 경로 검증으로 교체

### GPT 반려 해소

- `test-gap`: `parse_description(undefined)` → `undefined.match` 크래시 — `string | undefined | null` 타입 수정 + early return
- `claim-drift`: service test 2건 실패 — mock role skill에 `summary` 부재로 발생. `normalize_role_policy`에서 `tools`/`shared_protocols` 기본값 `[]` 추가 + service test를 compiler 경로 검증으로 업데이트

### Test Command

```bash
npx vitest run tests/orchestration/prompt-profile-compiler.test.ts tests/orchestration/service.test.ts tests/orchestration/main-alias-persona.test.ts tests/orchestration/service-mock-preflight.test.ts tests/orchestration/role-policy-resolver.test.ts
npx eslint src/orchestration/prompt-profile-compiler.ts src/orchestration/role-policy-resolver.ts src/orchestration/service.ts
npx tsc --noEmit
```

### Test Result

- `npx vitest run ...`: **5 files / 108 tests passed**
- `npx eslint` 대상 3파일: **0 errors, 0 warnings**
- `npx tsc --noEmit`: **통과**

### Residual Risk

- `_build_system_prompt` 내 role 경로가 `context_builder.build_role_system_prompt()` → compiler 기반으로 전환됨. 동일 정보를 렌더링하되 섹션 구조가 약간 다름. 기존 통합 테스트에서 `build_system_prompt`를 mock 처리하므로 런타임 회귀 위험은 낮음.


