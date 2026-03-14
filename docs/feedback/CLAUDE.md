# Claude 증거 제출

> 마지막 업데이트: 2026-03-14 21:52
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

## `[합의완료]` PAR-1 + PAR-2 — ParallelResultEnvelope + ConflictSet + DeterministicReconcilePolicy + ReconcileNode

### Claim

- PAR-1: `src/orchestration/parallel-contracts.ts` (신규) — `ParallelAgentResult`, `ParallelResultEnvelope`, `ConflictField`, `ConflictSet` 타입. `build_parallel_envelope()` (성공/실패 계수), `detect_conflicts()` (content 또는 parsed 필드별 충돌 감지, 에러 결과 제외, consensus 필드 분리).
- PAR-2: `src/orchestration/reconcile-policy.ts` (신규) — `DeterministicReconcilePolicy` (`majority_vote` / `first_wins` / `last_wins` / `merge_union`). `apply_reconcile_policy(envelope, policy, conflict_set?)` — 동일 입력 → 동일 출력 결정론적 보장. `merge_union`은 parsed 객체 필드 합집합, content는 배열 합산.
- PAR-2 Node: `src/agent/nodes/reconcile.ts` (신규) — `ReconcileNodeDefinition` (source_node_ids, policy, use_parsed?). memory에서 source 노드 결과 수집 → envelope → conflict 감지 → policy 적용 → reconciled/conflicts/policy_applied/succeeded/failed 출력.
- `src/agent/workflow-node.types.ts` (수정) — `ReconcileNodeDefinition` 추가, `OrcheNodeType`에 `"reconcile"` 추가, `OrcheNodeDefinition` union에 추가.
- `src/agent/nodes/index.ts` (수정) — `reconcile_handler` import + 등록.

### 변경 파일

- `src/orchestration/parallel-contracts.ts` (신규) — PAR-1: 10 함수/타입
- `src/orchestration/reconcile-policy.ts` (신규) — PAR-2: 정책 + 적용 함수
- `src/agent/nodes/reconcile.ts` (신규) — PAR-2 노드 핸들러
- `src/agent/workflow-node.types.ts` (수정) — ReconcileNodeDefinition + OrcheNodeType
- `src/agent/nodes/index.ts` (수정) — reconcile_handler 등록
- `tests/orchestration/parallel-contracts.test.ts` (신규) — PAR-1 테스트 10개
- `tests/orchestration/reconcile-policy.test.ts` (신규) — PAR-2 정책 테스트 11개
- `tests/agent/nodes/reconcile.test.ts` (신규) — ReconcileNode 통합 테스트 9개

### Test Command

```bash
npx vitest run tests/orchestration/parallel-contracts.test.ts tests/orchestration/reconcile-policy.test.ts tests/agent/nodes/reconcile.test.ts
npx eslint src/orchestration/parallel-contracts.ts src/orchestration/reconcile-policy.ts src/agent/nodes/reconcile.ts tests/orchestration/parallel-contracts.test.ts tests/orchestration/reconcile-policy.test.ts tests/agent/nodes/reconcile.test.ts
npx tsc --noEmit
```

### Test Result

- `npx vitest run ...`: **3 files / 30 tests passed**
- `npx eslint` 대상 6파일: **0 errors, 0 warnings**
- `npx tsc --noEmit`: **통과**

### Residual Risk

- `majority_vote` 동수(tie) 시 첫 번째 등장 값 선택 — 입력 순서가 결과에 영향. `source_node_ids` 순서가 결정론성의 기준.
- `merge_union`은 consensus 필드를 먼저 배치하고, 각 에이전트의 고유 필드를 등장 순서대로 추가합니다. 동일 필드가 여러 에이전트에 있으면 먼저 등장한 값이 우선 (덮어쓰지 않음). 나중 에이전트의 고유 키도 모두 결과에 포함됩니다.

## `[합의완료]` SO-6 + SO-7 — runtime/workflow/gateway binding + parser-repair regression artifact

### Claim

- SO-6a: `src/orchestration/output-contracts.ts` — `SchemaValidationError`, `SchemaRepairResult`, `normalize_json_text`, `validate_schema`, `validate_json_output`, `run_schema_repair`, `DEFAULT_MAX_REPAIR_ATTEMPTS`, `format_repair_prompt`를 단일 진입점으로 re-export. gateway/runtime/workflow 레이어가 schema 모듈을 직접 import하지 않고 output-contracts를 통해 접근 가능.
- SO-6b: `src/orchestration/execution/phase-workflow.ts` — `generate_dynamic_workflow`의 LLM 응답 파싱 경로에 `normalize_json_text` 바인딩. 코드 펜스 포함 응답도 정상 파싱됨 (`normalize_json_text(response).match(...)`).
- SO-7: `tests/orchestration/parser-repair-regression.test.ts` (신규 20 tests) — OutputParserRegistry(SO-3) + SchemaValidator(SO-4) + SchemaRepairLoop(SO-5)의 통합 파이프라인 regression suite. Stage 1-5로 구성: normalize→parse, validate_json_output, parse→validate chain, run_schema_repair end-to-end, custom parser + schema 통합. SO-6 binding (output-contracts re-export 동일성)도 포함.

### GPT 반려 해소

- `test-gap` + `needs-evidence`: `tests/orchestration/phase-workflow.test.ts`에 code-fence LLM 응답이 `generate_dynamic_workflow`를 통해 정상 파싱됨을 직접 검증하는 테스트 1개 추가 — ` ```json\n{...}\n``` ` 형태 응답 → `normalize_json_text` 펜스 제거 → preview 반환 확인.

### 변경 파일

- `src/orchestration/output-contracts.ts` (수정) — SO-6a: schema 모듈 re-export 추가
- `src/orchestration/execution/phase-workflow.ts` (수정) — SO-6b: normalize_json_text 바인딩
- `tests/orchestration/parser-repair-regression.test.ts` (신규) — SO-7 regression 20개
- `tests/orchestration/phase-workflow.test.ts` (수정) — SO-6b code-fence 경로 직접 검증 1개 추가

### Test Command

```bash
npx vitest run tests/orchestration/schema-validator.test.ts tests/orchestration/schema-repair-loop.test.ts tests/orchestration/output-contracts.test.ts tests/orchestration/output-parser-registry.test.ts tests/orchestration/parser-repair-regression.test.ts tests/orchestration/phase-workflow.test.ts tests/agent/phase-loop-runner-nodes.test.ts tests/agent/phase-loop-runner.test.ts tests/agent/nodes/
npx eslint src/orchestration/output-contracts.ts src/orchestration/execution/phase-workflow.ts tests/orchestration/parser-repair-regression.test.ts tests/orchestration/phase-workflow.test.ts
npx tsc --noEmit
```

### Test Result

- `npx vitest run ...`: **170 files / 2,968 tests passed**
- `npx eslint` 대상 4파일: **0 errors, 0 warnings**
- `npx tsc --noEmit`: **통과**

### Residual Risk

- `phase-workflow.ts`의 `normalize_json_text` 적용은 전체 응답이 코드 펜스인 경우에만 펜스 제거. 본문 중간에 코드 블록이 섞인 경우는 regex `match`가 담당.

## `[합의완료]` SO-4 + SO-5 — SchemaChain Validator/Normalizer + Bounded SchemaRepairLoop

### GPT 반려 해소

- `test-gap`: `tests/agent/phase-loop-runner-nodes.test.ts`에 통합 테스트 3개 추가 — (1) invalid initial 응답 시 `run_headless` 재호출 총 3회(초기 + repair 2회) 확인, (2) 항상 invalid인 경우 `DEFAULT_MAX_REPAIR_ATTEMPTS(2)` 바운딩에서 중단 + 호출 횟수 3회 확인, (3) repair retry 메시지에 assistant content + "schema validation errors" 피드백 포함 확인.

### Claim

- SO-4: `src/orchestration/schema-validator.ts` — JSON Schema 검증 + JSON 텍스트 정규화를 독립 모듈로 추출. `validate_schema(data, schema)` 순수 함수로 object/array/string/number/integer/null/enum 지원. `normalize_json_text(raw)` 로 코드 펜스(` ```json ``` `) 자동 제거. `validate_json_output(raw, schema)` 로 파싱 + 검증 한 번에 수행. 기존 도구 클래스(`JsonSchemaTool`, `ValidatorTool`)의 private 검증 로직과 동일하나, 파이프라인 어디서든 사용 가능한 독립 함수로 분리.
- SO-5: `src/orchestration/schema-repair-loop.ts` — `run_schema_repair(retry, schema, initial_content, max_attempts?)` 바운딩된 수리 루프. 초기 LLM 응답을 `validate_json_output`으로 검증하고, 에러 시 `format_repair_prompt`로 에러 피드백 프롬프트를 생성하여 `retry` 콜백으로 LLM 재호출. `DEFAULT_MAX_REPAIR_ATTEMPTS = 2`. 소비자로부터 LLM 호출 방식을 분리 (콜백 패턴). `phase-loop-runner.ts`의 `invoke_llm`에 통합 — `output_json_schema` 지정 시 자동으로 repair loop 진입, 기존 `parse_output("json", ...)` 대체.

### 변경 파일

- `src/orchestration/schema-validator.ts` (신규) — SO-4 스키마 검증 + 정규화
- `src/orchestration/schema-repair-loop.ts` (신규) — SO-5 바운딩된 수리 루프
- `src/agent/phase-loop-runner.ts` (수정) — `invoke_llm` 내 `parse_output("json", ...)` → `run_schema_repair(...)` 교체. import 변경.
- `tests/orchestration/schema-validator.test.ts` (신규) — SO-4 테스트 23개
- `tests/orchestration/schema-repair-loop.test.ts` (신규) — SO-5 테스트 12개
- `tests/agent/phase-loop-runner-nodes.test.ts` (수정) — invoke_llm repair loop 통합 테스트 3개 추가

### Test Command

```bash
npx vitest run tests/orchestration/schema-validator.test.ts tests/orchestration/schema-repair-loop.test.ts tests/orchestration/output-contracts.test.ts tests/orchestration/output-parser-registry.test.ts tests/agent/phase-loop-runner-nodes.test.ts tests/agent/phase-loop-runner.test.ts tests/agent/nodes/
npx eslint src/orchestration/schema-validator.ts src/orchestration/schema-repair-loop.ts src/agent/phase-loop-runner.ts tests/orchestration/schema-validator.test.ts tests/orchestration/schema-repair-loop.test.ts
npx tsc --noEmit
```

### Test Result

- `npx vitest run ...`: **168 files / 2,938 tests passed**
- `npx eslint` 대상 6파일: **0 errors, 0 warnings**
- `npx tsc --noEmit`: **통과**

### Residual Risk

- `ai-agent.ts`는 `spawn_agent` + `wait_agent` 경로를 사용하므로 repair loop 미적용. 에이전트 스폰 방식에서는 재프롬프팅이 불가하여 의도된 동작.
- `invoke_llm`의 repair loop에서 retry 시 `run_headless`가 추가 호출됨. `DEFAULT_MAX_REPAIR_ATTEMPTS = 2` 바운딩으로 최대 3회(초기 + 2 retry) 호출 제한.



