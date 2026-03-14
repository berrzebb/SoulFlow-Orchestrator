/**
 * RPF-3: Approval Policy — 위험 등급에 따라 승인 결정.
 *
 * 평가 순서: manual_overrides(경로 제공 시) → tier 목록 조회 → "ask_user" fallback
 */

import type { RiskTier } from "./risk-tier.js";

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

// glob 패턴 매칭: "**/" = 선택적 경로 접두사, "**" = 임의 문자, "*" = 슬래시 제외 임의 문자
function match_override(path: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  let i = 0;
  let re = "";
  while (i < escaped.length) {
    if (escaped[i] === "*" && escaped[i + 1] === "*") {
      if (escaped[i + 2] === "/") {
        re += "(.*/)?";
        i += 3;
      } else {
        re += ".*";
        i += 2;
      }
    } else if (escaped[i] === "*") {
      re += "[^/]*";
      i++;
    } else {
      re += escaped[i++];
    }
  }
  return new RegExp("^" + re + "$").test(path);
}

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
      if (match_override(path, override.path_pattern)) {
        return override.decision;
      }
    }
  }

  if (policy.auto_allow_tiers.includes(tier)) return "auto_allow";
  if (policy.blocked_tiers.includes(tier)) return "blocked";
  if (policy.ask_user_tiers.includes(tier)) return "ask_user";

  return "ask_user";
}
