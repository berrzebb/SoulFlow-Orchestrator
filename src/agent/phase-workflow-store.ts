/** Phase Loop 워크플로우 + 에이전트 메시지 SQLite 영속화. TaskStore 패턴 준용. */

import { mkdir, rename, rmdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { now_iso } from "../utils/common.js";
import { with_sqlite } from "../utils/sqlite-helper.js";
import type { PhaseLoopState, PhaseMessage } from "./phase-loop.types.js";

export interface PhaseWorkflowStoreLike {
  upsert(state: PhaseLoopState): Promise<void>;
  get(workflow_id: string): Promise<PhaseLoopState | null>;
  list(): Promise<PhaseLoopState[]>;
  remove(workflow_id: string): Promise<boolean>;
  insert_message(workflow_id: string, phase_id: string, agent_id: string, msg: PhaseMessage): Promise<void>;
  get_messages(workflow_id: string, phase_id: string, agent_id: string): Promise<PhaseMessage[]>;
}

export class PhaseWorkflowStore implements PhaseWorkflowStoreLike {
  private readonly dir: string;
  private readonly sqlite_path: string;
  private readonly initialized: Promise<void>;

  constructor(dir: string) {
    this.dir = dir;
    this.sqlite_path = join(dir, "phase-workflows.db");
    this.initialized = this.ensure_initialized();
  }

  private async ensure_initialized(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await this.recover_if_dir(this.sqlite_path);
    with_sqlite(this.sqlite_path, (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS phase_workflows (
          workflow_id  TEXT PRIMARY KEY,
          status       TEXT NOT NULL DEFAULT 'running',
          channel      TEXT NOT NULL DEFAULT '',
          chat_id      TEXT NOT NULL DEFAULT '',
          updated_at   TEXT NOT NULL,
          payload_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_pw_status ON phase_workflows(status);
        CREATE INDEX IF NOT EXISTS idx_pw_updated ON phase_workflows(updated_at DESC);

        CREATE TABLE IF NOT EXISTS phase_agent_messages (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          workflow_id  TEXT NOT NULL,
          phase_id     TEXT NOT NULL,
          agent_id     TEXT NOT NULL,
          role         TEXT NOT NULL,
          content      TEXT NOT NULL,
          at           TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_pam_lookup
          ON phase_agent_messages(workflow_id, phase_id, agent_id);
      `);
      return true;
    });
  }

  /** sqlite_path가 디렉토리로 잘못 생성된 경우 내부 DB 파일을 꺼내 복구. */
  private async recover_if_dir(p: string): Promise<void> {
    try {
      const s = await stat(p);
      if (!s.isDirectory()) return;
      const base = p.split(/[\\/]/).pop() || "phase-workflows.db";
      const inner = join(p, base);
      const tmp = p + ".recovering";
      try {
        await stat(inner);
        await rename(inner, tmp);
        await rmdir(p);
        await rename(tmp, p);
      } catch {
        // inner DB 없으면 디렉토리만 제거 — with_sqlite가 새 DB 생성
        try { await rmdir(p); } catch { /* non-empty dir → skip */ }
      }
    } catch {
      // stat 실패 = 경로 미존재 → 정상
    }
  }

  private row_to_state(row: { payload_json: string } | undefined | null): PhaseLoopState | null {
    if (!row) return null;
    try {
      return JSON.parse(String(row.payload_json || "")) as PhaseLoopState;
    } catch {
      return null;
    }
  }

  async upsert(state: PhaseLoopState): Promise<void> {
    await this.initialized;
    with_sqlite(this.sqlite_path, (db) => {
      db.prepare(`
        INSERT INTO phase_workflows (workflow_id, status, channel, chat_id, updated_at, payload_json)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(workflow_id) DO UPDATE SET
          status = excluded.status,
          channel = excluded.channel,
          chat_id = excluded.chat_id,
          updated_at = excluded.updated_at,
          payload_json = excluded.payload_json
      `).run(
        state.workflow_id,
        state.status,
        state.channel || "",
        state.chat_id || "",
        now_iso(),
        JSON.stringify(state),
      );
      return true;
    });
  }

  async get(workflow_id: string): Promise<PhaseLoopState | null> {
    await this.initialized;
    const row = with_sqlite(this.sqlite_path, (db) =>
      db.prepare("SELECT payload_json FROM phase_workflows WHERE workflow_id = ? LIMIT 1")
        .get(workflow_id) as { payload_json: string } | undefined,
    ) || null;
    return this.row_to_state(row);
  }

  async list(): Promise<PhaseLoopState[]> {
    await this.initialized;
    const rows = with_sqlite(this.sqlite_path, (db) =>
      db.prepare("SELECT payload_json FROM phase_workflows ORDER BY updated_at DESC")
        .all() as Array<{ payload_json: string }>,
    ) || [];
    const out: PhaseLoopState[] = [];
    for (const row of rows) {
      const s = this.row_to_state(row);
      if (s) out.push(s);
    }
    return out;
  }

  async remove(workflow_id: string): Promise<boolean> {
    await this.initialized;
    const changes = with_sqlite(this.sqlite_path, (db) => {
      db.prepare("DELETE FROM phase_agent_messages WHERE workflow_id = ?").run(workflow_id);
      return db.prepare("DELETE FROM phase_workflows WHERE workflow_id = ?").run(workflow_id).changes;
    });
    return (changes ?? 0) > 0;
  }

  async insert_message(workflow_id: string, phase_id: string, agent_id: string, msg: PhaseMessage): Promise<void> {
    await this.initialized;
    with_sqlite(this.sqlite_path, (db) => {
      db.prepare(`
        INSERT INTO phase_agent_messages (workflow_id, phase_id, agent_id, role, content, at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(workflow_id, phase_id, agent_id, msg.role, msg.content, msg.at);
      return true;
    });
  }

  async get_messages(workflow_id: string, phase_id: string, agent_id: string): Promise<PhaseMessage[]> {
    await this.initialized;
    const rows = with_sqlite(this.sqlite_path, (db) =>
      db.prepare(`
        SELECT role, content, at FROM phase_agent_messages
        WHERE workflow_id = ? AND phase_id = ? AND agent_id = ?
        ORDER BY id ASC
      `).all(workflow_id, phase_id, agent_id) as Array<{ role: string; content: string; at: string }>,
    ) || [];
    return rows.map((r) => ({ role: r.role as PhaseMessage["role"], content: r.content, at: r.at }));
  }
}
