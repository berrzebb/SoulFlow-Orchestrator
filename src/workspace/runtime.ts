/**
 * per-(team_id, user_id) 런타임 핸들.
 * identity + lifecycle + 3-tier 경로 locator.
 *
 * UserWorkspace 호환 — 라우트에서 스코프별 경로에 직접 접근 가능.
 */

import { join } from "node:path";
import type { UserWorkspace } from "./workspace-context.js";

export class WorkspaceRuntime implements UserWorkspace {
  readonly started_at: string;
  readonly workspace_layers: readonly string[];
  readonly runtime_path: string;
  last_accessed_at: string;
  private _stopped = false;

  constructor(
    readonly team_id: string,
    readonly user_id: string,
    readonly workspace_path: string,
    workspace_layers?: string[],
  ) {
    const now = new Date().toISOString();
    this.started_at = now;
    this.last_accessed_at = now;
    this.workspace_layers = workspace_layers ? [...workspace_layers] : [];
    this.runtime_path = join(workspace_path, "runtime");
  }

  // ── UserWorkspace 3-tier 경로 ──

  /** 워크스페이스 루트 (= workspace_layers[0]). */
  get workspace(): string { return this.workspace_layers[0] ?? this.workspace_path; }

  /** 글로벌 런타임 경로 (config, security, providers, definitions). */
  get admin_runtime(): string { return join(this.workspace, "runtime"); }

  /** 팀 런타임 경로 (channels, oauth, cron, dlq, datasources). */
  get team_runtime(): string {
    return this.workspace_layers[1]
      ? join(this.workspace_layers[1], "runtime")
      : this.admin_runtime;
  }

  /** 유저 런타임 경로 (sessions, decisions, events). */
  get user_runtime(): string { return this.runtime_path; }

  /** 유저 콘텐츠 루트 (= workspace_path). */
  get user_content(): string { return this.workspace_path; }

  // ── lifecycle ──

  get is_active(): boolean { return !this._stopped; }

  touch(): void {
    if (this._stopped) throw new Error("Cannot touch stopped runtime");
    this.last_accessed_at = new Date().toISOString();
  }

  stop(): void { this._stopped = true; }
}
