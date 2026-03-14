/**
 * RPF-3: Approval Policy — 위험 등급에 따라 승인 결정.
 *
 * 평가 순서: manual_overrides(경로 제공 시) → tier 목록 조회 → "ask_user" fallback
 */

import type { RiskTier } from "./risk-tier.js";
import { match_glob } from "./_glob.js";

export type ApprovalDecision = "auto_allow" | "ask_user" | "blocked";

export interface ManualOverride {
  path_pattern: string;
  decision: ApprovalDecision;
}

export interface ApprovalPolicy {
  auto_allow_tiers: RiskTier[];
  ask_user_tiers: RiskTier[];
  blocked_tiers: RiskTier[];
  manual_overrides: ManualOverride[];
}

export const DEFAULT_APPROVAL_POLICY: ApprovalPolicy = {
  auto_allow_tiers: ["low", "medium"],
  ask_user_tiers: ["high"],
  blocked_tiers: ["critical"],
  manual_overrides: [],
};

/**
 * 위험 등급과 경로를 기반으로 승인 결정.
 * path가 제공되면 manual_overrides를 먼저 평가한다.
 * 어떤 tier 목록에도 속하지 않으면 "ask_user" fallback.
 */
export function evaluate_approval(
  tier: RiskTier,
  policy: ApprovalPolicy,
  path?: string,
): ApprovalDecision {
  if (path) {
    for (const override of policy.manual_overrides) {
      if (match_glob(override.path_pattern, path)) {
        return override.decision;
      }
    }
  }

  if (policy.auto_allow_tiers.includes(tier)) return "auto_allow";
  if (policy.blocked_tiers.includes(tier)) return "blocked";
  if (policy.ask_user_tiers.includes(tier)) return "ask_user";

  return "ask_user";
}
