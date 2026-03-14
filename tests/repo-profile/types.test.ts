/**
 * RPF 모듈 타입 시그니처 스냅샷 (vitest expectTypeOf)
 * 컴파일타임 계약: 반환 타입, 파라미터 타입, 유니온 리터럴 등 검증.
 * 런타임 값이 아닌 TypeScript 타입 자체를 테스트한다.
 */

import { describe, it, expectTypeOf } from "vitest";
import type {
  RepoProfile,
  RepoCapability,
  RepoCommandSet,
  RiskTier,
  ChangeType,
  ChangeSurface,
  RiskTierPolicy,
  ApprovalDecision,
  ManualOverride,
  ApprovalPolicy,
} from "@src/repo-profile/index.ts";
import {
  load_repo_profile,
  create_default_profile,
  DEFAULT_REPO_PROFILE,
  classify_surface,
  classify_surfaces,
  max_risk_tier,
  DEFAULT_RISK_TIER_POLICY,
  evaluate_approval,
  DEFAULT_APPROVAL_POLICY,
} from "@src/repo-profile/index.ts";

const profile = create_default_profile("test");
const surface: ChangeSurface = { path: "src/foo.ts", change_type: "modify" };

// ── RepoProfile 반환 타입 ───────────────────────────────────────────────────

describe("타입: load_repo_profile / create_default_profile", () => {
  it("load_repo_profile returns RepoProfile", () => {
    expectTypeOf(load_repo_profile).returns.toMatchTypeOf<RepoProfile>();
  });

  it("create_default_profile returns RepoProfile", () => {
    expectTypeOf(create_default_profile).returns.toMatchTypeOf<RepoProfile>();
  });

  it("DEFAULT_REPO_PROFILE is RepoProfile", () => {
    expectTypeOf(DEFAULT_REPO_PROFILE).toMatchTypeOf<RepoProfile>();
  });

  it("repo_id is string", () => {
    expectTypeOf(DEFAULT_REPO_PROFILE.repo_id).toEqualTypeOf<string>();
  });

  it("capabilities is RepoCapability[]", () => {
    expectTypeOf(DEFAULT_REPO_PROFILE.capabilities).toEqualTypeOf<RepoCapability[]>();
  });

  it("commands is RepoCommandSet", () => {
    expectTypeOf(DEFAULT_REPO_PROFILE.commands).toEqualTypeOf<RepoCommandSet>();
  });

  it("protected_paths is string[]", () => {
    expectTypeOf(DEFAULT_REPO_PROFILE.protected_paths).toEqualTypeOf<string[]>();
  });
});

// ── RiskTier 반환 타입 ─────────────────────────────────────────────────────

describe("타입: classify_surface / classify_surfaces / max_risk_tier", () => {
  it("classify_surface returns RiskTier", () => {
    expectTypeOf(classify_surface(surface, profile)).toEqualTypeOf<RiskTier>();
  });

  it("classify_surface with policy returns RiskTier", () => {
    expectTypeOf(classify_surface(surface, profile, DEFAULT_RISK_TIER_POLICY)).toEqualTypeOf<RiskTier>();
  });

  it("classify_surfaces returns RiskTier", () => {
    expectTypeOf(classify_surfaces([surface], profile)).toEqualTypeOf<RiskTier>();
  });

  it("max_risk_tier returns RiskTier", () => {
    expectTypeOf(max_risk_tier(["low", "high"])).toEqualTypeOf<RiskTier>();
  });

  it("max_risk_tier with empty array returns RiskTier", () => {
    expectTypeOf(max_risk_tier([])).toEqualTypeOf<RiskTier>();
  });

  it("ChangeType is correct union", () => {
    expectTypeOf<ChangeType>().toEqualTypeOf<"add" | "modify" | "delete" | "rename">();
  });

  it("DEFAULT_RISK_TIER_POLICY satisfies RiskTierPolicy", () => {
    expectTypeOf(DEFAULT_RISK_TIER_POLICY).toMatchTypeOf<RiskTierPolicy>();
  });

  it("RiskTierPolicy patterns are string[]", () => {
    expectTypeOf(DEFAULT_RISK_TIER_POLICY.critical_patterns).toEqualTypeOf<string[]>();
    expectTypeOf(DEFAULT_RISK_TIER_POLICY.high_patterns).toEqualTypeOf<string[]>();
    expectTypeOf(DEFAULT_RISK_TIER_POLICY.low_patterns).toEqualTypeOf<string[]>();
  });
});

// ── ApprovalDecision 반환 타입 ─────────────────────────────────────────────

describe("타입: evaluate_approval", () => {
  it("evaluate_approval returns ApprovalDecision", () => {
    expectTypeOf(evaluate_approval("low", DEFAULT_APPROVAL_POLICY)).toEqualTypeOf<ApprovalDecision>();
  });

  it("evaluate_approval with path returns ApprovalDecision", () => {
    expectTypeOf(
      evaluate_approval("critical", DEFAULT_APPROVAL_POLICY, "src/foo.ts"),
    ).toEqualTypeOf<ApprovalDecision>();
  });

  it("ApprovalDecision is correct union", () => {
    expectTypeOf<ApprovalDecision>().toEqualTypeOf<"auto_allow" | "ask_user" | "blocked">();
  });

  it("ApprovalPolicy tier lists are RiskTier[]", () => {
    expectTypeOf(DEFAULT_APPROVAL_POLICY.auto_allow_tiers).toEqualTypeOf<RiskTier[]>();
    expectTypeOf(DEFAULT_APPROVAL_POLICY.blocked_tiers).toEqualTypeOf<RiskTier[]>();
    expectTypeOf(DEFAULT_APPROVAL_POLICY.ask_user_tiers).toEqualTypeOf<RiskTier[]>();
  });

  it("ApprovalPolicy.manual_overrides is ManualOverride[]", () => {
    expectTypeOf(DEFAULT_APPROVAL_POLICY.manual_overrides).toEqualTypeOf<ManualOverride[]>();
  });

  it("ManualOverride.decision is ApprovalDecision", () => {
    const mo: ManualOverride = { path_pattern: "**/*.ts", decision: "auto_allow" };
    expectTypeOf(mo.decision).toEqualTypeOf<ApprovalDecision>();
  });
});

// ── 타입 호환성: RiskTier는 ApprovalPolicy 파라미터로 사용 가능 ───────────────

describe("타입 호환성: RiskTier <-> ApprovalPolicy", () => {
  it("evaluate_approval first param accepts RiskTier", () => {
    expectTypeOf(evaluate_approval).parameter(0).toEqualTypeOf<RiskTier>();
  });

  it("evaluate_approval second param accepts ApprovalPolicy", () => {
    expectTypeOf(evaluate_approval).parameter(1).toEqualTypeOf<ApprovalPolicy>();
  });

  it("evaluate_approval third param is optional string", () => {
    expectTypeOf(evaluate_approval).parameter(2).toEqualTypeOf<string | undefined>();
  });
});
