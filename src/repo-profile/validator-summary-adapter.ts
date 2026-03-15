/**
 * RPF-4F+RPF-6: ArtifactBundle → ValidatorSummary 대시보드 표면 어댑터.
 * 집계 수치, 실패 목록, risk_tier, eval_score, next_task_hint 노출.
 */

import type { ArtifactBundle } from "./artifact-bundle.js";

export interface FailedValidatorEntry {
  readonly kind: string;
  readonly command: string;
  readonly output?: string;
}

export interface ValidatorSummary {
  readonly repo_id: string;
  readonly total_validators: number;
  readonly passed_validators: number;
  readonly failed_validators: readonly FailedValidatorEntry[];
  readonly artifact_bundle_id?: string;
  readonly created_at: string;
  /** RPF-6: 변경 표면의 최고 위험 등급. bundle.risk_tier에서 전달. */
  readonly risk_tier?: string;
  /** RPF-6: eval 통과율 (0~1). bundle.eval_summary.score에서 전달. */
  readonly eval_score?: number;
}

/** ArtifactBundle → ValidatorSummary 변환. */
export function adapt_bundle_to_summary(bundle: ArtifactBundle): ValidatorSummary {
  const failed: FailedValidatorEntry[] = bundle.validator_results
    .filter((r) => !r.passed)
    .map((r) => ({ kind: r.kind, command: r.command, output: r.output }));

  return {
    repo_id: bundle.repo_id,
    total_validators: bundle.validator_results.length,
    passed_validators: bundle.validator_results.filter((r) => r.passed).length,
    failed_validators: failed,
    artifact_bundle_id: bundle.eval_summary?.bundle_id,
    created_at: bundle.created_at,
    risk_tier: bundle.risk_tier,
    eval_score: bundle.eval_summary?.score,
  };
}

/**
 * RPF-6: ValidatorSummary 상태에서 다음 권장 작업 힌트 생성.
 * 실패 > 위험 > eval > 정상 순으로 우선순위 적용.
 */
export function next_task_hint(summary: ValidatorSummary): string {
  if (summary.failed_validators.length > 0) {
    return `Fix ${summary.failed_validators.length} failing validator(s): ${summary.failed_validators.map((v) => v.kind).join(", ")}`;
  }
  if (summary.risk_tier === "critical" || summary.risk_tier === "high") {
    return `Review high-risk changes (risk: ${summary.risk_tier}) before proceeding`;
  }
  if (summary.eval_score !== undefined && summary.eval_score < 0.8) {
    return `Improve eval score (current: ${Math.round(summary.eval_score * 100)}%) before merge`;
  }
  return "All validators passed — ready to proceed";
}

/** ValidatorSummary 배지 variant — 실패 수에 따라 ok/warn/err/off. */
export function validator_badge_variant(summary: ValidatorSummary): "ok" | "warn" | "err" | "off" {
  if (summary.total_validators === 0) return "off";
  if (summary.failed_validators.length === 0) return "ok";
  if (summary.failed_validators.length < summary.total_validators) return "warn";
  return "err";
}
