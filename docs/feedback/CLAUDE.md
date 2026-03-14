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

## EG-1 + EG-2 Session Reuse Policy + Budget Contract `[합의완료]`

### 증거 팩 1: session reuse policy + budget contract + config surface + 회귀 테스트

**claim**: EG-1 — `SessionEvidenceSnapshot` / `SearchReuseDecision` 타입, `normalize_query` (소문자+구두점 제거+공백 정규화), `compute_similarity` (Jaccard coefficient), `evaluate_reuse` (exact+fresh→reuse_summary, similar+fresh→same_topic, stale→stale_retry, no match→new_search), `EMPTY_EVIDENCE` 상수. EG-2 — `ExecutionBudgetPolicy` / `ToolCallBudgetState` 불변 상태 추적, `create_budget_state` / `is_budget_enabled` / `is_budget_exceeded` / `remaining_calls` / `record_tool_calls`, `DISABLED_POLICY` (0=무제한) / `STOP_REASON_BUDGET_EXCEEDED` 상수. Config surface — `orchestration.maxToolCallsPerRun` (min(0), default 0=비활성), `orchestration.freshnessWindowMs` (min(0), default 300_000=5분) Zod 스키마 + CONFIG_FIELDS meta + `OrchestratorConfig` 타입 + bootstrap 전파.

**changed files**:

- `src/orchestration/guardrails/session-reuse.ts` — 신규: `SessionEvidenceSnapshot`, `SearchReuseDecision`, `ReuseEvaluationOptions`, `DEFAULT_REUSE_OPTIONS`, `normalize_query`, `compute_similarity`, `evaluate_reuse`, `EMPTY_EVIDENCE`
- `src/orchestration/guardrails/budget-policy.ts` — 신규: `ExecutionBudgetPolicy`, `ToolCallBudgetState`, `DISABLED_POLICY`, `STOP_REASON_BUDGET_EXCEEDED`, `create_budget_state`, `is_budget_enabled`, `is_budget_exceeded`, `remaining_calls`, `record_tool_calls`
- `src/orchestration/guardrails/index.ts` — 신규: re-exports
- `src/config/schema.ts` — OrchestrationSchema에 `maxToolCallsPerRun`, `freshnessWindowMs` 추가
- `src/config/config-meta.ts` — CONFIG_FIELDS에 2개 필드 항목 추가
- `src/orchestration/service.ts` — `OrchestratorConfig`에 `max_tool_calls_per_run`, `freshness_window_ms` 추가
- `src/bootstrap/orchestration.ts` — config 매핑 2개 추가
- `tests/orchestration/guardrails/session-reuse.test.ts` — 신규 22 테스트: normalize 4, similarity 5, evaluate_reuse 13 (same-query 3, synonym 2, stale-vs-fresh 3, edge 5)
- `tests/orchestration/guardrails/budget-policy.test.ts` — 신규 15 테스트: policy 3, state 4, exceeded 3, disabled 3, constant 1, batch record 1
- `tests/config/config-defaults.test.ts` — 5 테스트 추가: 기본값 검증 2, 양수 허용 1, 음수 거부 2
- `tests/config/config-meta.test.ts` — C-18 default_value 일치 검증에 2 경로 추가

**test command**: `npm run lint && npx tsc --noEmit && npx vitest run tests/orchestration/guardrails/ tests/config/config-defaults.test.ts tests/config/config-meta.test.ts`

**test result**: `lint(eslint) 0 errors, tsc passed, 4 files / 65 tests passed`

**residual risk**:

- guardrails 모듈은 독립 계약 — orchestration 서비스 내부 호출부(EG-3 enforcement)는 Bundle EG2 범위
- `evaluate_reuse`의 Jaccard similarity는 단어 집합 기반 — 의미론적 유사도(embedding)는 향후 확장 가능하나 현재 범위 밖

