/**
 * FE-0: 화면별 접근 정책 인벤토리.
 *
 * 각 라우트에 대해 "열람 권한"과 "관리 권한"을 정의한다.
 * 실제 enforcement는 FE-2+에서 RequireRole / route guard로 구현.
 */

import type { TeamRole } from "../hooks/use-auth";

export type SystemRole = "superadmin" | "user";

/**
 * 가시성 등급 계층 (높을수록 제한적):
 * public < authenticated < team_member < team_manager < team_owner < superadmin
 */
export type VisibilityTier =
  | "public"          // 로그인 불필요 (login 페이지)
  | "authenticated"   // 로그인만 필요 (auth 비활성 시 모두 허용)
  | "team_member"     // viewer 이상 (팀 소속 필요)
  | "team_manager"    // manager 이상 (팀 관리자)
  | "team_owner"      // owner 전용
  | "superadmin";     // superadmin 전용

export interface PagePolicy {
  /** 라우터 path 패턴 (react-router-dom 형식). */
  path: string;
  /** 페이지 열람에 필요한 최소 등급. */
  view: VisibilityTier;
  /** 페이지 내 쓰기/관리 작업에 필요한 최소 등급. */
  manage: VisibilityTier;
  /** 페이지 설명 (감사·문서용). */
  description: string;
}

/** 팀 역할 서열 (높을수록 권한 큼). */
export const TEAM_ROLE_RANK: Record<TeamRole, number> = {
  owner: 4,
  manager: 3,
  member: 2,
  viewer: 1,
};

/**
 * 전체 라우트 접근 정책 목록.
 * router.tsx에 등록된 모든 path와 1:1 대응해야 한다.
 */
export const PAGE_POLICIES: PagePolicy[] = [
  // ── 공개/시스템 ─────────────────────────────────
  {
    path: "/login",
    view: "public",
    manage: "public",
    description: "로그인 페이지 — 인증 불필요",
  },
  {
    path: "/setup",
    view: "superadmin",
    manage: "superadmin",
    description: "초기 설정 위저드 — 최초 부트스트랩 전용",
  },

  // ── 공통 (모든 인증 사용자) ───────────────────────
  {
    path: "/",
    view: "authenticated",
    manage: "authenticated",
    description: "대시보드 개요",
  },
  {
    path: "/chat",
    view: "authenticated",
    manage: "authenticated",
    description: "채팅 (개인 세션)",
  },
  {
    path: "/prompting",
    view: "authenticated",
    manage: "authenticated",
    description: "프롬프트 스튜디오",
  },
  {
    path: "/workspace",
    view: "authenticated",
    manage: "authenticated",
    description: "개인 워크스페이스 (메모리·스킬·세션)",
  },
  {
    path: "/settings",
    view: "authenticated",
    manage: "team_owner",
    description: "설정 — 열람은 모두, 변경은 owner",
  },

  // ── 팀 협업 (team_member 이상) ───────────────────
  {
    path: "/workflows",
    view: "authenticated",
    manage: "team_member",
    description: "워크플로우 목록",
  },
  {
    path: "/workflows/:id",
    view: "authenticated",
    manage: "team_member",
    description: "워크플로우 실행 상세",
  },
  {
    path: "/workflows/new",
    view: "team_member",
    manage: "team_member",
    description: "워크플로우 빌더 (신규)",
  },
  {
    path: "/workflows/edit/:name",
    view: "team_member",
    manage: "team_member",
    description: "워크플로우 빌더 (수정)",
  },
  {
    path: "/kanban",
    view: "authenticated",
    manage: "team_member",
    description: "칸반 보드",
  },
  {
    path: "/wbs",
    view: "authenticated",
    manage: "team_member",
    description: "WBS 작업 계획",
  },

  // ── 팀 관리 (team_manager 이상) ──────────────────
  {
    path: "/channels",
    view: "team_manager",
    manage: "team_manager",
    description: "채널 구성 — 관리자 이상",
  },
  {
    path: "/providers",
    view: "team_manager",
    manage: "team_owner",
    description: "AI 프로바이더 — 열람 manager, 변경 owner",
  },
  {
    path: "/secrets",
    view: "team_manager",
    manage: "team_manager",
    description: "시크릿 볼트",
  },
  {
    path: "/oauth",
    view: "team_manager",
    manage: "team_owner",
    description: "OAuth 앱 연동 — 열람 manager, 변경 owner",
  },

  // ── superadmin 전용 ──────────────────────────────
  {
    path: "/admin",
    view: "superadmin",
    manage: "superadmin",
    description: "관리자 콘솔 — superadmin 전용",
  },
];

/** path로 정책을 조회한다. */
export function get_page_policy(path: string): PagePolicy | undefined {
  return PAGE_POLICIES.find((p) => p.path === path);
}
