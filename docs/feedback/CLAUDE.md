# Claude 증거 제출

> 마지막 업데이트: 2026-03-14 22:42
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

## `[합의완료]` PAR-5 + PAR-6 — reconcile observability events + local read model + eval bundle

### Claim

- PAR-5: `src/orchestration/reconcile-trace.ts` (신규) — `ReconcileTraceEvent` (`reconcile_start` / `reconcile_conflict` / `reconcile_retry` / `reconcile_finalized`). `emit_reconcile_event(recorder, event, correlation, attributes)` — 기존 `"orchestration_run"` SpanKind 재사용, SpanKind enum 변경 없음. `filter_reconcile_spans(recorder)` — reconcile 이벤트 span만 필터링.
- PAR-6: `src/orchestration/reconcile-read-model.ts` (신규) — `ReconcileSummary`, `CriticSummary`, `ReconcileReadModel` 타입. `extract_reconcile_read_model(memory)` — `policy_applied` 키로 reconcile 노드 식별, `verdict`+`rounds_used`+`passed` 키로 critic_gate 노드 식별. `__rounds_used` 접미사 내부 추적 키 건너뜀. `has_failures`, `total_conflicts`, `unresolved_count` 집계.
- Eval bundle: `src/evals/parallel-conflict-executor.ts` (신규) — `reconcile` / `critic` / `read_model` 3가지 입력 타입. `src/evals/bundles.ts`에 `"parallel-conflict"` 번들 등록. `tests/evals/cases/parallel-conflict.json` — 16케이스 (reconcile 7 + critic 4 + read_model 5).

### 변경 파일

- `src/orchestration/reconcile-trace.ts` (신규) — PAR-5: trace event 헬퍼
- `src/orchestration/reconcile-read-model.ts` (신규) — PAR-6: local read model 추출
- `src/evals/parallel-conflict-executor.ts` (신규) — eval executor (3타입 라우팅)
- `src/evals/bundles.ts` (수정) — "parallel-conflict" 번들 등록
- `tests/orchestration/reconcile-trace.test.ts` (신규) — PAR-5 테스트 10개
- `tests/orchestration/reconcile-read-model.test.ts` (신규) — PAR-6 테스트 13개
- `tests/evals/parallel-conflict-executor.test.ts` (신규) — executor + bundle 테스트 20개
- `tests/evals/cases/parallel-conflict.json` (신규) — eval 데이터셋 16케이스

### Test Command

```bash
npx vitest run tests/orchestration/reconcile-trace.test.ts tests/orchestration/reconcile-read-model.test.ts tests/evals/parallel-conflict-executor.test.ts
npx eslint src/orchestration/reconcile-trace.ts src/orchestration/reconcile-read-model.ts src/evals/parallel-conflict-executor.ts tests/orchestration/reconcile-trace.test.ts tests/orchestration/reconcile-read-model.test.ts tests/evals/parallel-conflict-executor.test.ts
npx tsc --noEmit
```

### Test Result

- `npx vitest run ...`: **3 files / 43 tests passed**
- `npx eslint` 대상 6파일: **0 errors, 0 warnings**
- `npx tsc --noEmit`: **통과**

### Residual Risk

- `emit_reconcile_event`는 즉시 `handle.end("ok")`를 호출하므로 span duration이 항상 ~0ms. reconcile 파이프라인에서 실제 소요 시간을 측정하려면 caller가 start/end를 직접 관리해야 함.
- `extract_reconcile_read_model`의 노드 감지는 key presence 기반 — `policy_applied` 또는 `verdict`+`rounds_used`+`passed`가 우연히 일치하는 다른 노드가 있으면 오감지 가능. 워크플로우 memory 네임스페이스가 격리된 현재 설계에서는 문제 없음.

