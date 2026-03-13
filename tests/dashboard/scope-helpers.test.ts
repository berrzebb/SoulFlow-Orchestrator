/**
 * build_scope_filter / can_write_scope — 3-tier resource scoping 헬퍼 테스트.
 */
import { describe, it, expect, vi } from "vitest";
import { build_scope_filter, can_write_scope } from "@src/dashboard/route-context.ts";
import type { RouteContext } from "@src/dashboard/route-context.ts";

function make_ctx(overrides: Record<string, unknown> = {}): RouteContext {
  return {
    options: { auth_svc: overrides.auth_svc ?? null },
    auth_user: overrides.auth_user ?? null,
    team_context: overrides.team_context ?? null,
    req: { method: "GET" },
    res: {},
    json: vi.fn(),
  } as unknown as RouteContext;
}

// ── build_scope_filter ──

describe("build_scope_filter", () => {
  it("auth 비활성(싱글유저) → undefined (전체)", () => {
    const ctx = make_ctx({ auth_svc: null });
    expect(build_scope_filter(ctx)).toBeUndefined();
  });

  it("superadmin → undefined (전체)", () => {
    const ctx = make_ctx({
      auth_svc: {},
      auth_user: { role: "superadmin", sub: "admin1", tid: "t1" },
    });
    expect(build_scope_filter(ctx)).toBeUndefined();
  });

  it("일반 유저 → [global, team, personal] 3개 scope", () => {
    const ctx = make_ctx({
      auth_svc: {},
      auth_user: { role: "user", sub: "u1", tid: "t1" },
      team_context: { team_id: "team-alpha", team_role: "member" },
    });
    const filter = build_scope_filter(ctx);
    expect(filter).toEqual([
      { scope_type: "global", scope_id: "" },
      { scope_type: "team", scope_id: "team-alpha" },
      { scope_type: "personal", scope_id: "u1" },
    ]);
  });

  it("team_context 없는 일반 유저 → [global, personal] 2개 scope", () => {
    const ctx = make_ctx({
      auth_svc: {},
      auth_user: { role: "user", sub: "u1", tid: "t1" },
      team_context: null,
    });
    const filter = build_scope_filter(ctx);
    expect(filter).toEqual([
      { scope_type: "global", scope_id: "" },
      { scope_type: "personal", scope_id: "u1" },
    ]);
  });
});

// ── can_write_scope ──

describe("can_write_scope", () => {
  it("auth 비활성 → 모든 scope 쓰기 허용", () => {
    const ctx = make_ctx({ auth_svc: null });
    expect(can_write_scope(ctx, "global", "")).toBe(true);
    expect(can_write_scope(ctx, "team", "t1")).toBe(true);
    expect(can_write_scope(ctx, "personal", "u1")).toBe(true);
  });

  it("superadmin → 모든 scope 쓰기 허용", () => {
    const ctx = make_ctx({
      auth_svc: {},
      auth_user: { role: "superadmin", sub: "admin1" },
    });
    expect(can_write_scope(ctx, "global", "")).toBe(true);
    expect(can_write_scope(ctx, "team", "any-team")).toBe(true);
    expect(can_write_scope(ctx, "personal", "any-user")).toBe(true);
  });

  it("일반 유저 → global scope 쓰기 불가", () => {
    const ctx = make_ctx({
      auth_svc: {},
      auth_user: { role: "user", sub: "u1" },
      team_context: { team_id: "t1", team_role: "member" },
    });
    expect(can_write_scope(ctx, "global", "")).toBe(false);
  });

  it("team owner → 자기 팀 scope 쓰기 가능", () => {
    const ctx = make_ctx({
      auth_svc: {},
      auth_user: { role: "user", sub: "u1" },
      team_context: { team_id: "t1", team_role: "owner" },
    });
    expect(can_write_scope(ctx, "team", "t1")).toBe(true);
  });

  it("team manager → 자기 팀 scope 쓰기 가능", () => {
    const ctx = make_ctx({
      auth_svc: {},
      auth_user: { role: "user", sub: "u1" },
      team_context: { team_id: "t1", team_role: "manager" },
    });
    expect(can_write_scope(ctx, "team", "t1")).toBe(true);
  });

  it("team member → 팀 scope 쓰기 불가", () => {
    const ctx = make_ctx({
      auth_svc: {},
      auth_user: { role: "user", sub: "u1" },
      team_context: { team_id: "t1", team_role: "member" },
    });
    expect(can_write_scope(ctx, "team", "t1")).toBe(false);
  });

  it("team owner → 다른 팀 scope 쓰기 불가", () => {
    const ctx = make_ctx({
      auth_svc: {},
      auth_user: { role: "user", sub: "u1" },
      team_context: { team_id: "t1", team_role: "owner" },
    });
    expect(can_write_scope(ctx, "team", "t2")).toBe(false);
  });

  it("일반 유저 → 자기 personal scope 쓰기 가능", () => {
    const ctx = make_ctx({
      auth_svc: {},
      auth_user: { role: "user", sub: "u1" },
    });
    expect(can_write_scope(ctx, "personal", "u1")).toBe(true);
  });

  it("일반 유저 → 타인의 personal scope 쓰기 불가", () => {
    const ctx = make_ctx({
      auth_svc: {},
      auth_user: { role: "user", sub: "u1" },
    });
    expect(can_write_scope(ctx, "personal", "u2")).toBe(false);
  });

  it("알 수 없는 scope_type → 쓰기 불가", () => {
    const ctx = make_ctx({
      auth_svc: {},
      auth_user: { role: "user", sub: "u1" },
    });
    expect(can_write_scope(ctx, "unknown", "x")).toBe(false);
  });
});
