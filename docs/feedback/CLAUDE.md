# Claude 증거 제출

> 마지막 업데이트: 2026-03-15 01:10
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

## [합의완료] F1 + F2 — Provider Error Taxonomy + Acceptance Rubric

### Claim

- F1: `src/quality/provider-error-taxonomy.ts` (신규) — `ProviderErrorCode` 8종 canonical taxonomy. `classify_provider_error(message, code?)` — 세 어댑터 중복 분류 통합. `from_pty_error_code(pty_code)` — PTY 하위 호환 변환. `PROVIDER_ERROR_LABELS` — 내부 코드와 분리된 사용자 표시 레이블.
- F1 통합: `src/agent/pty/cli-adapter.ts` (수정) — `map_claude_error_code()`, `map_codex_error_code()`, `map_gemini_error_code()` 3개 중복 함수 삭제. `map_error_code()` + `to_pty_code()` 브리지로 교체. PTY 내부 `ErrorCode` 타입 유지로 하위 호환.
- F2: `src/quality/acceptance-rubric.ts` (신규) — `RubricVerdict` (pass/warn/fail). `AcceptanceRubric` (차원별 임계값 + fallback). `apply_rubric(scorecard, rubric)` → `RubricResult`. `DEFAULT_RUBRIC` (pass_at=0.8, warn_at=0.5). 최악 verdict 우선(fail > warn > pass).

### 변경 파일

- `src/quality/provider-error-taxonomy.ts` (신규) — F1: canonical provider error taxonomy
- `src/quality/acceptance-rubric.ts` (신규) — F2: scorecard → pass/warn/fail rubric
- `src/quality/index.ts` (신규) — F1+F2 exports
- `src/agent/pty/cli-adapter.ts` (수정) — F1: 3개 중복 map_*_error_code() 통합
- `tests/quality/provider-error-taxonomy.test.ts` (신규) — F1 테스트 32개
- `tests/quality/acceptance-rubric.test.ts` (신규) — F2 테스트 11개

### GPT 반려 해소

- `claim-drift [major]`: `classify_provider_error()`의 billing 패턴에서 `quota.*exceeded` 제거 → `rate_limited` 패턴으로 이동. billing은 `billing|quota.*(month|day|week|annual|account|plan)|insufficient.*fund|payment.*required`로 축소. "quota exceeded" 단독은 rate_limit으로 올바르게 복원.
- `test-gap [major]`: "context window exceeded"가 regex에 없어 `fatal`로 떨어지는 버그 수정 → context_overflow 패턴에 `context.*window` 추가. `tests/agent/pty/cli-adapter.test.ts` Test Command에 포함.

### Test Command

```bash
npx vitest run tests/quality/ tests/agent/pty/cli-adapter.test.ts
npx eslint src/quality/provider-error-taxonomy.ts src/quality/acceptance-rubric.ts src/quality/index.ts src/agent/pty/cli-adapter.ts tests/quality/provider-error-taxonomy.test.ts tests/quality/acceptance-rubric.test.ts
npx tsc --noEmit
```

### Test Result

- `npx vitest run tests/quality/ tests/agent/pty/cli-adapter.test.ts`: **3 files / 163 tests passed**
- `npx eslint ...`: **0 errors, 0 warnings**
- `npx tsc --noEmit`: **통과**

### Residual Risk

- `to_pty_code()`의 `ProviderErrorCode → ErrorCode` 매핑은 PTY 내부 타입을 유지하기 위한 경계 브리지. 향후 PTY가 `ProviderErrorCode`를 직접 사용하도록 마이그레이션하면 제거 가능.
- `classify_provider_error()`는 정규식 기반 — 공급자별 비정형 에러 메시지에서 오감지 가능. `from_pty_error_code()` 경로는 명시적 매핑으로 안전.
- billing vs rate_limit 경계: `quota.*exceeded` 단독은 rate_limited, 기간/계정 컨텍스트(`month|day|annual|account|plan`)가 있을 때만 billing으로 분류.

---

## [합의완료] E4 + E5 — MemoryIngestionReducer + OutputReductionKpi

### Claim

- E4: `src/orchestration/memory-ingestion-reducer.ts` (신규) — `MemoryIngestionReducer` 인터페이스 + `create_memory_ingestion_reducer(max_prompt_chars)`. 내부적으로 `ToolOutputReducer`에 위임, kind-aware 보존 정책 적용: `plain` → `display_text` (2× — 관대한 보존), noisy (shell/log/test/json/diff/table) → `storage_text` (1.5× — 압축).
- E4 연결: `src/orchestration/turn-memory-recorder.ts` (수정) — `record_turn_to_daily`에 옵셔널 `reducer?: MemoryIngestionReducer` 파라미터 추가. 제공 시 `reducer.reduce(bot_text)` 경로, 미제공 시 기존 `truncate(bot_text)` fallback — 하위 호환.
- E5: `src/orchestration/output-reduction-kpi.ts` (신규) — `OutputReductionKpi` 인터페이스 + `create_output_reduction_kpi()`. `record(stat)` → count/chars/overflow/kind_counts 누적. `summary()` → `overall_ratio = reduced/raw`, 방어 복사. `reset()`. `stat_from_reduced(reduced)` 헬퍼 — `prompt_text.length`를 `reduced_chars`로 사용.
- E5 평가: `src/evals/output-reduction-executor.ts` (신규) — `create_output_reduction_executor()` (mode: tool/memory), `create_output_reduction_scorer()`. `tests/evals/cases/output-reduction.json` (13 케이스). `src/evals/bundles.ts`에 `output-reduction` 번들 등록 (smoke: true).

### 변경 파일

- `src/orchestration/memory-ingestion-reducer.ts` (신규) — E4: kind-aware 보존 어댑터
- `src/orchestration/output-reduction-kpi.ts` (신규) — E5: chars 절감 KPI accumulator
- `src/orchestration/turn-memory-recorder.ts` (수정) — E4: reducer 주입 + fallback 보존
- `src/evals/output-reduction-executor.ts` (신규) — E5: 회귀 평가 executor + scorer
- `tests/evals/cases/output-reduction.json` (신규) — E5: 13 케이스 (smoke)
- `src/evals/bundles.ts` (수정) — E5: output-reduction 번들 등록
- `tests/orchestration/memory-ingestion-reducer.test.ts` (신규) — E4 테스트 13개 (recorder 하위 호환 포함)
- `tests/orchestration/output-reduction-kpi.test.ts` (신규) — E5 테스트 13개
- `scripts/eval-run.ts` (수정) — output-reduction executor + BUNDLE_SCORER_MAP 등록
- `src/channels/session-recorder.ts` (수정) — `is_delivery_retry()` 메서드 (Bonus Fix)
- `src/channels/manager.ts` (수정) — delivery retry early-exit 체크 (Bonus Fix)
- `tests/channel/channel-manager.test.ts` (수정) — `scoped_team_id` 4번째 인자 기대값 반영 + 미사용 import/param/var 제거 (lint clean)
- `tests/channel/session-recorder.test.ts` (수정) — `is_delivery_retry()` 7개 직접 테스트 추가

### Test Command

```bash
npx vitest run tests/orchestration/memory-ingestion-reducer.test.ts tests/orchestration/output-reduction-kpi.test.ts tests/channel/channel-manager.test.ts tests/channel/session-recorder.test.ts
npx eslint tests/channel/channel-manager.test.ts tests/channel/session-recorder.test.ts
npx tsc --noEmit
npx tsx scripts/eval-run.ts --bundle output-reduction --threshold 100
```

### Test Result

- `npx vitest run ...`: **4 files / 219 tests passed** (7 is_delivery_retry 신규 + 33 session-recorder + 106 E4+E5+channel-manager)
- `npx eslint ...`: **0 errors, 0 warnings**
- `npx tsc --noEmit`: **통과**
- `npx tsx scripts/eval-run.ts --bundle output-reduction --threshold 100`: **13/13 (100%)**

### Residual Risk

- `is_delivery_retry()` window(3초)는 보수적으로 설정. Slack retry 간격보다 짧으면 정상 재전송도 차단될 수 있으나, 실측 데이터(0.9~2.8초)로는 충분한 여유. 설정 값 노출 고려 가능.

---

## 최근 완료 증거 — E1 + E2 + E3

### Claim

- E1: `src/orchestration/tool-output-reducer.ts` (신규) — `ToolOutputKind` (plain/shell/test/json/diff/log/table), `ReducedOutput`, `ToolOutputReducer`. `detect_output_kind(tool_name, text)` — 패턴 기반 kind 감지. `create_tool_output_reducer(max_prompt_chars)` — factory. `is_error=true` 시 pass-through. kind별 `prompt_text` (LLM용, max_chars), `display_text` (표시용, 2×), `storage_text` (저장용, 1.5×). JSON 파싱 실패 → plain fallback. `truncate_half` — 기존 `truncate_tool_result` 동작 보존.
- E2: `src/agent/pty/pty-output-reducer.ts` (신규) — `PtyOutputReducer`. `create_pty_output_reducer(max_chars)`. `assistant_chunk`: MAX_CHUNK_CHARS(10,000) 크기 가드. `tool_result`: ToolOutputReducer.prompt_text 적용. `complete`: SOFT_MAX(5×max_chars) 초과 시에만 soft compaction. 그 외 pass-through.
- E3: `src/orchestration/tool-call-handler.ts` (수정) — `ToolCallHandlerDeps.reducer?: ToolOutputReducer` 추가. `emit_result` 내부에서 reducer 제공 시 prompt/display/storage 3-projection 분리. 미제공 시 기존 `truncate_tool_result` 동작으로 fallback — 기존 24개 테스트 영향 없음.

### 변경 파일

- `src/orchestration/tool-output-reducer.ts` (신규) — E1: kind 감지 + 3-projection reducer
- `src/agent/pty/pty-output-reducer.ts` (신규) — E2: PTY normalized output reducer
- `src/orchestration/tool-call-handler.ts` (수정) — E3: reducer 주입 + 3-projection 분리
- `tests/orchestration/tool-output-reducer.test.ts` (신규) — E1 테스트 31개
- `tests/agent/pty/pty-output-reducer.test.ts` (신규) — E2 테스트 14개
- `tests/orchestration/tool-call-handler.test.ts` (수정) — E3 reducer 주입 경로 테스트 4개 추가 + 기존 미사용 import/파라미터 정리

### GPT 반려 해소

- `test-gap [major]`: `tests/orchestration/tool-call-handler.test.ts`에 reducer 주입 케이스 4개 추가 — (1) `on_tool_event.result = prompt_text` (max=50 강제 truncate로 검증), (2) `on_tool_block = display_text` 기반 블록, (3) `log_event.detail = storage_text ≤ 500자`, (4) `is_error=true → reducer 미사용, 에러 전체 보존`.

### Test Command

```bash
npx vitest run tests/orchestration/tool-output-reducer.test.ts tests/agent/pty/pty-output-reducer.test.ts tests/orchestration/tool-call-handler.test.ts
npx eslint src/orchestration/tool-output-reducer.ts src/agent/pty/pty-output-reducer.ts src/orchestration/tool-call-handler.ts tests/orchestration/tool-output-reducer.test.ts tests/agent/pty/pty-output-reducer.test.ts tests/orchestration/tool-call-handler.test.ts
npx tsc --noEmit
```

### Test Result

- `npx vitest run ...`: **3 files / 73 tests passed** (신규 49 + 기존 24 → 이전 69+4)
- `npx eslint` 대상 6파일: **0 errors, 0 warnings**
- `npx tsc --noEmit`: **통과**

### Residual Risk

- `detect_output_kind`는 휴리스틱 기반 — JSON으로 시작하지만 diff를 포함하는 복합 출력 등 엣지 케이스에서 오감지 가능. 감지 실패 시 `plain` fallback으로 기존 truncation과 동일하게 동작.
- `reducer` 미주입 시 `emit_result`가 기존 경로를 사용하므로, 기존 배포 환경에서 reducer를 연결하기 전까지 3-projection 분리 효과 없음. 점진적 롤아웃 전제.


