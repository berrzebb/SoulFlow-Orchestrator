/**
 * 멀티테넌트 워크스페이스 문맥 추상화.
 *
 * 3-tier 스코프 계층: AdminWorkspace > TeamWorkspace > UserWorkspace.
 * 단일 유저 모드에선 모든 스코프가 동일 경로로 축소된다.
 */

import { join } from "node:path";

/** 워크스페이스 문맥 기본 — 워크스페이스 루트 경로. */
export interface WorkspaceContext {
  readonly workspace: string;
}

/** 관리자(글로벌) 워크스페이스 — 전역 리소스 경로. */
export interface AdminWorkspace extends WorkspaceContext {
  readonly admin_runtime: string;
}

/** 팀 워크스페이스 — 팀 스코프 리소스 경로. */
export interface TeamWorkspace extends AdminWorkspace {
  readonly team_id: string;
  readonly team_runtime: string;
}

/** 유저 워크스페이스 — 개인 스코프 리소스 경로. */
export interface UserWorkspace extends TeamWorkspace {
  readonly user_id: string;
  readonly user_runtime: string;
  readonly user_content: string;
}

export interface CreateContextOpts {
  workspace: string;
  team_id?: string;
  user_id?: string;
}

/**
 * UserWorkspace 문맥 생성.
 * team_id/user_id 미지정 시 단일 유저 모드 — 모든 스코프가 workspace/runtime/ 으로 축소.
 */
export function create_workspace_context(opts: CreateContextOpts): UserWorkspace {
  const { workspace, team_id = "", user_id = "" } = opts;
  const admin_runtime = join(workspace, "runtime");

  if (!team_id || !user_id) {
    return {
      workspace,
      admin_runtime,
      team_id: "",
      team_runtime: admin_runtime,
      user_id: "",
      user_runtime: admin_runtime,
      user_content: workspace,
    };
  }

  const team_root = join(workspace, "tenants", team_id);
  const user_root = join(team_root, "users", user_id);

  return {
    workspace,
    admin_runtime,
    team_id,
    team_runtime: join(team_root, "runtime"),
    user_id,
    user_runtime: join(user_root, "runtime"),
    user_content: user_root,
  };
}
