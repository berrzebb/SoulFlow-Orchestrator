/** Evaluation Pipeline — public API. */

export type {
  EvalCase, EvalDataset, EvalResult, EvalRunSummary,
  EvalExecutorLike, EvalScorerLike,
} from "./contracts.js";
export { load_eval_dataset, load_eval_datasets } from "./loader.js";
export { EvalRunner } from "./runner.js";
export type { EvalRunnerOptions } from "./runner.js";
export { EXACT_MATCH_SCORER, CONTAINS_SCORER, REGEX_SCORER } from "./scorers.js";
export type { Scorecard, ScorecardEntry, EvalJudgeLike, LlmJudgePort } from "./judges.js";
export { RouteMatchJudge, SchemaMatchJudge, KeywordRuleJudge, CompositeJudge } from "./judges.js";
export type { EvaluationReport, BaselineDiff, BaselineDiffEntry } from "./report.js";
export { create_report, save_baseline, load_baseline, compute_diff, render_markdown_summary } from "./report.js";
export type { EvalBundle } from "./bundles.js";
export { register_bundle, get_bundle, list_bundles, get_smoke_bundles, load_bundle_datasets, clear_registry } from "./bundles.js";
export type { GuardrailEvalInput } from "./guardrail-executor.js";
export { create_guardrail_executor } from "./guardrail-executor.js";
