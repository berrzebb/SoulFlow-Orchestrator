/**
 * ScopedProviderResolver — global·team·personal 3단계 프로바이더 병합.
 * 읽기 전용 뷰 계층: 각 스토어는 자신의 스코프만 write, Resolver는 merge만 수행.
 *
 * 우선순위 (높을수록 override): personal > team > global
 * 같은 name+type 충돌 시 상위 스코프가 하위 스코프를 숨김.
 */

import { join } from "node:path";
import { existsSync } from "node:fs";
import type { SharedProviderRecord } from "./admin-store.js";
import { TeamStore, type TeamProviderRecord } from "./team-store.js";

/** AdminStore 또는 AuthService 중 공유 프로바이더 읽기에 필요한 최소 계약. */
export interface GlobalProviderSource {
  list_shared_providers(enabled_only?: boolean): SharedProviderRecord[];
  get_shared_provider(id: string): SharedProviderRecord | null;
}

export type ProviderScope = "global" | "team" | "personal";

/** 스코프 어노테이션이 붙은 정규화된 프로바이더. */
export interface ScopedProvider {
  id: string;
  name: string;
  type: string;
  model: string;
  config: Record<string, unknown>;
  api_key_ref: string;
  enabled: boolean;
  created_at: string;
  scope: ProviderScope;
  /** team 스코프일 때만 존재. */
  team_id?: string;
}

function from_global(r: SharedProviderRecord): ScopedProvider {
  return { ...r, scope: "global" };
}

function from_team(r: TeamProviderRecord): ScopedProvider {
  return { ...r, scope: "team", team_id: r.team_id };
}

export class ScopedProviderResolver {
  constructor(
    private readonly admin: GlobalProviderSource,
    private readonly workspace_root: string,
  ) {}

  /**
   * TeamStore 인스턴스를 lazy하게 반환.
   * team.db가 없으면 null 반환 (팀 미초기화 상태 허용).
   */
  private team_store(team_id: string): TeamStore | null {
    const db_path = join(this.workspace_root, "tenants", team_id, "team.db");
    if (!existsSync(db_path)) return null;
    return new TeamStore(db_path, team_id);
  }

  /**
   * global + team 프로바이더 병합 목록.
   * 같은 name+type: team이 global을 숨김.
   */
  list(team_id: string, enabled_only = false): ScopedProvider[] {
    const global_providers = this.admin.list_shared_providers(enabled_only).map(from_global);
    const team = this.team_store(team_id);
    const team_providers = team ? team.list_providers(enabled_only).map(from_team) : [];

    // team이 global을 override (같은 name+type 기준)
    const seen = new Set<string>();
    const result: ScopedProvider[] = [];
    for (const p of [...team_providers, ...global_providers]) {
      const key = `${p.name}::${p.type}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(p);
    }
    return result;
  }

  /**
   * name+type으로 단일 프로바이더 조회.
   * 우선순위: team > global.
   * personal 스코프는 호출 측에서 먼저 확인해야 함.
   */
  find(team_id: string, name: string, type: string): ScopedProvider | null {
    const team = this.team_store(team_id);
    if (team) {
      const team_match = team.list_providers().find((p) => p.name === name && p.type === type);
      if (team_match) return from_team(team_match);
    }
    const global_match = this.admin.list_shared_providers().find((p) => p.name === name && p.type === type);
    if (global_match) return from_global(global_match);
    return null;
  }

  /**
   * id로 단일 프로바이더 조회. scope에 따라 올바른 스토어 선택.
   */
  get_by_id(team_id: string, id: string, scope: ProviderScope): ScopedProvider | null {
    if (scope === "global") {
      const r = this.admin.get_shared_provider(id);
      return r ? from_global(r) : null;
    }
    if (scope === "team") {
      const team = this.team_store(team_id);
      if (!team) return null;
      const r = team.get_provider(id);
      return r ? from_team(r) : null;
    }
    return null;
  }

  /** TeamStore를 열어 반환 (없으면 생성). 팀 프로바이더 write 작업용. */
  open_team_store(team_id: string): TeamStore {
    const db_path = join(this.workspace_root, "tenants", team_id, "team.db");
    return new TeamStore(db_path, team_id);
  }
}
