/**
 * WorkspaceRegistry — (team_id, user_id, workspace_path) 기반 워크스페이스 경로 레지스트리.
 *
 * 현재 구현 범위 (Phase 4 초기):
 *   - 워크스페이스 경로 계산 및 디렉토리 보장
 *   - 활성 세션 추적 (team_id × user_id → workspace_path 매핑)
 *   - get_or_create(): 경로 계산 + 디렉토리 초기화 (런타임 부트스트랩은 별도)
 *
 * 추후 확장 (Phase 4 완성):
 *   - per-user RuntimeApp 인스턴스 관리 (lazy bootstrap)
 *   - stop_all(): 모든 사용자 런타임 종료
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";

export interface WorkspaceKey {
  team_id: string;
  user_id: string;
}

export interface WorkspaceEntry {
  team_id: string;
  user_id: string;
  workspace_path: string;
  /** 최초 등록 시각 (ISO). */
  registered_at: string;
  /** 마지막 접근 시각 (ISO). */
  last_accessed_at: string;
}

const USER_WORKSPACE_SUBDIRS = ["runtime", "workflows", "skills", "templates"];

export class WorkspaceRegistry {
  private readonly entries = new Map<string, WorkspaceEntry>();

  constructor(private readonly workspace_root: string) {}

  private make_key(team_id: string, user_id: string): string {
    return `${team_id}::${user_id}`;
  }

  /**
   * (team_id, user_id)로 workspace_path를 계산하고 디렉토리를 초기화한다.
   * 이미 등록된 경우 last_accessed_at만 갱신하여 반환.
   */
  get_or_create(key: WorkspaceKey): WorkspaceEntry {
    const k = this.make_key(key.team_id, key.user_id);
    const existing = this.entries.get(k);
    if (existing) {
      existing.last_accessed_at = new Date().toISOString();
      return existing;
    }

    const workspace_path = join(
      this.workspace_root,
      "tenants",
      key.team_id,
      "users",
      key.user_id,
    );

    // 개인 워크스페이스 하위 디렉토리 보장
    for (const sub of USER_WORKSPACE_SUBDIRS) {
      mkdirSync(join(workspace_path, sub), { recursive: true });
    }

    const now = new Date().toISOString();
    const entry: WorkspaceEntry = {
      team_id: key.team_id,
      user_id: key.user_id,
      workspace_path,
      registered_at: now,
      last_accessed_at: now,
    };
    this.entries.set(k, entry);
    return entry;
  }

  /** 워크스페이스 경로만 빠르게 계산 (디렉토리 생성 없음). */
  resolve_path(team_id: string, user_id: string): string {
    return join(this.workspace_root, "tenants", team_id, "users", user_id);
  }

  /**
   * 특정 사용자의 레지스트리 항목 제거.
   * 실제 파일 시스템 삭제는 수행하지 않는다.
   */
  remove(key: WorkspaceKey): boolean {
    return this.entries.delete(this.make_key(key.team_id, key.user_id));
  }

  /** 현재 활성 워크스페이스 목록 반환. */
  list_active(): WorkspaceEntry[] {
    return [...this.entries.values()];
  }

  /** 특정 팀의 활성 워크스페이스 목록. */
  list_by_team(team_id: string): WorkspaceEntry[] {
    return this.list_active().filter((e) => e.team_id === team_id);
  }

  /** 등록된 워크스페이스 수. */
  get size(): number {
    return this.entries.size;
  }

  /**
   * 모든 항목 제거 (shutdown 시 호출).
   * 실제 파일·프로세스 정리는 호출 측 책임.
   */
  clear(): void {
    this.entries.clear();
  }
}
