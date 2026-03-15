/**
 * FE-6: 접근 정책 회귀 — 기존 FE-0 테스트를 보강하여 정책 무결성을 잠근다.
 */
import { describe, it, expect } from "vitest";
import { PAGE_POLICIES } from "@/pages/access-policy";
import { ROUTER_PATHS } from "@/router-paths";

describe("PAGE_POLICIES — FE-6 회귀 보강", () => {
  it("중복 path가 없음", () => {
    const paths = PAGE_POLICIES.map((p) => p.path);
    const unique = new Set(paths);
    expect(unique.size, `중복 path 존재: ${paths.filter((p, i) => paths.indexOf(p) !== i)}`).toBe(paths.length);
  });

  it("superadmin 전용 페이지가 /admin 뿐임", () => {
    const superadmin_pages = PAGE_POLICIES.filter((p) => p.view === "superadmin" && p.path !== "/setup");
    expect(superadmin_pages.map((p) => p.path)).toEqual(["/admin"]);
  });

  it("public 페이지가 /login 뿐임", () => {
    const public_pages = PAGE_POLICIES.filter((p) => p.view === "public");
    expect(public_pages.map((p) => p.path)).toEqual(["/login"]);
  });

  it("정책 수와 라우터 경로 수가 일치함", () => {
    expect(PAGE_POLICIES.length).toBe(ROUTER_PATHS.length);
  });

  it("모든 manage tier가 view tier 이상 제한 (엄격 검증)", () => {
    const rank: Record<string, number> = {
      public: 0, authenticated: 1, team_member: 2,
      team_manager: 3, team_owner: 4, superadmin: 5,
    };
    for (const p of PAGE_POLICIES) {
      const view_rank = rank[p.view] ?? -1;
      const manage_rank = rank[p.manage] ?? -1;
      expect(manage_rank, `${p.path}: manage(${p.manage}) < view(${p.view})`).toBeGreaterThanOrEqual(view_rank);
    }
  });

  it("워크플로우 관련 경로가 4개 존재함", () => {
    const wf_paths = PAGE_POLICIES.filter((p) => p.path.startsWith("/workflows"));
    expect(wf_paths.length).toBe(4);
  });
});
