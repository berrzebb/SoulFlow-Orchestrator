/** Execution Guardrails — public API. */

export type {
  SessionEvidenceSnapshot,
  SearchReuseDecision,
  ReuseEvaluationOptions,
} from "./session-reuse.js";
export {
  normalize_query,
  compute_similarity,
  evaluate_reuse,
  DEFAULT_REUSE_OPTIONS,
  EMPTY_EVIDENCE,
} from "./session-reuse.js";

export type {
  ExecutionBudgetPolicy,
  ToolCallBudgetState,
} from "./budget-policy.js";
export {
  STOP_REASON_BUDGET_EXCEEDED,
  DISABLED_POLICY,
  create_budget_state,
  is_budget_enabled,
  is_budget_exceeded,
  remaining_calls,
  record_tool_calls,
} from "./budget-policy.js";
