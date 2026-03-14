# Claude 증거 제출

> 마지막 업데이트: 2026-03-15 14:45
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

## [GPT미검증] RPF-4 + RPF-5 — ValidatorPack + ArtifactBundle

### Claim

- RPF-4: `src/repo-profile/validator-pack.ts` (신규) — `ValidatorPack` (repo_id + validators 목록). `create_validator_pack(profile)` — capabilities에 선언된 kind만 포함, commands에 없으면 FALLBACK_COMMANDS(lint/typecheck/test) 사용, eval은 fallback 없음. `resolve_validator(pack, kind)` — kind 조회, 없으면 null. `has_validator(pack, kind)` — 존재 여부 확인. validators 순서: lint→typecheck→test→eval 고정.
- RPF-5: `src/repo-profile/artifact-bundle.ts` (신규) — `ArtifactBundle` (repo_id/created_at/changed_files/validator_results/eval_summary/residual_risks/patch). `create_artifact_bundle(input)` — created_at을 호출 시점 ISO 8601로 고정. `serialize_bundle` / `deserialize_bundle` — JSON 직렬화/역직렬화, 필수 필드 없으면 throw, 잘못된 항목은 필터링. `is_bundle_passing(bundle)` — 모든 validator_results가 passed이면 true.
- 통합: `src/repo-profile/index.ts` (수정) — RPF-4+5 exports 추가.

### 변경 파일

- `src/repo-profile/validator-pack.ts` (신규) — RPF-4: ValidatorPack 계약 + 팩토리
- `src/repo-profile/artifact-bundle.ts` (신규) — RPF-5: ArtifactBundle 계약 + 직렬화
- `src/repo-profile/index.ts` (수정) — RPF-4+5 barrel export 추가
- `tests/repo-profile/validator-pack.test.ts` (신규) — RPF-4 테스트 12개
- `tests/repo-profile/artifact-bundle.test.ts` (신규) — RPF-5 테스트 18개

### Test Command

```bash
npx vitest run tests/repo-profile/validator-pack.test.ts tests/repo-profile/artifact-bundle.test.ts
npx eslint src/repo-profile/validator-pack.ts src/repo-profile/artifact-bundle.ts src/repo-profile/index.ts tests/repo-profile/validator-pack.test.ts tests/repo-profile/artifact-bundle.test.ts
npx tsc --noEmit
```

### Test Result

- `npx vitest run ...`: **2 files / 31 tests passed** (RPF-4:12, RPF-5:19)
- `npx eslint ...`: **0 errors, 0 warnings**
- `npx tsc --noEmit`: **통과**

### Residual Risk

- `create_validator_pack()`은 capability 선언 여부만 확인하므로 eval capability가 있고 command도 없으면 validator가 생성되지 않음 — caller가 capability와 command를 함께 제공해야 함.
- `deserialize_bundle()`은 JSON.parse 실패를 그대로 throw — caller가 try/catch로 감싸야 함.
- `create_artifact_bundle()`은 `created_at` 미제공 시 호출 시점의 ISO 8601을 사용. 고정값이 필요하면 `created_at` 필드로 직접 주입 가능.