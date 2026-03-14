import { describe, it, expect } from "vitest";
import {
  classify_surface,
  classify_surfaces,
  max_risk_tier,
  type RiskTierPolicy,
} from "@src/repo-profile/risk-tier.ts";
import { create_default_profile } from "@src/repo-profile/repo-profile.ts";

const base = create_default_profile("test");

// ── DEFAULT 정책 기본 등급 ─────────────────────────────────────────────────

describe("classify_surface — DEFAULT 정책 기본 등급", () => {
  it("tests/** → low", () => {
    expect(classify_surface({ path: "tests/foo.test.ts", change_type: "modify" }, base)).toBe("low");
  });

  it("docs/** → low", () => {
    expect(classify_surface({ path: "docs/README.md", change_type: "add" }, base)).toBe("low");
  });

  it("**/*.md → low", () => {
    expect(classify_surface({ path: "CHANGELOG.md", change_type: "modify" }, base)).toBe("low");
  });

  it("**/*.test.ts → low", () => {
    expect(classify_surface({ path: "src/foo.test.ts", change_type: "add" }, base)).toBe("low");
  });

  it("src 파일, 패턴 미매칭 → medium (기본값)", () => {
    expect(classify_surface({ path: "src/feature/foo.ts", change_type: "modify" }, base)).toBe("medium");
  });
});

// ── protected_paths ────────────────────────────────────────────────────────

describe("classify_surface — protected_paths", () => {
  it("protected prefix 매칭 → critical", () => {
    const profile = { ...base, protected_paths: ["src/auth/"] };
    expect(classify_surface({ path: "src/auth/session.ts", change_type: "modify" }, profile)).toBe("critical");
  });

  it("protected glob 매칭 → critical", () => {
    const profile = { ...base, protected_paths: ["**/migrations/**"] };
    expect(classify_surface({ path: "db/migrations/001_init.sql", change_type: "add" }, profile)).toBe("critical");
  });

  it("protected 경로 미매칭 → 정책 기반 등급", () => {
    const profile = { ...base, protected_paths: ["src/auth/"] };
    expect(classify_surface({ path: "src/feature/foo.ts", change_type: "modify" }, profile)).toBe("medium");
  });
});

// ── 커스텀 정책 ────────────────────────────────────────────────────────────

describe("classify_surface — 커스텀 정책", () => {
  const policy: RiskTierPolicy = {
    critical_patterns: ["**/*.env", ".env*"],
    high_patterns: ["src/core/**"],
    low_patterns: ["tests/**"],
  };

  it("critical_patterns 매칭 → critical", () => {
    expect(classify_surface({ path: ".env.local", change_type: "modify" }, base, policy)).toBe("critical");
  });

  it("high_patterns 매칭 → high", () => {
    expect(classify_surface({ path: "src/core/engine.ts", change_type: "modify" }, base, policy)).toBe("high");
  });

  it("low_patterns 매칭 → low", () => {
    expect(classify_surface({ path: "tests/core.test.ts", change_type: "add" }, base, policy)).toBe("low");
  });

  it("패턴 미매칭 → medium", () => {
    expect(classify_surface({ path: "src/utils/helper.ts", change_type: "modify" }, base, policy)).toBe("medium");
  });

  it("critical_patterns이 high_patterns보다 우선", () => {
    const policy2: RiskTierPolicy = {
      critical_patterns: ["src/core/**"],
      high_patterns: ["src/core/**"],
      low_patterns: [],
    };
    expect(classify_surface({ path: "src/core/engine.ts", change_type: "modify" }, base, policy2)).toBe("critical");
  });
});

// ── max_risk_tier ──────────────────────────────────────────────────────────

describe("max_risk_tier", () => {
  it("빈 배열 → low", () => {
    expect(max_risk_tier([])).toBe("low");
  });

  it("단일 항목 → 그대로", () => {
    expect(max_risk_tier(["medium"])).toBe("medium");
  });

  it("여러 항목 중 최고 등급 반환", () => {
    expect(max_risk_tier(["low", "high", "medium"])).toBe("high");
    expect(max_risk_tier(["critical", "low"])).toBe("critical");
    expect(max_risk_tier(["low", "low"])).toBe("low");
  });
});

// ── classify_surfaces ──────────────────────────────────────────────────────

describe("classify_surfaces", () => {
  it("빈 배열 → low", () => {
    expect(classify_surfaces([], base)).toBe("low");
  });

  it("여러 표면 중 최고 등급 반환", () => {
    const surfaces = [
      { path: "tests/foo.test.ts", change_type: "modify" as const },
      { path: "src/auth/session.ts", change_type: "modify" as const },
    ];
    const profile = { ...base, protected_paths: ["src/auth/"] };
    expect(classify_surfaces(surfaces, profile)).toBe("critical");
  });

  it("모두 low → low", () => {
    const surfaces = [
      { path: "docs/guide.md", change_type: "add" as const },
      { path: "tests/foo.test.ts", change_type: "modify" as const },
    ];
    expect(classify_surfaces(surfaces, base)).toBe("low");
  });
});
