/**
 * RPF-4F: ArtifactBundle → ValidatorSummary 대시보드 표면 어댑터.
 * 집계 수치와 실패 목록만 노출 — UI 배지/패널 렌더링용.
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
  };
}

/** ValidatorSummary 배지 variant — 실패 수에 따라 ok/warn/err/off. */
export function validator_badge_variant(summary: ValidatorSummary): "ok" | "warn" | "err" | "off" {
  if (summary.total_validators === 0) return "off";
  if (summary.failed_validators.length === 0) return "ok";
  if (summary.failed_validators.length < summary.total_validators) return "warn";
  return "err";
}
