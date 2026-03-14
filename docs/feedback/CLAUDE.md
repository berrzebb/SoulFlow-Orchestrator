# Claude 증거 제출

> 마지막 업데이트: 2026-03-14 21:15
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

## `[GPT미검증]` SO-6 + SO-7 — runtime/workflow/gateway binding + parser-repair regression artifact

### Claim

- SO-6a: `src/orchestration/output-contracts.ts` — `SchemaValidationError`, `SchemaRepairResult`, `normalize_json_text`, `validate_schema`, `validate_json_output`, `run_schema_repair`, `DEFAULT_MAX_REPAIR_ATTEMPTS`, `format_repair_prompt`를 단일 진입점으로 re-export. gateway/runtime/workflow 레이어가 schema 모듈을 직접 import하지 않고 output-contracts를 통해 접근 가능.
- SO-6b: `src/orchestration/execution/phase-workflow.ts` — `generate_dynamic_workflow`의 LLM 응답 파싱 경로에 `normalize_json_text` 바인딩. 코드 펜스 포함 응답도 정상 파싱됨 (`normalize_json_text(response).match(...)`).
- SO-7: `tests/orchestration/parser-repair-regression.test.ts` (신규 20 tests) — OutputParserRegistry(SO-3) + SchemaValidator(SO-4) + SchemaRepairLoop(SO-5)의 통합 파이프라인 regression suite. Stage 1-5로 구성: normalize→parse, validate_json_output, parse→validate chain, run_schema_repair end-to-end, custom parser + schema 통합. SO-6 binding (output-contracts re-export 동일성)도 포함.

### 변경 파일

- `src/orchestration/output-contracts.ts` (수정) — SO-6a: schema 모듈 re-export 추가
- `src/orchestration/execution/phase-workflow.ts` (수정) — SO-6b: normalize_json_text 바인딩
- `tests/orchestration/parser-repair-regression.test.ts` (신규) — SO-7 regression 20개

### Test Command

```bash
npx vitest run tests/orchestration/schema-validator.test.ts tests/orchestration/schema-repair-loop.test.ts tests/orchestration/output-contracts.test.ts tests/orchestration/output-parser-registry.test.ts tests/orchestration/parser-repair-regression.test.ts tests/agent/phase-loop-runner-nodes.test.ts tests/agent/phase-loop-runner.test.ts tests/agent/nodes/
npx eslint src/orchestration/output-contracts.ts src/orchestration/execution/phase-workflow.ts tests/orchestration/parser-repair-regression.test.ts
npx tsc --noEmit
```

### Test Result

- `npx vitest run ...`: **169 files / 2,958 tests passed**
- `npx eslint` 대상 3파일: **0 errors, 0 warnings**
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

