/**
 * FE-1: tier_satisfied() 순수 함수 단위 테스트 + usePageAccess() 훅 직접 테스트.
 * 우선순위 중첩 포함 — 모든 tier × role 조합 검증.
 * useAuthStatus/useAuthUser를 모킹해 can_view/can_manage 계산과 로딩 경계를 검증한다.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

vi.mock("@/hooks/use-auth");

import { tier_satisfied, usePageAccess } from "@/hooks/use-page-access";
import { useAuthStatus, useAuthUser } from "@/hooks/use-auth";
import type { AuthUser } from "@/hooks/use-auth";
import type { PagePolicy } from "@/pages/access-policy";

function make_user(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    sub: "u1",
    username: "testuser",
    role: "user",
    tid: "team1",
    wdir: "/workspace",
    exp: 9999999999,
    team_role: "member",
    ...overrides,
  };
}

function mock_auth(opts: {
  enabled?: boolean;
  loading?: boolean;
  user?: AuthUser | null;
}) {
  vi.mocked(useAuthStatus).mockReturnValue(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { data: opts.loading ? undefined : { enabled: opts.enabled ?? true, initialized: true } } as any,
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useAuthUser).mockReturnValue({ data: opts.user ?? null } as any);
}

const CHANNEL_POLICY: PagePolicy = {
  path: "/channels",
  view: "team_manager",
  manage: "team_owner",
  description: "채널 관리",
};

const PUBLIC_POLICY: PagePolicy = {
  path: "/login",
  view: "public",
  manage: "public",
  description: "로그인",
};

const ADMIN_POLICY: PagePolicy = {
  path: "/admin",
  view: "superadmin",
  manage: "superadmin",
  description: "관리자",
};

// ── public tier ──────────────────────────────────────────────────────────────

describe("tier_satisfied — public", () => {
  it("비인증 사용자도 통과", () => {
    expect(tier_satisfied("public", null, true)).toBe(true);
  });

  it("auth 비활성 + 비인증도 통과", () => {
    expect(tier_satisfied("public", null, false)).toBe(true);
  });
});

// ── authenticated tier ───────────────────────────────────────────────────────

describe("tier_satisfied — authenticated", () => {
  it("auth 비활성 → 비인증도 통과 (싱글유저 모드)", () => {
    expect(tier_satisfied("authenticated", null, false)).toBe(true);
  });

  it("auth 활성 + 비인증 → 불통과", () => {
    expect(tier_satisfied("authenticated", null, true)).toBe(false);
  });

  it("auth 활성 + 로그인 사용자 → 통과", () => {
    expect(tier_satisfied("authenticated", make_user(), true)).toBe(true);
  });

  it("superadmin → 통과", () => {
    expect(tier_satisfied("authenticated", make_user({ role: "superadmin" }), true)).toBe(true);
  });
});

// ── superadmin tier ──────────────────────────────────────────────────────────

describe("tier_satisfied — superadmin", () => {
  it("superadmin → 통과", () => {
    expect(tier_satisfied("superadmin", make_user({ role: "superadmin" }), true)).toBe(true);
  });

  it("일반 user (owner team_role) → 불통과", () => {
    expect(tier_satisfied("superadmin", make_user({ role: "user", team_role: "owner" }), true)).toBe(false);
  });

  it("비인증 → 불통과", () => {
    expect(tier_satisfied("superadmin", null, true)).toBe(false);
  });

  it("auth 비활성이어도 superadmin 아니면 불통과? — 아니다, 비활성 시 통과", () => {
    // auth 비활성 = 싱글유저 모드, superadmin 제한도 우회됨
    expect(tier_satisfied("superadmin", null, false)).toBe(true);
  });
});

// ── team_member tier ─────────────────────────────────────────────────────────

describe("tier_satisfied — team_member", () => {
  it("viewer → 통과 (가장 낮은 팀 역할)", () => {
    expect(tier_satisfied("team_member", make_user({ team_role: "viewer" }), true)).toBe(true);
  });

  it("member → 통과", () => {
    expect(tier_satisfied("team_member", make_user({ team_role: "member" }), true)).toBe(true);
  });

  it("manager → 통과", () => {
    expect(tier_satisfied("team_member", make_user({ team_role: "manager" }), true)).toBe(true);
  });

  it("팀 미소속 (team_role=null) → 불통과", () => {
    expect(tier_satisfied("team_member", make_user({ team_role: null }), true)).toBe(false);
  });

  it("비인증 → 불통과", () => {
    expect(tier_satisfied("team_member", null, true)).toBe(false);
  });
});

// ── team_manager tier ────────────────────────────────────────────────────────

describe("tier_satisfied — team_manager", () => {
  it("viewer → 불통과", () => {
    expect(tier_satisfied("team_manager", make_user({ team_role: "viewer" }), true)).toBe(false);
  });

  it("member → 불통과", () => {
    expect(tier_satisfied("team_manager", make_user({ team_role: "member" }), true)).toBe(false);
  });

  it("manager → 통과", () => {
    expect(tier_satisfied("team_manager", make_user({ team_role: "manager" }), true)).toBe(true);
  });

  it("owner → 통과", () => {
    expect(tier_satisfied("team_manager", make_user({ team_role: "owner" }), true)).toBe(true);
  });

  it("superadmin (system) → 통과", () => {
    expect(tier_satisfied("team_manager", make_user({ role: "superadmin" }), true)).toBe(true);
  });
});

// ── team_owner tier ──────────────────────────────────────────────────────────

describe("tier_satisfied — team_owner", () => {
  it("manager → 불통과", () => {
    expect(tier_satisfied("team_owner", make_user({ team_role: "manager" }), true)).toBe(false);
  });

  it("owner → 통과", () => {
    expect(tier_satisfied("team_owner", make_user({ team_role: "owner" }), true)).toBe(true);
  });

  it("superadmin (system) → 통과", () => {
    expect(tier_satisfied("team_owner", make_user({ role: "superadmin" }), true)).toBe(true);
  });
});

// ── 우선순위 중첩 케이스 — tier 계층 검증 ───────────────────────────────────

describe("tier_satisfied — 우선순위 중첩 케이스", () => {
  it("superadmin은 team_role=null이어도 team_owner tier 통과", () => {
    const superadmin = make_user({ role: "superadmin", team_role: null });
    expect(tier_satisfied("team_owner", superadmin, true)).toBe(true);
  });

  it("user + team_role=owner 조합은 superadmin tier 불통과", () => {
    // system role이 user이면 superadmin tier는 항상 막힌다
    const owner_user = make_user({ role: "user", team_role: "owner" });
    expect(tier_satisfied("superadmin", owner_user, true)).toBe(false);
  });

  it("auth 비활성이면 superadmin tier도 통과 (싱글유저 모드)", () => {
    expect(tier_satisfied("team_owner", null, false)).toBe(true);
    expect(tier_satisfied("superadmin", null, false)).toBe(true);
  });

  it("viewer는 team_member 통과, team_manager 불통과", () => {
    const viewer = make_user({ team_role: "viewer" });
    expect(tier_satisfied("team_member", viewer, true)).toBe(true);
    expect(tier_satisfied("team_manager", viewer, true)).toBe(false);
  });
});

// ── usePageAccess() 훅 직접 테스트 ─────────────────────────────────────────

describe("usePageAccess — auth 비활성 (싱글유저 모드)", () => {
  it("auth 비활성 → can_view + can_manage 모두 true", () => {
    mock_auth({ enabled: false, user: null });
    const { result } = renderHook(() => usePageAccess(CHANNEL_POLICY));
    expect(result.current.can_view).toBe(true);
    expect(result.current.can_manage).toBe(true);
  });

  it("auth_status 로딩 중 (data=undefined) → auth_enabled=false → 통과", () => {
    mock_auth({ loading: true, user: null });
    const { result } = renderHook(() => usePageAccess(CHANNEL_POLICY));
    expect(result.current.can_view).toBe(true);
    expect(result.current.can_manage).toBe(true);
  });
});

describe("usePageAccess — 비인증 (auth 활성)", () => {
  beforeEach(() => mock_auth({ enabled: true, user: null }));

  it("비인증 + team_manager tier → can_view false", () => {
    const { result } = renderHook(() => usePageAccess(CHANNEL_POLICY));
    expect(result.current.can_view).toBe(false);
    expect(result.current.can_manage).toBe(false);
  });

  it("비인증 + public tier → can_view true", () => {
    const { result } = renderHook(() => usePageAccess(PUBLIC_POLICY));
    expect(result.current.can_view).toBe(true);
    expect(result.current.can_manage).toBe(true);
  });
});

describe("usePageAccess — team 역할 기반", () => {
  it("team_manager → can_view true, can_manage false (team_owner 필요)", () => {
    mock_auth({ enabled: true, user: make_user({ team_role: "manager" }) });
    const { result } = renderHook(() => usePageAccess(CHANNEL_POLICY));
    expect(result.current.can_view).toBe(true);
    expect(result.current.can_manage).toBe(false);
  });

  it("team_owner → can_view + can_manage 모두 true", () => {
    mock_auth({ enabled: true, user: make_user({ team_role: "owner" }) });
    const { result } = renderHook(() => usePageAccess(CHANNEL_POLICY));
    expect(result.current.can_view).toBe(true);
    expect(result.current.can_manage).toBe(true);
  });

  it("team viewer → team_manager tier 불통과 (can_view false)", () => {
    mock_auth({ enabled: true, user: make_user({ team_role: "viewer" }) });
    const { result } = renderHook(() => usePageAccess(CHANNEL_POLICY));
    expect(result.current.can_view).toBe(false);
    expect(result.current.can_manage).toBe(false);
  });
});

describe("usePageAccess — superadmin", () => {
  it("superadmin → team_owner tier도 통과 (can_view + can_manage true)", () => {
    mock_auth({ enabled: true, user: make_user({ role: "superadmin", team_role: null }) });
    const { result } = renderHook(() => usePageAccess(CHANNEL_POLICY));
    expect(result.current.can_view).toBe(true);
    expect(result.current.can_manage).toBe(true);
  });

  it("superadmin → superadmin tier 통과", () => {
    mock_auth({ enabled: true, user: make_user({ role: "superadmin", team_role: null }) });
    const { result } = renderHook(() => usePageAccess(ADMIN_POLICY));
    expect(result.current.can_view).toBe(true);
    expect(result.current.can_manage).toBe(true);
  });

  it("일반 user (team_role=owner) → superadmin tier 불통과", () => {
    mock_auth({ enabled: true, user: make_user({ role: "user", team_role: "owner" }) });
    const { result } = renderHook(() => usePageAccess(ADMIN_POLICY));
    expect(result.current.can_view).toBe(false);
    expect(result.current.can_manage).toBe(false);
  });
});
