/**
 * FE-0: router.tsx와 PAGE_POLICIES의 공유 경로 계약.
 * 이 파일이 단일 소스 — router.tsx와 access-policy.test.ts가 여기서 import한다.
 */

export const PATHS = {
  LOGIN: "/login",
  ROOT: "/",
  SETUP: "/setup",
  CHANNELS: "/channels",
  PROVIDERS: "/providers",
  SECRETS: "/secrets",
  OAUTH: "/oauth",
  SETTINGS: "/settings",
  CHAT: "/chat",
  WORKSPACE: "/workspace",
  WORKFLOWS: "/workflows",
  WORKFLOWS_NEW: "/workflows/new",
  WORKFLOWS_EDIT: "/workflows/edit/:name",
  WORKFLOW_DETAIL: "/workflows/:id",
  PROMPTING: "/prompting",
  KANBAN: "/kanban",
  WBS: "/wbs",
  ADMIN: "/admin",
} as const;

export type AppPath = (typeof PATHS)[keyof typeof PATHS];

/** PAGE_POLICIES 테스트 및 router.tsx의 공유 경로 목록. */
export const ROUTER_PATHS: readonly AppPath[] = Object.values(PATHS) as AppPath[];
