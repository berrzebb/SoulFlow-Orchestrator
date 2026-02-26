import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import type { ChannelProvider } from "./types.js";

type DatabaseSync = Database.Database;

type DlqRow = {
  at: string;
  provider: string;
  chat_id: string;
  message_id: string;
  sender_id: string;
  reply_to: string;
  thread_id: string;
  retry_count: number;
  error: string;
  content: string;
  metadata_json: string;
};

export type DispatchDlqRecord = {
  at: string;
  provider: ChannelProvider;
  chat_id: string;
  message_id: string;
  sender_id: string;
  reply_to: string;
  thread_id: string;
  retry_count: number;
  error: string;
  content: string;
  metadata: Record<string, unknown>;
};

export interface DispatchDlqStoreLike {
  append(record: DispatchDlqRecord): Promise<void>;
  list(limit?: number): Promise<DispatchDlqRecord[]>;
  get_path(): string;
}

export class SqliteDispatchDlqStore implements DispatchDlqStoreLike {
  readonly sqlite_path: string;
  private readonly initialized: Promise<void>;
  private write_queue: Promise<void> = Promise.resolve();

  constructor(sqlite_path: string) {
    this.sqlite_path = resolve(String(sqlite_path || "runtime/dlq/dlq.db"));
    this.initialized = this.ensure_initialized();
  }

  get_path(): string {
    return this.sqlite_path;
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
    await mkdir(dirname(this.sqlite_path), { recursive: true });
    this.with_sqlite((db) => {
      db.exec(`
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS outbound_dlq (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          at TEXT NOT NULL,
          provider TEXT NOT NULL,
          chat_id TEXT NOT NULL,
          message_id TEXT NOT NULL,
          sender_id TEXT NOT NULL,
          reply_to TEXT NOT NULL,
          thread_id TEXT NOT NULL,
          retry_count INTEGER NOT NULL,
          error TEXT NOT NULL,
          content TEXT NOT NULL,
          metadata_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_outbound_dlq_at
          ON outbound_dlq(at DESC);
        CREATE INDEX IF NOT EXISTS idx_outbound_dlq_provider_chat
          ON outbound_dlq(provider, chat_id, at DESC);
      `);
      return true;
    });
  }

  async append(record: DispatchDlqRecord): Promise<void> {
    await this.initialized;
    const job = this.write_queue.then(async () => {
      this.with_sqlite((db) => {
        db.prepare(`
          INSERT INTO outbound_dlq (
            at, provider, chat_id, message_id, sender_id, reply_to, thread_id,
            retry_count, error, content, metadata_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          String(record.at || new Date().toISOString()),
          String(record.provider || ""),
          String(record.chat_id || ""),
          String(record.message_id || ""),
          String(record.sender_id || ""),
          String(record.reply_to || ""),
          String(record.thread_id || ""),
          Math.max(0, Number(record.retry_count || 0)),
          String(record.error || "unknown_error"),
          String(record.content || ""),
          JSON.stringify(record.metadata || {}),
        );
        return true;
      });
    });
    this.write_queue = job.then(() => undefined, () => undefined);
    await job;
  }

  async list(limit = 100): Promise<DispatchDlqRecord[]> {
    await this.initialized;
    const rows = this.with_sqlite((db) => db.prepare(`
      SELECT at, provider, chat_id, message_id, sender_id, reply_to, thread_id, retry_count, error, content, metadata_json
      FROM outbound_dlq
      ORDER BY id DESC
      LIMIT ?
    `).all(Math.max(1, Number(limit || 100))) as DlqRow[]) || [];
    return rows.map((row) => {
      let metadata: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(String(row.metadata_json || "{}")) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          metadata = parsed as Record<string, unknown>;
        }
      } catch {
        metadata = {};
      }
      return {
        at: String(row.at || ""),
        provider: String(row.provider || "") as ChannelProvider,
        chat_id: String(row.chat_id || ""),
        message_id: String(row.message_id || ""),
        sender_id: String(row.sender_id || ""),
        reply_to: String(row.reply_to || ""),
        thread_id: String(row.thread_id || ""),
        retry_count: Math.max(0, Number(row.retry_count || 0)),
        error: String(row.error || ""),
        content: String(row.content || ""),
        metadata,
      };
    });
  }
}

