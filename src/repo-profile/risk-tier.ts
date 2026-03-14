/**
 * RPF-2: ChangeSurfaceMap / Risk Tier — 변경 범위를 구조적으로 분류하고 위험 등급을 계산.
 *
 * 평가 순서: protected_paths(profile) → critical_patterns → high_patterns → low_patterns → "medium"
 */

import type { RepoProfile } from "./repo-profile.js";
import { match_glob } from "./_glob.js";

export type RiskTier = "low" | "medium" | "high" | "critical";
export type ChangeType = "add" | "modify" | "delete" | "rename";

export interface ChangeSurface {
  path: string;
  change_type: ChangeType;
}

export interface RiskTierPolicy {
  /** critical로 분류할 glob 패턴 목록 */
  critical_patterns: string[];
  /** high로 분류할 glob 패턴 목록 */
  high_patterns: string[];
  /** low로 분류할 glob 패턴 목록 (기본: 테스트/문서) */
  low_patterns: string[];
}

export const DEFAULT_RISK_TIER_POLICY: RiskTierPolicy = {
  critical_patterns: [],
  high_patterns: [],
  low_patterns: ["tests/**", "docs/**", "**/*.md", "**/*.test.ts"],
};

const TIER_ORDER: RiskTier[] = ["low", "medium", "high", "critical"];

function is_protected(path: string, profile: RepoProfile): boolean {
  return profile.protected_paths.some((p) => match_glob(p, path) || path.startsWith(p));
}

/**
 * 단일 ChangeSurface의 위험 등급 결정.
 * profile.protected_paths 먼저, 이후 policy 패턴 순으로 평가.
 */
export function classify_surface(
  surface: ChangeSurface,
  profile: RepoProfile,
  policy: RiskTierPolicy = DEFAULT_RISK_TIER_POLICY,
): RiskTier {
  if (is_protected(surface.path, profile)) return "critical";

  for (const p of policy.critical_patterns) {
    if (match_glob(p, surface.path)) return "critical";
  }
  for (const p of policy.high_patterns) {
    if (match_glob(p, surface.path)) return "high";
  }
  for (const p of policy.low_patterns) {
    if (match_glob(p, surface.path)) return "low";
  }

  return "medium";
}

/**
 * 여러 RiskTier 중 최고 등급 반환.
 * 빈 배열이면 "low" 반환.
 */
export function max_risk_tier(tiers: RiskTier[]): RiskTier {
  if (tiers.length === 0) return "low";
  return tiers.reduce<RiskTier>(
    (max, t) => (TIER_ORDER.indexOf(t) > TIER_ORDER.indexOf(max) ? t : max),
    "low",
  );
}

/**
 * 여러 ChangeSurface 목록의 최고 위험 등급 반환.
 */
export function classify_surfaces(
  surfaces: ChangeSurface[],
  profile: RepoProfile,
  policy?: RiskTierPolicy,
): RiskTier {
  if (surfaces.length === 0) return "low";
  return max_risk_tier(surfaces.map((s) => classify_surface(s, profile, policy)));
}
