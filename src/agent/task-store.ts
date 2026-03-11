import { now_iso } from "../utils/common.js";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { with_sqlite, with_sqlite_strict } from "../utils/sqlite-helper.js";
import type { TaskState } from "../contracts.js";

export interface TaskStoreLike {
  upsert(task: TaskState): Promise<void>;
  get(task_id: string): Promise<TaskState | null>;
  find_waiting_by_chat(provider: string, chat_id: string): Promise<TaskState | null>;
  find_by_trigger_message_id(provider: string, trigger_message_id: string): Promise<TaskState | null>;
}

export class TaskStore implements TaskStoreLike {
  private readonly tasks_dir: string;
  private readonly sqlite_path: string;
  private readonly initialized: Promise<void>;

  constructor(tasks_dir: string) {
    this.tasks_dir = tasks_dir;
    this.sqlite_path = join(tasks_dir, "tasks.db");
    this.initialized = this.ensure_initialized();
  }

  private async ensure_initialized(): Promise<void> {
    await mkdir(this.tasks_dir, { recursive: true });
    with_sqlite_strict(this.sqlite_path,(db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS tasks (
          task_id TEXT PRIMARY KEY,
          status TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          provider TEXT NOT NULL DEFAULT '',
          chat_id TEXT NOT NULL DEFAULT '',
          trigger_message_id TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
        CREATE INDEX IF NOT EXISTS idx_tasks_updated_at ON tasks(updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_tasks_chat_status ON tasks(provider, chat_id, status);
        CREATE INDEX IF NOT EXISTS idx_tasks_trigger_msg ON tasks(provider, trigger_message_id);
        CREATE VIRTUAL TABLE IF NOT EXISTS tasks_fts USING fts5(
          content,
          task_id UNINDEXED,
          status UNINDEXED,
          content='tasks',
          content_rowid='rowid'
        );
        CREATE TRIGGER IF NOT EXISTS tasks_ai AFTER INSERT ON tasks BEGIN
          INSERT INTO tasks_fts(rowid, content, task_id, status)
          VALUES (new.rowid, new.payload_json, new.task_id, new.status);
        END;
        CREATE TRIGGER IF NOT EXISTS tasks_ad AFTER DELETE ON tasks BEGIN
          INSERT INTO tasks_fts(tasks_fts, rowid, content, task_id, status)
          VALUES ('delete', old.rowid, old.payload_json, old.task_id, old.status);
        END;
        CREATE TRIGGER IF NOT EXISTS tasks_au AFTER UPDATE ON tasks BEGIN
          INSERT INTO tasks_fts(tasks_fts, rowid, content, task_id, status)
          VALUES ('delete', old.rowid, old.payload_json, old.task_id, old.status);
          INSERT INTO tasks_fts(rowid, content, task_id, status)
          VALUES (new.rowid, new.payload_json, new.task_id, new.status);
        END;
      `);
      // 기존 DB 마이그레이션 — 이미 존재하면 무시
      try {
        db.exec("ALTER TABLE tasks ADD COLUMN trigger_message_id TEXT NOT NULL DEFAULT ''");
        db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_trigger_msg ON tasks(provider, trigger_message_id)");
      } catch { /* 이미 존재하면 무시 */ }
      return true;
    });
  }

  private normalize_task(task: TaskState): TaskState {
    const mem = task.memory || {};
    return {
      ...task,
      objective: task.objective || String(mem.objective || ""),
      channel: task.channel || String(mem.channel || ""),
      chatId: task.chatId || String(mem.chat_id || ""),
      memory: { ...mem },
    };
  }

  private row_to_task(row: { payload_json: string } | undefined | null): TaskState | null {
    if (!row) return null;
    try {
      const parsed = JSON.parse(String(row.payload_json || "")) as TaskState;
      return this.normalize_task(parsed);
    } catch {
      return null;
    }
  }

  async upsert(task: TaskState): Promise<void> {
    await this.initialized;
    const normalized = this.normalize_task(task);
    const provider = String(normalized.channel || normalized.memory.channel || "").trim();
    const chat_id = String(normalized.chatId || normalized.memory.chat_id || "").trim();
    const trigger_message_id = String(normalized.memory.__trigger_message_id || "").trim();
    with_sqlite(this.sqlite_path,(db) => {
      db.prepare(`
        INSERT INTO tasks (task_id, status, updated_at, payload_json, provider, chat_id, trigger_message_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(task_id) DO UPDATE SET
          status = excluded.status,
          updated_at = excluded.updated_at,
          payload_json = excluded.payload_json,
          provider = excluded.provider,
          chat_id = excluded.chat_id,
          trigger_message_id = excluded.trigger_message_id
      `).run(
        normalized.taskId,
        String(normalized.status || "running"),
        now_iso(),
        JSON.stringify(normalized),
        provider,
        chat_id,
        trigger_message_id,
      );
      return true;
    });
  }

  async get(task_id: string): Promise<TaskState | null> {
    await this.initialized;
    const row = with_sqlite(this.sqlite_path,(db) => db.prepare(
      "SELECT payload_json FROM tasks WHERE task_id = ? LIMIT 1",
    ).get(task_id) as { payload_json: string } | undefined) || null;
    return this.row_to_task(row);
  }

  async list(): Promise<TaskState[]> {
    await this.initialized;
    const rows = with_sqlite(this.sqlite_path,(db) => db.prepare(
      "SELECT payload_json FROM tasks ORDER BY updated_at DESC",
    ).all() as Array<{ payload_json: string }>) || [];
    const out: TaskState[] = [];
    for (const row of rows) {
      const task = this.row_to_task(row);
      if (task) out.push(task);
    }
    return out;
  }

  async list_resumable(): Promise<TaskState[]> {
    const rows = await this.list();
    return rows.filter((t) => ["running", "waiting_approval", "waiting_user_input", "max_turns_reached"].includes(t.status));
  }

  async find_waiting_by_chat(provider: string, chat_id: string): Promise<TaskState | null> {
    await this.initialized;
    const row = with_sqlite(this.sqlite_path, (db) => db.prepare(
      `SELECT payload_json FROM tasks
       WHERE provider = ? AND chat_id = ? AND status IN ('waiting_user_input', 'waiting_approval', 'failed', 'max_turns_reached')
       ORDER BY updated_at DESC LIMIT 1`,
    ).get(provider, chat_id) as { payload_json: string } | undefined) || null;
    return this.row_to_task(row);
  }

  async find_by_trigger_message_id(provider: string, trigger_message_id: string): Promise<TaskState | null> {
    if (!trigger_message_id) return null;
    await this.initialized;
    const row = with_sqlite(this.sqlite_path, (db) => db.prepare(
      `SELECT payload_json FROM tasks
       WHERE provider = ? AND trigger_message_id = ?
       ORDER BY updated_at DESC LIMIT 1`,
    ).get(provider, trigger_message_id) as { payload_json: string } | undefined) || null;
    return this.row_to_task(row);
  }
}
