export type { RepoCapability, RepoCommandSet, RepoProfile } from "./repo-profile.js";
export { DEFAULT_REPO_PROFILE, create_default_profile, load_repo_profile } from "./repo-profile.js";

export type { RiskTier, ChangeType, ChangeSurface, RiskTierPolicy } from "./risk-tier.js";
export {
  DEFAULT_RISK_TIER_POLICY,
  classify_surface,
  classify_surfaces,
  max_risk_tier,
} from "./risk-tier.js";

export type { ApprovalDecision, ManualOverride, ApprovalPolicy } from "./approval-policy.js";
export { DEFAULT_APPROVAL_POLICY, evaluate_approval } from "./approval-policy.js";

export type { ValidatorCommand, ValidatorPack } from "./validator-pack.js";
export { create_validator_pack, resolve_validator, has_validator } from "./validator-pack.js";

export type {
  ValidatorRunResult,
  EvalSummary,
  PatchMetadata,
  ResidualRisk,
  ArtifactBundle,
  ArtifactBundleInput,
} from "./artifact-bundle.js";
export {
  create_artifact_bundle,
  serialize_bundle,
  deserialize_bundle,
  is_bundle_passing,
} from "./artifact-bundle.js";

export type { FailedValidatorEntry, ValidatorSummary } from "./validator-summary-adapter.js";
export { adapt_bundle_to_summary, validator_badge_variant } from "./validator-summary-adapter.js";
