import { describe, it, expect } from "vitest";
import { get_filter_team_id } from "@src/dashboard/route-context.ts";

function make_ctx(overrides: Record<string, unknown> = {}) {
  return {
    options: { auth_svc: overrides.auth_svc ?? null },
    auth_user: overrides.auth_user ?? null,
    team_context: overrides.team_context ?? null,
  } as any;
}

describe("get_filter_team_id", () => {
  it("auth 비활성(싱글 유저 모드) → undefined (전체 조회)", () => {
    const ctx = make_ctx({ auth_svc: null });
    expect(get_filter_team_id(ctx)).toBeUndefined();
  });

  it("superadmin → undefined (전체 조회)", () => {
    const ctx = make_ctx({
      auth_svc: {},
      auth_user: { role: "superadmin", sub: "admin1", tid: "t1" },
      team_context: { team_id: "t1", team_role: "owner" },
    });
    expect(get_filter_team_id(ctx)).toBeUndefined();
  });

  it("일반 유저 → 해당 team_id 반환", () => {
    const ctx = make_ctx({
      auth_svc: {},
      auth_user: { role: "user", sub: "u1", tid: "team-alpha" },
      team_context: { team_id: "team-alpha", team_role: "member" },
    });
    expect(get_filter_team_id(ctx)).toBe("team-alpha");
  });

  it("team_context가 null이면 빈 문자열 반환", () => {
    const ctx = make_ctx({
      auth_svc: {},
      auth_user: { role: "user", sub: "u1", tid: "t1" },
      team_context: null,
    });
    expect(get_filter_team_id(ctx)).toBe("");
  });
});
