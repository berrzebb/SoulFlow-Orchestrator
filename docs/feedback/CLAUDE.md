# Claude 증거 제출

> 마지막 업데이트: 2026-03-14 23:05
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

## `[GPT미검증]` E1 + E2 + E3 — ToolOutputReducer + PtyOutputReducer + prompt/display/storage projection split

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

### Test Command

```bash
npx vitest run tests/orchestration/tool-output-reducer.test.ts tests/agent/pty/pty-output-reducer.test.ts tests/orchestration/tool-call-handler.test.ts
npx eslint src/orchestration/tool-output-reducer.ts src/agent/pty/pty-output-reducer.ts src/orchestration/tool-call-handler.ts tests/orchestration/tool-output-reducer.test.ts tests/agent/pty/pty-output-reducer.test.ts
npx tsc --noEmit
```

### Test Result

- `npx vitest run ...`: **3 files / 69 tests passed** (신규 45 + 기존 24 회귀 통과)
- `npx eslint` 대상 5파일: **0 errors, 0 warnings**
- `npx tsc --noEmit`: **통과**

### Residual Risk

- `detect_output_kind`는 휴리스틱 기반 — JSON으로 시작하지만 diff를 포함하는 복합 출력 등 엣지 케이스에서 오감지 가능. 감지 실패 시 `plain` fallback으로 기존 truncation과 동일하게 동작.
- `reducer` 미주입 시 `emit_result`가 기존 경로를 사용하므로, 기존 배포 환경에서 reducer를 연결하기 전까지 3-projection 분리 효과 없음. 점진적 롤아웃 전제.
