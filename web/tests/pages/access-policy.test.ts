/**
 * FE-0: PagePolicy 인벤토리 회귀 잠금.
 * ROUTER_PATHS는 router.tsx와 공유하는 단일 소스 (router-paths.ts)에서 import한다.
 */
import { describe, it, expect } from "vitest";
import { PAGE_POLICIES, get_page_policy, TEAM_ROLE_RANK } from "@/pages/access-policy";
import { ROUTER_PATHS } from "@/router-paths";
import type { VisibilityTier } from "@/pages/access-policy";

const VALID_TIERS: VisibilityTier[] = [
  "public",
  "authenticated",
  "team_member",
  "team_manager",
  "team_owner",
  "superadmin",
];

describe("PAGE_POLICIES — FE-0 인벤토리 회귀 잠금", () => {
  it("router-paths.ts의 모든 path가 정책에 등록되어 있음", () => {
    const policy_paths = PAGE_POLICIES.map((p) => p.path);
    for (const path of ROUTER_PATHS) {
      expect(policy_paths, `누락된 path: ${path}`).toContain(path);
    }
  });

  it("PAGE_POLICIES의 모든 path가 router-paths.ts에 존재함 (역방향 검증)", () => {
    for (const policy of PAGE_POLICIES) {
      expect(ROUTER_PATHS as readonly string[], `정책에만 존재하는 path: ${policy.path}`).toContain(policy.path);
    }
  });

  it("모든 정책의 view/manage tier가 유효한 값임", () => {
    for (const policy of PAGE_POLICIES) {
      expect(VALID_TIERS, `path=${policy.path} view=${policy.view}`).toContain(policy.view);
      expect(VALID_TIERS, `path=${policy.path} manage=${policy.manage}`).toContain(policy.manage);
    }
  });

  it("manage tier는 항상 view tier 이상의 제한임 (manage < view 불가)", () => {
    const tier_rank: Record<VisibilityTier, number> = {
      public: 0, authenticated: 1, team_member: 2,
      team_manager: 3, team_owner: 4, superadmin: 5,
    };
    for (const policy of PAGE_POLICIES) {
      expect(
        tier_rank[policy.manage],
        `path=${policy.path}: manage(${policy.manage}) < view(${policy.view})는 불가`,
      ).toBeGreaterThanOrEqual(tier_rank[policy.view]);
    }
  });

  it("모든 정책에 description이 있음", () => {
    for (const policy of PAGE_POLICIES) {
      expect(policy.description.length, `path=${policy.path} description 없음`).toBeGreaterThan(0);
    }
  });
});

describe("get_page_policy — 특정 경로 정책 검증", () => {
  it("/admin은 superadmin 전용", () => {
    const p = get_page_policy("/admin");
    expect(p?.view).toBe("superadmin");
    expect(p?.manage).toBe("superadmin");
  });

  it("/login은 public", () => {
    const p = get_page_policy("/login");
    expect(p?.view).toBe("public");
    expect(p?.manage).toBe("public");
  });

  it("/channels는 team_manager 이상만 열람 가능", () => {
    const p = get_page_policy("/channels");
    expect(p?.view).toBe("team_manager");
  });

  it("/providers는 열람 team_manager, 관리 team_owner", () => {
    const p = get_page_policy("/providers");
    expect(p?.view).toBe("team_manager");
    expect(p?.manage).toBe("team_owner");
  });

  it("미등록 경로 → undefined", () => {
    expect(get_page_policy("/nonexistent")).toBeUndefined();
  });
});

describe("TEAM_ROLE_RANK — 역할 서열 검증", () => {
  it("owner > manager > member > viewer", () => {
    expect(TEAM_ROLE_RANK.owner).toBeGreaterThan(TEAM_ROLE_RANK.manager);
    expect(TEAM_ROLE_RANK.manager).toBeGreaterThan(TEAM_ROLE_RANK.member);
    expect(TEAM_ROLE_RANK.member).toBeGreaterThan(TEAM_ROLE_RANK.viewer);
    expect(TEAM_ROLE_RANK.viewer).toBeGreaterThan(0);
  });
});
