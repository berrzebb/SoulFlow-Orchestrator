/** Agent 세션 영속화 스토어. 오케스트레이터가 각 백엔드의 세션을 관리. */

import { with_sqlite } from "../utils/sqlite-helper.js";
import { now_iso } from "../utils/common.js";
import type { AgentSession, AgentBackendId } from "./agent.types.js";

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24시간

const INIT_SQL = `
CREATE TABLE IF NOT EXISTS agent_sessions (
  session_id TEXT PRIMARY KEY,
  backend TEXT NOT NULL,
  task_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_as_task ON agent_sessions(task_id);
`;

type SessionRow = {
  session_id: string;
  backend: string;
  task_id: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
  metadata_json: string;
};

export class AgentSessionStore {
  constructor(
    private readonly db_path: string,
    private readonly ttl_ms = DEFAULT_TTL_MS,
  ) {
    this._ensure_schema();
  }

  save(session: AgentSession, opts?: { task_id?: string; metadata?: Record<string, unknown> }): void {
    const now = now_iso();
    const expires_at = new Date(Date.now() + this.ttl_ms).toISOString();
    const metadata_json = JSON.stringify(opts?.metadata || {});

    with_sqlite(this.db_path, (db) => {
      db.prepare(`
        INSERT INTO agent_sessions (session_id, backend, task_id, created_at, updated_at, expires_at, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
          updated_at = excluded.updated_at,
          expires_at = excluded.expires_at,
          metadata_json = excluded.metadata_json
      `).run(session.session_id, session.backend, opts?.task_id || null, session.created_at || now, now, expires_at, metadata_json);
      return true;
    });
  }

  find_by_task(task_id: string): AgentSession | null {
    const row = with_sqlite(this.db_path, (db) =>
      db.prepare("SELECT * FROM agent_sessions WHERE task_id = ? AND expires_at > ? ORDER BY updated_at DESC LIMIT 1").get(task_id, now_iso()) as SessionRow | undefined,
    );
    return row ? this._to_session(row) : null;
  }

  prune_expired(): number {
    const result = with_sqlite(this.db_path, (db) => {
      const info = db.prepare("DELETE FROM agent_sessions WHERE expires_at <= ?").run(now_iso());
      return info.changes;
    });
    return result ?? 0;
  }

  private _to_session(row: SessionRow): AgentSession {
    let metadata: Record<string, unknown> | undefined;
    try {
      const parsed = JSON.parse(row.metadata_json || "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && Object.keys(parsed).length > 0) {
        metadata = parsed as Record<string, unknown>;
      }
    } catch { /* 파싱 실패 시 무시 */ }
    return {
      session_id: row.session_id,
      backend: row.backend as AgentBackendId,
      created_at: row.created_at,
      task_id: row.task_id || undefined,
      metadata,
    };
  }

  private _ensure_schema(): void {
    with_sqlite(this.db_path, (db) => {
      db.exec(INIT_SQL);
      return true;
    });
  }
}
