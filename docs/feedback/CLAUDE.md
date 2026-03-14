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

## EG-3 + EG-4 Reuse Integration + Hard Enforcement `[합의완료]`

### 증거 팩: session reuse dispatcher short-circuit + budget enforcement + runner parity

**claim**: EG-3 — `build_session_evidence`, `format_reuse_reply`, `execute-dispatcher`에 session reuse short-circuit (`const { mode } = decision;` 이후, `if (mode !== "phase")` 가드 — once/agent/task 모드에서만 판단, `stop_reason: session_reuse:{kind}`로 조기 종료). EG-4 — `BudgetTracker` mutable counter, `tool-call-handler` pre-check + `budget.used` 증가, 4개 runner parity (run-once, run-agent-loop, run-task-loop, continue-task-loop) — legacy handler budget 전달 + native 사후 `stop_reason`, `OrchestrationResult.stop_reason`, config 전파.

**changed files**:

- `src/orchestration/guardrails/enforcement.ts` — 신규: `build_session_evidence`, `format_reuse_reply`, `BudgetTracker`, `create_budget_tracker`, `is_over_budget`, `remaining_budget`
- `src/orchestration/guardrails/index.ts` — re-exports 추가
- `src/orchestration/types.ts` — `OrchestrationResult.stop_reason?: string` 추가
- `src/orchestration/execution/runner-deps.ts` — `RunnerDeps.config`에 `max_tool_calls_per_run`, `freshness_window_ms` 추가
- `src/orchestration/execution/execute-dispatcher.ts` — session reuse short-circuit (`mode !== "phase"` 가드 포함)
- `src/orchestration/tool-call-handler.ts` — `budget?: BudgetTracker` 파라미터, pre-check + 증가
- `src/orchestration/service.ts` — `_runner_deps().config`, `_dispatch_deps().config` 전파
- `src/orchestration/execution/run-once.ts` — budget tracker + handler 전달 + stop_reason
- `src/orchestration/execution/run-agent-loop.ts` — budget tracker + check_should_continue + stop_reason
- `src/orchestration/execution/run-task-loop.ts` — budget tracker + native sync + stop_reason
- `src/orchestration/execution/continue-task-loop.ts` — budget tracker + native sync + stop_reason
- `tests/orchestration/guardrails/enforcement.test.ts` — 신규 19 테스트
- `tests/orchestration/execution/run-once-mock-tool-handler.test.ts` — `make_deps()` config 추가 (회귀 수정)

**test command**: `npm run lint && npx tsc --noEmit && npx vitest run tests/orchestration/guardrails/ tests/orchestration/execute-dispatcher.test.ts tests/orchestration/execution/`

**test result**: `lint 0 errors, tsc passed, guardrails 3 files / 56 tests passed, dispatcher+execution 14 files / 177 tests passed — 전부 녹색`

**residual risk**:

- native 백엔드 경로는 자체 tool loop 관리 → handler 레벨 budget 차단 불가, 사후 `stop_reason`만 설정 (정보성)
- session reuse short-circuit는 `freshness_window_ms > 0`일 때만 활성 — config에서 0 설정 시 비활성

**GPT [계류] 수정 사항**:

- `claim-drift` 수정: session reuse short-circuit를 `const { mode } = decision;` 이후로 이동, `if (mode !== "phase")` 가드 추가 → phase 경로 차단 불가 보장 (execute-dispatcher.ts L116)
- `test-gap` 수정: `run-once-mock-tool-handler.test.ts`의 `make_deps()`에 `config` 객체 추가 (`max_tool_calls_per_run: 0, freshness_window_ms: 0`) → 3/3 테스트 녹색 복구

