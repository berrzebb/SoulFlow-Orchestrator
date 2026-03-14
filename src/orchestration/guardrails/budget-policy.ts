/**
 * EG-2: Execution Budget Policy.
 *
 * run 전체 기준 tool call budget 계약.
 * - maxToolCallsPerRun: 0 = disabled (무제한)
 * - 성공/실패 모두 카운트
 * - turn budget과 독립적으로 동작
 */

/** 실행 budget 정책. config에서 파생. */
export interface ExecutionBudgetPolicy {
  /** run 전체 최대 tool 호출 수. 0 = 비활성 (무제한). */
  max_tool_calls_per_run: number;
}

/** run-wide tool call budget 런타임 상태. */
export interface ToolCallBudgetState {
  /** 현재까지 실행된 tool 호출 수 (성공+실패). */
  executed_count: number;
  /** 적용 중인 정책. */
  policy: ExecutionBudgetPolicy;
}

/** budget 초과 시 stop reason. */
export const STOP_REASON_BUDGET_EXCEEDED = "max_tool_calls_exceeded" as const;

/** 비활성 정책 (무제한). */
export const DISABLED_POLICY: ExecutionBudgetPolicy = { max_tool_calls_per_run: 0 };

/** budget state 생성. */
export function create_budget_state(policy: ExecutionBudgetPolicy): ToolCallBudgetState {
  return { executed_count: 0, policy };
}

/** budget 활성 여부. */
export function is_budget_enabled(policy: ExecutionBudgetPolicy): boolean {
  return policy.max_tool_calls_per_run > 0;
}

/** budget 초과 여부. disabled이면 항상 false. */
export function is_budget_exceeded(state: ToolCallBudgetState): boolean {
  if (!is_budget_enabled(state.policy)) return false;
  return state.executed_count >= state.policy.max_tool_calls_per_run;
}

/** 남은 tool call 수. disabled이면 Infinity. */
export function remaining_calls(state: ToolCallBudgetState): number {
  if (!is_budget_enabled(state.policy)) return Infinity;
  return Math.max(0, state.policy.max_tool_calls_per_run - state.executed_count);
}

/**
 * tool call 기록. count만큼 증가 (배치 호출 지원).
 * 원본을 변이하지 않고 새 state 반환.
 */
export function record_tool_calls(state: ToolCallBudgetState, count: number = 1): ToolCallBudgetState {
  return { ...state, executed_count: state.executed_count + count };
}
