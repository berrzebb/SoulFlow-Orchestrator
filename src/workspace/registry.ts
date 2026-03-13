/**
 * WorkspaceRegistry — (team_id, user_id) 기반 per-user 런타임 레지스트리.
 *
 * Phase 4: 경로 계산 + 디렉토리 보장 + 활성 세션 추적
 * Phase 8: WorkspaceRuntime 기반 런타임 locator — identity + lifecycle 관리
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { WorkspaceRuntime } from "./runtime.js";

export { WorkspaceRuntime };

export interface WorkspaceKey {
  team_id: string;
  user_id: string;
}

const USER_WORKSPACE_SUBDIRS = ["runtime", "workflows", "skills", "templates"];

export class WorkspaceRegistry {
  private readonly entries = new Map<string, WorkspaceRuntime>();

  constructor(private readonly workspace_root: string) {}

  private make_key(team_id: string, user_id: string): string {
    return `${team_id}::${user_id}`;
  }

  /**
   * (team_id, user_id)로 WorkspaceRuntime을 생성하고 디렉토리를 초기화한다.
   * 이미 등록된 경우 touch()만 호출하여 반환.
   */
  get_or_create(key: WorkspaceKey): WorkspaceRuntime {
    const k = this.make_key(key.team_id, key.user_id);
    const existing = this.entries.get(k);
    if (existing) {
      existing.touch();
      return existing;
    }

    const workspace_path = join(
      this.workspace_root,
      "tenants",
      key.team_id,
      "users",
      key.user_id,
    );

    for (const sub of USER_WORKSPACE_SUBDIRS) {
      mkdirSync(join(workspace_path, sub), { recursive: true });
    }

    const layers = [
      this.workspace_root,
      join(this.workspace_root, "tenants", key.team_id),
      workspace_path,
    ];
    const runtime = new WorkspaceRuntime(key.team_id, key.user_id, workspace_path, layers);
    this.entries.set(k, runtime);
    return runtime;
  }

  /** 워크스페이스 경로만 빠르게 계산 (디렉토리 생성 없음). */
  resolve_path(team_id: string, user_id: string): string {
    return join(this.workspace_root, "tenants", team_id, "users", user_id);
  }

  /**
   * 특정 사용자의 런타임 중지 + 레지스트리에서 제거.
   * 실제 파일 시스템 삭제는 수행하지 않는다.
   */
  remove(key: WorkspaceKey): boolean {
    const k = this.make_key(key.team_id, key.user_id);
    const runtime = this.entries.get(k);
    if (!runtime) return false;
    runtime.stop();
    return this.entries.delete(k);
  }

  /** 활성 런타임 조회. touch()로 last_accessed_at 갱신. 미등록 시 null. */
  get_runtime(key: WorkspaceKey): WorkspaceRuntime | null {
    const k = this.make_key(key.team_id, key.user_id);
    const runtime = this.entries.get(k);
    if (!runtime) return null;
    runtime.touch();
    return runtime;
  }

  /** 특정 런타임 중지 + 제거. */
  stop_runtime(key: WorkspaceKey): boolean {
    return this.remove(key);
  }

  /** 현재 활성 런타임 목록. */
  list_active(): WorkspaceRuntime[] {
    return [...this.entries.values()];
  }

  /** 특정 팀의 활성 런타임 목록. */
  list_by_team(team_id: string): WorkspaceRuntime[] {
    return this.list_active().filter((e) => e.team_id === team_id);
  }

  /** 등록된 런타임 수. */
  get size(): number {
    return this.entries.size;
  }

  /** 모든 런타임 중지 + 레지스트리 클리어. */
  stop_all(): void {
    for (const runtime of this.entries.values()) runtime.stop();
    this.entries.clear();
  }
}
