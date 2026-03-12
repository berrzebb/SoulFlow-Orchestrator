/** 3-tier 워크스페이스 레이어 해석기. Global → Team → Personal 순서로 경로를 반환. */

import { join, resolve } from "node:path";
import type { JwtPayload } from "../auth/auth-service.js";

export class WorkspaceResolver {
  constructor(private readonly root: string) {}

  /**
   * [global, team, personal] 순서 (낮은 우선순위 → 높은 우선순위).
   * 워크플로우/스킬 병합 시 뒤쪽 경로가 앞쪽을 override.
   */
  layers(tid: string, wdir: string): string[] {
    return [
      this.root,
      join(this.root, "tenants", tid),
      resolve(this.root, wdir),
    ];
  }

  /** JWT payload에서 레이어 목록 반환. 인증 없으면 global만. */
  layers_for_jwt(payload: Pick<JwtPayload, "tid" | "wdir"> | null | undefined): string[] {
    if (!payload?.tid || !payload?.wdir) return [this.root];
    return this.layers(payload.tid, payload.wdir);
  }

  /** 개인 workspace 경로 (저장/삭제 대상). */
  personal_dir(payload: Pick<JwtPayload, "tid" | "wdir"> | null | undefined): string {
    if (!payload?.wdir) return this.root;
    return resolve(this.root, payload.wdir);
  }
}
