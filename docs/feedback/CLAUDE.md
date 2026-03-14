# Claude 증거 제출

> 마지막 업데이트: 2026-03-14
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

## EG-5 Guardrail Observability + Eval Fixture `[합의완료]`

### 증거 팩: guardrail decision → observability metrics + eval pipeline + CLI 연결

**claim**: EG-5 — `record_guardrail_metrics` 함수 (`stop_reason` 파싱 → `guardrail_session_reuse_total{kind, provider}`, `guardrail_budget_exceeded_total{provider, mode}` counters 방출), `service.ts`에서 `execute_dispatch` + `continue_task_loop` 결과에 대해 호출 + span attributes에 `stop_reason` 추가, `create_guardrail_executor` (guardrail 결정 함수를 `EvalExecutorLike`로 어댑팅 — session_reuse/budget 두 타입, JSON input 파싱), `scripts/eval-run.ts`에서 `EXECUTOR_MAP`으로 번들별 executor 라우팅 (`guardrails` → `create_guardrail_executor`), `tests/evals/cases/guardrails.json` 8개 케이스 (reuse 4 + budget 4), `guardrails` 번들 등록 (smoke: true), CLI `--bundle guardrails --scorer exact --threshold 100` → 4/4 통과 (smoke 태그 필터).

**changed files**:

- `src/orchestration/guardrails/observability.ts` — 신규: `record_guardrail_metrics`
- `src/orchestration/guardrails/index.ts` — `record_guardrail_metrics` re-export 추가
- `src/orchestration/service.ts` — `_record_guardrail_metrics` → `record_guardrail_metrics` 위임, span에 `stop_reason` attribute 추가, resume 경로에도 메트릭 방출
- `src/evals/guardrail-executor.ts` — 신규: `create_guardrail_executor`, `GuardrailEvalInput` 타입
- `src/evals/index.ts` — `guardrail-executor` re-exports 추가
- `src/evals/bundles.ts` — `guardrails` 번들 등록
- `scripts/eval-run.ts` — `EXECUTOR_MAP` + `resolve_executor()` 추가, per-dataset executor 선택
- `tests/evals/cases/guardrails.json` — 신규: 8개 eval 케이스
- `tests/orchestration/guardrails/observability.test.ts` — 신규 7 테스트
- `tests/evals/guardrail-executor.test.ts` — 신규 12 테스트
- `tests/evals/eval-run-cli.test.ts` — `--bundle guardrails` CLI 회귀 테스트 추가

**test command**: `npm run lint && npx tsc --noEmit && npx vitest run tests/orchestration/guardrails/ tests/evals/guardrail-executor.test.ts tests/evals/bundles.test.ts && npx tsx scripts/eval-run.ts --bundle guardrails --scorer exact --threshold 100`

**test result**: `lint 0 errors, tsc passed, 6 files / 86 tests passed, CLI guardrails 4/4 (100%) threshold met, eval-run-cli.test.ts 18/18 passed`

**residual risk**:

- `same_topic` eval 케이스는 `similarity_threshold: 0.7`을 명시적으로 지정 — 기본값 0.85에서는 짧은 한글 쿼리로 same_topic 트리거 어려움 (Jaccard 특성)
- guardrail metrics는 `service.ts` execute/resume 경로에서만 방출 — 직접 runner 호출 시 metrics 미기록
- CLI bundle 태그 필터로 8개 중 4개(smoke)만 실행 — 나머지 4개는 단위 테스트에서만 검증

