import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import Database from "better-sqlite3";

type DatabaseSync = Database.Database;
import type { TaskState } from "../contracts.js";

export interface TaskStoreLike {
  upsert(task: TaskState): Promise<void>;
  get(task_id: string): Promise<TaskState | null>;
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

  private with_sqlite<T>(run: (db: DatabaseSync) => T): T | null {
    let db: DatabaseSync | null = null;
    try {
      db = new Database(this.sqlite_path);
      return run(db);
    } catch {
      return null;
    } finally {
      try {
        db?.close();
      } catch {
        // no-op
      }
    }
  }

  private async ensure_initialized(): Promise<void> {
    await mkdir(this.tasks_dir, { recursive: true });
    this.with_sqlite((db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS tasks (
          task_id TEXT PRIMARY KEY,
          status TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          payload_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
        CREATE INDEX IF NOT EXISTS idx_tasks_updated_at ON tasks(updated_at DESC);
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
      return true;
    });
  }

  private normalize_task(task: TaskState): TaskState {
    return { ...task, memory: { ...(task.memory || {}) } };
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
    this.with_sqlite((db) => {
      db.prepare(`
        INSERT INTO tasks (task_id, status, updated_at, payload_json)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(task_id) DO UPDATE SET
          status = excluded.status,
          updated_at = excluded.updated_at,
          payload_json = excluded.payload_json
      `).run(
        normalized.taskId,
        String(normalized.status || "running"),
        new Date().toISOString(),
        JSON.stringify(normalized),
      );
      return true;
    });
  }

  async get(task_id: string): Promise<TaskState | null> {
    await this.initialized;
    const row = this.with_sqlite((db) => db.prepare(
      "SELECT payload_json FROM tasks WHERE task_id = ? LIMIT 1",
    ).get(task_id) as { payload_json: string } | undefined) || null;
    return this.row_to_task(row);
  }

  async list(): Promise<TaskState[]> {
    await this.initialized;
    const rows = this.with_sqlite((db) => db.prepare(
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
    return rows.filter((t) => ["running", "waiting_approval", "max_turns_reached"].includes(t.status));
  }
}
