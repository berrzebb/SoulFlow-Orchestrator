/**
 * FE-1: 페이지 접근 권한 공통 계약.
 *
 * tier_satisfied()를 순수 함수로 분리해 테스트 가능성을 보장한다.
 * use_page_access()는 AuthUser 상태를 구독하는 React 훅이다.
 */

import { useAuthStatus, useAuthUser } from "./use-auth";
import type { AuthUser } from "./use-auth";
import { TEAM_ROLE_RANK } from "../pages/access-policy";
import type { VisibilityTier, PagePolicy } from "../pages/access-policy";

export interface PageAccess {
  /** 페이지를 열람할 수 있는가. */
  can_view: boolean;
  /** 페이지 내 쓰기/관리 작업을 할 수 있는가. */
  can_manage: boolean;
}

/**
 * 특정 등급 요건을 현재 사용자가 충족하는지 판별하는 순수 함수.
 *
 * @param auth_enabled - 서버에서 auth가 활성화된 경우에만 역할 검사 수행.
 *   비활성 상태에서는 public 이외 모든 tier도 허용 (싱글유저 모드 지원).
 */
export function tier_satisfied(
  tier: VisibilityTier,
  user: AuthUser | null | undefined,
  auth_enabled: boolean,
): boolean {
  if (tier === "public") return true;
  if (!auth_enabled) return true;   // auth 비활성 → 싱글유저 모드 — 모든 페이지 허용
  if (!user) return false;          // 미인증

  // superadmin은 superadmin 전용 페이지 포함 모든 tier 통과
  if (user.role === "superadmin") return true;

  if (tier === "superadmin") return false;  // superadmin이 아니면 불가
  if (tier === "authenticated") return true;

  // team_* tier: team_role 필요
  const team_role = user.team_role ?? null;
  if (!team_role) return false;

  const rank = TEAM_ROLE_RANK[team_role] ?? 0;
  if (tier === "team_member") return rank >= TEAM_ROLE_RANK.viewer;
  if (tier === "team_manager") return rank >= TEAM_ROLE_RANK.manager;
  if (tier === "team_owner") return rank >= TEAM_ROLE_RANK.owner;

  return false;
}

/**
 * 현재 인증 상태를 기반으로 페이지 접근 권한을 반환하는 훅.
 *
 * @example
 * const { can_view, can_manage } = usePageAccess(get_page_policy("/channels")!);
 */
export function usePageAccess(policy: PagePolicy): PageAccess {
  const { data: auth_status } = useAuthStatus();
  const { data: auth_user } = useAuthUser();
  const auth_enabled = auth_status?.enabled ?? false;

  return {
    can_view: tier_satisfied(policy.view, auth_user, auth_enabled),
    can_manage: tier_satisfied(policy.manage, auth_user, auth_enabled),
  };
}
