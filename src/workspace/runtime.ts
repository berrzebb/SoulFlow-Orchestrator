/** per-(team_id, user_id) 런타임 핸들. identity + lifecycle + 경로 locator. */

import { join } from "node:path";

export class WorkspaceRuntime {
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

  get is_active(): boolean { return !this._stopped; }

  touch(): void {
    if (this._stopped) throw new Error("Cannot touch stopped runtime");
    this.last_accessed_at = new Date().toISOString();
  }

  stop(): void { this._stopped = true; }
}
