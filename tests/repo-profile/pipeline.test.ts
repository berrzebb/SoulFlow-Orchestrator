/**
 * RPF 통합 파이프라인 테스트: load_repo_profile -> classify_surface -> evaluate_approval
 * 각 레이어가 독립적으로 단위 테스트되지만, 실제 데이터 흐름이 올바르게 연결되는지 검증.
 */

import { describe, it, expect } from "vitest";
import { load_repo_profile } from "@src/repo-profile/repo-profile.ts";
import {
  classify_surface,
  classify_surfaces,
  type RiskTierPolicy,
} from "@src/repo-profile/risk-tier.ts";
import {
  evaluate_approval,
  type ApprovalPolicy,
  DEFAULT_APPROVAL_POLICY,
} from "@src/repo-profile/approval-policy.ts";

// ── 시나리오 1: protected_paths → critical → blocked ──────────────────────────

describe("pipeline — protected path → blocked", () => {
  const raw = {
    repo_id: "my-repo",
    protected_paths: ["src/security/**", ".env"],
    capabilities: ["lint", "test"],
    commands: { lint: "eslint src/", test: "vitest run" },
  };

  it("protected path는 critical로 분류되고 blocked 결정을 받는다", () => {
    const profile = load_repo_profile(raw);
    const tier = classify_surface(
      { path: "src/security/vault.ts", change_type: "modify" },
      profile,
    );
    const decision = evaluate_approval(tier, DEFAULT_APPROVAL_POLICY);

    expect(tier).toBe("critical");
    expect(decision).toBe("blocked");
  });

  it(".env도 protected path면 critical + blocked", () => {
    const profile = load_repo_profile(raw);
    const tier = classify_surface({ path: ".env", change_type: "modify" }, profile);
    const decision = evaluate_approval(tier, DEFAULT_APPROVAL_POLICY);

    expect(tier).toBe("critical");
    expect(decision).toBe("blocked");
  });
});

// ── 시나리오 2: 일반 소스 파일 → medium → auto_allow ──────────────────────────

describe("pipeline — medium risk source file → auto_allow", () => {
  const profile = load_repo_profile({ repo_id: "generic" });

  it("src/ 하위 일반 파일은 medium으로 분류되고 auto_allow", () => {
    const tier = classify_surface({ path: "src/utils/helper.ts", change_type: "add" }, profile);
    const decision = evaluate_approval(tier, DEFAULT_APPROVAL_POLICY);

    expect(tier).toBe("medium");
    expect(decision).toBe("auto_allow");
  });
});

// ── 시나리오 3: 테스트/문서 파일 → low → auto_allow ──────────────────────────

describe("pipeline — low risk files → auto_allow", () => {
  const profile = load_repo_profile({ repo_id: "generic" });

  it("tests/** → low → auto_allow", () => {
    const tier = classify_surface(
      { path: "tests/unit/parser.test.ts", change_type: "add" },
      profile,
    );
    const decision = evaluate_approval(tier, DEFAULT_APPROVAL_POLICY);

    expect(tier).toBe("low");
    expect(decision).toBe("auto_allow");
  });

  it("**/*.md → low → auto_allow", () => {
    const tier = classify_surface({ path: "CHANGELOG.md", change_type: "modify" }, profile);
    const decision = evaluate_approval(tier, DEFAULT_APPROVAL_POLICY);

    expect(tier).toBe("low");
    expect(decision).toBe("auto_allow");
  });
});

// ── 시나리오 4: custom policy → high → ask_user ───────────────────────────────

describe("pipeline — custom policy: high pattern → ask_user", () => {
  const raw = {
    repo_id: "fintech",
    protected_paths: [],
    capabilities: [],
    commands: {},
  };

  const riskPolicy: RiskTierPolicy = {
    critical_patterns: [],
    high_patterns: ["src/payment/**", "src/billing/**"],
    low_patterns: ["tests/**", "docs/**", "**/*.md"],
  };

  it("결제 모듈은 high → ask_user 결정", () => {
    const profile = load_repo_profile(raw);
    const tier = classify_surface(
      { path: "src/payment/processor.ts", change_type: "modify" },
      profile,
      riskPolicy,
    );
    const decision = evaluate_approval(tier, DEFAULT_APPROVAL_POLICY);

    expect(tier).toBe("high");
    expect(decision).toBe("ask_user");
  });
});

// ── 시나리오 5: manual_override가 tier보다 우선 ───────────────────────────────

describe("pipeline — manual_override overrides tier", () => {
  const profile = load_repo_profile({
    repo_id: "my-repo",
    protected_paths: ["src/auth/**"],
  });

  const policy: ApprovalPolicy = {
    ...DEFAULT_APPROVAL_POLICY,
    manual_overrides: [
      // critical이지만 특정 경로는 auto_allow 허용
      { path_pattern: "src/auth/test-helpers/**", decision: "auto_allow" },
    ],
  };

  it("protected path라도 manual_override로 auto_allow 가능", () => {
    const tier = classify_surface(
      { path: "src/auth/test-helpers/mock.ts", change_type: "add" },
      profile,
    );
    // tier는 여전히 critical (protected_path 적용)
    expect(tier).toBe("critical");

    // 하지만 override가 있어서 auto_allow
    const decision = evaluate_approval(tier, policy, "src/auth/test-helpers/mock.ts");
    expect(decision).toBe("auto_allow");
  });
});

// ── 시나리오 6: 여러 ChangeSurface 중 최고 등급이 결정 ────────────────────────

describe("pipeline — multi-surface max-tier determines approval", () => {
  const raw = {
    repo_id: "mixed",
    protected_paths: ["secrets/**"],
  };

  it("low + critical 혼재 시 최종은 blocked", () => {
    const profile = load_repo_profile(raw);
    const surfaces = [
      { path: "docs/overview.md", change_type: "modify" as const },
      { path: "secrets/api-key.txt", change_type: "add" as const },
    ];
    const tier = classify_surfaces(surfaces, profile);
    const decision = evaluate_approval(tier, DEFAULT_APPROVAL_POLICY);

    expect(tier).toBe("critical");
    expect(decision).toBe("blocked");
  });

  it("low + medium 혼재 시 최종은 auto_allow", () => {
    const profile = load_repo_profile(raw);
    const surfaces = [
      { path: "docs/overview.md", change_type: "modify" as const },
      { path: "src/utils/format.ts", change_type: "add" as const },
    ];
    const tier = classify_surfaces(surfaces, profile);
    const decision = evaluate_approval(tier, DEFAULT_APPROVAL_POLICY);

    expect(tier).toBe("medium");
    expect(decision).toBe("auto_allow");
  });
});
