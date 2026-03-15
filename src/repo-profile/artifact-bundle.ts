/**
 * RPF-5: ArtifactBundle — 한 실행의 증거를 재사용 가능한 구조체로 저장.
 * changed files / validator results / eval summary / residual risks / patch metadata를 포함.
 * 직렬화(JSON)로 replay, 감사, 요약에 재사용 가능.
 */

import type { RepoCapability } from "./repo-profile.js";
import type { RiskTier } from "./risk-tier.js";

export interface ValidatorRunResult {
  kind: RepoCapability;
  command: string;
  passed: boolean;
  output?: string;
  duration_ms?: number;
}

export interface EvalSummary {
  bundle_id?: string;
  total_cases: number;
  passed_cases: number;
  score: number; // passed_cases / total_cases (0~1)
}

export interface PatchMetadata {
  added_lines: number;
  removed_lines: number;
  files_changed: number;
}

export interface ResidualRisk {
  severity: "low" | "medium" | "high";
  description: string;
}

export interface ArtifactBundle {
  readonly repo_id: string;
  readonly created_at: string; // ISO 8601
  readonly changed_files: readonly string[];
  readonly validator_results: readonly ValidatorRunResult[];
  readonly eval_summary?: EvalSummary;
  readonly residual_risks: readonly ResidualRisk[];
  readonly patch?: PatchMetadata;
  /** RPF-6: 변경 표면의 최고 위험 등급. 번들 생성 시점에 RepoProfile로 계산 후 주입. */
  readonly risk_tier?: RiskTier;
}

export type ArtifactBundleInput = {
  repo_id: string;
  /** 미제공 시 호출 시점의 ISO 8601 타임스탬프로 자동 설정. 테스트 등 고정값이 필요할 때 주입 가능. */
  created_at?: string;
  changed_files?: string[];
  validator_results?: ValidatorRunResult[];
  eval_summary?: EvalSummary;
  residual_risks?: ResidualRisk[];
  patch?: PatchMetadata;
  /** RPF-6: 변경 표면의 최고 위험 등급. */
  risk_tier?: RiskTier;
};

/** ArtifactBundle을 생성. created_at 미제공 시 호출 시점의 ISO 8601으로 자동 설정. */
export function create_artifact_bundle(input: ArtifactBundleInput): ArtifactBundle {
  return {
    repo_id: input.repo_id,
    created_at: input.created_at ?? new Date().toISOString(),
    changed_files: input.changed_files ?? [],
    validator_results: input.validator_results ?? [],
    eval_summary: input.eval_summary,
    residual_risks: input.residual_risks ?? [],
    patch: input.patch,
    risk_tier: input.risk_tier,
  };
}

/** ArtifactBundle을 JSON 문자열로 직렬화. */
export function serialize_bundle(bundle: ArtifactBundle): string {
  return JSON.stringify(bundle);
}

/** JSON 문자열 또는 unknown 객체에서 ArtifactBundle 복원. 필수 필드 없으면 throw. */
export function deserialize_bundle(raw: unknown): ArtifactBundle {
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;

  if (typeof parsed !== "object" || parsed === null) {
    throw new TypeError("ArtifactBundle source must be a non-null object");
  }

  const obj = parsed as Record<string, unknown>;

  if (typeof obj["repo_id"] !== "string" || !obj["repo_id"]) {
    throw new TypeError("ArtifactBundle.repo_id is required and must be a non-empty string");
  }
  if (typeof obj["created_at"] !== "string") {
    throw new TypeError("ArtifactBundle.created_at is required and must be a string");
  }

  const risk_tier_raw = obj["risk_tier"];
  const risk_tier: RiskTier | undefined =
    risk_tier_raw === "low" || risk_tier_raw === "medium" || risk_tier_raw === "high" || risk_tier_raw === "critical"
      ? risk_tier_raw
      : undefined;

  return {
    repo_id: obj["repo_id"],
    created_at: obj["created_at"],
    changed_files: Array.isArray(obj["changed_files"])
      ? (obj["changed_files"] as unknown[]).filter((f): f is string => typeof f === "string")
      : [],
    validator_results: Array.isArray(obj["validator_results"])
      ? (obj["validator_results"] as unknown[]).filter(is_validator_run_result)
      : [],
    eval_summary: is_eval_summary(obj["eval_summary"]) ? obj["eval_summary"] : undefined,
    residual_risks: Array.isArray(obj["residual_risks"])
      ? (obj["residual_risks"] as unknown[]).filter(is_residual_risk)
      : [],
    patch: is_patch_metadata(obj["patch"]) ? obj["patch"] : undefined,
    risk_tier,
  };
}

/** bundle 전체가 통과인지 — 모든 validator_results가 passed. */
export function is_bundle_passing(bundle: ArtifactBundle): boolean {
  if (bundle.validator_results.length === 0) return true;
  return bundle.validator_results.every((r) => r.passed);
}

// ── 내부 타입 가드 ──

function is_validator_run_result(v: unknown): v is ValidatorRunResult {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return typeof r["kind"] === "string" && typeof r["command"] === "string" && typeof r["passed"] === "boolean";
}

function is_eval_summary(v: unknown): v is EvalSummary {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return typeof r["total_cases"] === "number" && typeof r["passed_cases"] === "number" && typeof r["score"] === "number";
}

function is_residual_risk(v: unknown): v is ResidualRisk {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (r["severity"] === "low" || r["severity"] === "medium" || r["severity"] === "high")
    && typeof r["description"] === "string";
}

function is_patch_metadata(v: unknown): v is PatchMetadata {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return typeof r["added_lines"] === "number"
    && typeof r["removed_lines"] === "number"
    && typeof r["files_changed"] === "number";
}
