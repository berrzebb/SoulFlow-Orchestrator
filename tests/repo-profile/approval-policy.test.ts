import { describe, it, expect } from "vitest";
import {
  evaluate_approval,
  DEFAULT_APPROVAL_POLICY,
  type ApprovalPolicy,
} from "@src/repo-profile/approval-policy.ts";

// ── DEFAULT_APPROVAL_POLICY ────────────────────────────────────────────────

describe("evaluate_approval — DEFAULT_APPROVAL_POLICY", () => {
  it("low → auto_allow", () => {
    expect(evaluate_approval("low", DEFAULT_APPROVAL_POLICY)).toBe("auto_allow");
  });

  it("medium → auto_allow", () => {
    expect(evaluate_approval("medium", DEFAULT_APPROVAL_POLICY)).toBe("auto_allow");
  });

  it("high → ask_user", () => {
    expect(evaluate_approval("high", DEFAULT_APPROVAL_POLICY)).toBe("ask_user");
  });

  it("critical → blocked", () => {
    expect(evaluate_approval("critical", DEFAULT_APPROVAL_POLICY)).toBe("blocked");
  });
});

// ── manual_overrides ───────────────────────────────────────────────────────

describe("evaluate_approval — manual_overrides", () => {
  const policy: ApprovalPolicy = {
    ...DEFAULT_APPROVAL_POLICY,
    manual_overrides: [
      { path_pattern: "src/auth/**", decision: "blocked" },
      { path_pattern: "scripts/**", decision: "auto_allow" },
    ],
  };

  it("override 패턴 매칭 → override 결정 (tier 무시)", () => {
    expect(evaluate_approval("low", policy, "src/auth/session.ts")).toBe("blocked");
  });

  it("high tier 경로가 override 패턴 → auto_allow", () => {
    expect(evaluate_approval("high", policy, "scripts/run.ts")).toBe("auto_allow");
  });

  it("override 패턴 미매칭 → tier 기반 결정", () => {
    expect(evaluate_approval("high", policy, "src/feature/foo.ts")).toBe("ask_user");
  });

  it("path 미제공 → override 무시, tier 기반", () => {
    expect(evaluate_approval("low", policy)).toBe("auto_allow");
    expect(evaluate_approval("critical", policy)).toBe("blocked");
  });

  it("첫 번째 매칭 override 우선", () => {
    const p: ApprovalPolicy = {
      ...DEFAULT_APPROVAL_POLICY,
      manual_overrides: [
        { path_pattern: "src/**", decision: "ask_user" },
        { path_pattern: "src/auth/**", decision: "blocked" },
      ],
    };
    // src/auth/** 보다 src/** 가 먼저 선언됨
    expect(evaluate_approval("low", p, "src/auth/session.ts")).toBe("ask_user");
  });
});

// ── 커스텀 정책 ────────────────────────────────────────────────────────────

describe("evaluate_approval — 커스텀 정책", () => {
  const strict: ApprovalPolicy = {
    auto_allow_tiers: ["low"],
    ask_user_tiers: ["medium", "high"],
    blocked_tiers: ["critical"],
    manual_overrides: [],
  };

  it("low → auto_allow (strict)", () => {
    expect(evaluate_approval("low", strict)).toBe("auto_allow");
  });

  it("medium → ask_user (strict — 기본 정책과 다름)", () => {
    expect(evaluate_approval("medium", strict)).toBe("ask_user");
  });

  it("critical → blocked (strict)", () => {
    expect(evaluate_approval("critical", strict)).toBe("blocked");
  });
});

// ── fallback ───────────────────────────────────────────────────────────────

describe("evaluate_approval — fallback", () => {
  it("tier가 어떤 목록에도 없으면 ask_user fallback", () => {
    const empty: ApprovalPolicy = {
      auto_allow_tiers: [],
      ask_user_tiers: [],
      blocked_tiers: [],
      manual_overrides: [],
    };
    expect(evaluate_approval("high", empty)).toBe("ask_user");
    expect(evaluate_approval("low", empty)).toBe("ask_user");
  });
});
