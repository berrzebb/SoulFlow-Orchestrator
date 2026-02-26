import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import Database from "better-sqlite3";
import type { SessionHistoryEntry, SessionHistoryRange, SessionInfo, SessionMessage } from "./types.js";
import { now_iso } from "../utils/common.js";

type DatabaseSync = Database.Database;

export interface SessionStoreLike {
  get_or_create(key: string): Promise<Session>;
  save(session: Session): Promise<void>;
}

export class Session {
  readonly key: string;
  messages: SessionMessage[];
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown>;
  last_consolidated: number;

  constructor(args: {
    key: string;
    messages?: SessionMessage[];
    created_at?: string;
    updated_at?: string;
    metadata?: Record<string, unknown>;
    last_consolidated?: number;
  }) {
    this.key = args.key;
    this.messages = args.messages || [];
    this.created_at = args.created_at || now_iso();
    this.updated_at = args.updated_at || this.created_at;
    this.metadata = args.metadata || {};
    this.last_consolidated = Number(args.last_consolidated || 0);
  }

  add_message(role: string, content: string, extra?: Record<string, unknown>): void {
    const message: SessionMessage = {
      role,
      content,
      timestamp: now_iso(),
      ...(extra || {}),
    };
    this.messages.push(message);
    this.updated_at = now_iso();
  }

  get_history(max_messages = 500): SessionHistoryEntry[] {
    const out: SessionHistoryEntry[] = [];
    for (const m of this.messages.slice(-Math.max(1, max_messages))) {
      const entry: SessionHistoryEntry = {
        role: String(m.role || ""),
        content: String(m.content || ""),
      };
      if ("tool_calls" in m) entry.tool_calls = m.tool_calls;
      if (typeof m.tool_call_id === "string") entry.tool_call_id = m.tool_call_id;
      if (typeof m.name === "string") entry.name = m.name;
      out.push(entry);
    }
    return out;
  }

  get_history_range(start_offset: number, end_offset: number): SessionHistoryRange {
    const total = this.messages.length;
    const start = Math.max(0, Number(start_offset || 0));
    const end = Math.max(start, Number(end_offset || start));
    const from = Math.max(0, total - end);
    const to = Math.max(from, total - start);
    const slice = this.messages.slice(from, to);
    const items = slice.map((m): SessionHistoryEntry => {
      const out: SessionHistoryEntry = {
        role: String(m.role || ""),
        content: String(m.content || ""),
      };
      if ("tool_calls" in m) out.tool_calls = m.tool_calls;
      if (typeof m.tool_call_id === "string") out.tool_call_id = m.tool_call_id;
      if (typeof m.name === "string") out.name = m.name;
      return out;
    });
    return {
      start_offset: start,
      end_offset: end,
      items,
    };
  }

  clear(): void {
    this.messages = [];
    this.last_consolidated = 0;
    this.updated_at = now_iso();
  }
}

export class SessionStore implements SessionStoreLike {
  private readonly workspace: string;
  private readonly sessions_dir: string;
  private readonly sqlite_path: string;
  private readonly cache = new Map<string, Session>();
  private readonly initialized: Promise<void>;

  constructor(workspace = process.cwd(), sessions_dir_override?: string) {
    this.workspace = workspace;
    this.sessions_dir = sessions_dir_override || join(this.workspace, "sessions");
    this.sqlite_path = join(this.sessions_dir, "sessions.db");
    this.initialized = this.ensure_initialized();
  }

  private with_sqlite<T>(run: (db: DatabaseSync) => T): T | null {
    let db: DatabaseSync | null = null;
    try {
      db = new Database(this.sqlite_path);
      db.exec("PRAGMA foreign_keys=ON;");
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
    await mkdir(this.sessions_dir, { recursive: true });
    this.with_sqlite((db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
          key TEXT PRIMARY KEY,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          metadata_json TEXT NOT NULL,
          last_consolidated INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS session_messages (
          session_key TEXT NOT NULL,
          idx INTEGER NOT NULL,
          role TEXT NOT NULL,
          content TEXT,
          timestamp TEXT,
          message_json TEXT NOT NULL,
          PRIMARY KEY(session_key, idx),
          FOREIGN KEY(session_key) REFERENCES sessions(key) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_session_updated_at ON sessions(updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_session_messages_key_idx ON session_messages(session_key, idx);
        CREATE VIRTUAL TABLE IF NOT EXISTS session_messages_fts USING fts5(
          content,
          session_key UNINDEXED,
          idx UNINDEXED,
          role UNINDEXED,
          content='session_messages',
          content_rowid='rowid'
        );
        CREATE TRIGGER IF NOT EXISTS session_messages_ai AFTER INSERT ON session_messages BEGIN
          INSERT INTO session_messages_fts(rowid, content, session_key, idx, role)
          VALUES (new.rowid, COALESCE(new.content, ''), new.session_key, new.idx, new.role);
        END;
        CREATE TRIGGER IF NOT EXISTS session_messages_ad AFTER DELETE ON session_messages BEGIN
          INSERT INTO session_messages_fts(session_messages_fts, rowid, content, session_key, idx, role)
          VALUES ('delete', old.rowid, COALESCE(old.content, ''), old.session_key, old.idx, old.role);
        END;
        CREATE TRIGGER IF NOT EXISTS session_messages_au AFTER UPDATE ON session_messages BEGIN
          INSERT INTO session_messages_fts(session_messages_fts, rowid, content, session_key, idx, role)
          VALUES ('delete', old.rowid, COALESCE(old.content, ''), old.session_key, old.idx, old.role);
          INSERT INTO session_messages_fts(rowid, content, session_key, idx, role)
          VALUES (new.rowid, COALESCE(new.content, ''), new.session_key, new.idx, new.role);
        END;
      `);
      return true;
    });
  }

  async get_or_create(key: string): Promise<Session> {
    await this.initialized;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const loaded = await this.load(key);
    const session = loaded || new Session({ key });
    this.cache.set(key, session);
    return session;
  }

  private async load(key: string): Promise<Session | null> {
    const header = this.with_sqlite((db) => db.prepare(`
      SELECT key, created_at, updated_at, metadata_json, last_consolidated
      FROM sessions
      WHERE key = ?
      LIMIT 1
    `).get(key) as {
      key: string;
      created_at: string;
      updated_at: string;
      metadata_json: string;
      last_consolidated: number;
    } | undefined) || undefined;
    if (!header) return null;

    const rows = this.with_sqlite((db) => db.prepare(`
      SELECT message_json
      FROM session_messages
      WHERE session_key = ?
      ORDER BY idx ASC
    `).all(key) as Array<{ message_json: string }>) || [];

    const messages: SessionMessage[] = [];
    for (const row of rows) {
      try {
        messages.push(JSON.parse(String(row.message_json || "{}")) as SessionMessage);
      } catch {
        // skip broken row
      }
    }

    let metadata: Record<string, unknown> = {};
    try {
      metadata = JSON.parse(String(header.metadata_json || "{}")) as Record<string, unknown>;
    } catch {
      metadata = {};
    }
    return new Session({
      key: header.key,
      messages,
      created_at: header.created_at,
      updated_at: header.updated_at,
      metadata,
      last_consolidated: Number(header.last_consolidated || 0),
    });
  }

  async save(session: Session): Promise<void> {
    await this.initialized;
    this.with_sqlite((db) => {
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare(`
          INSERT INTO sessions (key, created_at, updated_at, metadata_json, last_consolidated)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET
            created_at = excluded.created_at,
            updated_at = excluded.updated_at,
            metadata_json = excluded.metadata_json,
            last_consolidated = excluded.last_consolidated
        `).run(
          session.key,
          session.created_at,
          session.updated_at,
          JSON.stringify(session.metadata || {}),
          Number(session.last_consolidated || 0),
        );
        db.prepare("DELETE FROM session_messages WHERE session_key = ?").run(session.key);
        const insert = db.prepare(`
          INSERT INTO session_messages (session_key, idx, role, content, timestamp, message_json)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        for (let i = 0; i < session.messages.length; i += 1) {
          const row = session.messages[i];
          insert.run(
            session.key,
            i,
            String(row.role || ""),
            typeof row.content === "string" ? row.content : "",
            typeof row.timestamp === "string" ? row.timestamp : "",
            JSON.stringify(row),
          );
        }
        db.exec("COMMIT");
      } catch (error) {
        try {
          db.exec("ROLLBACK");
        } catch {
          // no-op
        }
        throw error;
      }
      return true;
    });
    this.cache.set(session.key, session);
  }

  async save_session(session: Session): Promise<void> {
    await this.save(session);
  }

  invalidate(key: string): void {
    this.cache.delete(key);
  }

  invalidate_session(key: string): void {
    this.invalidate(key);
  }

  async list_sessions(): Promise<SessionInfo[]> {
    await this.initialized;
    const rows = this.with_sqlite((db) => db.prepare(`
      SELECT key, created_at, updated_at
      FROM sessions
      ORDER BY updated_at DESC
    `).all() as Array<{ key: string; created_at: string; updated_at: string }>) || [];
    return rows.map((row) => ({
      key: String(row.key || ""),
      created_at: String(row.created_at || ""),
      updated_at: String(row.updated_at || ""),
      path: `sqlite://sessions/${encodeURIComponent(String(row.key || ""))}`,
    }));
  }

  async get_history_range(key: string, start_offset: number, end_offset: number): Promise<SessionHistoryRange> {
    const session = await this.get_or_create(key);
    return session.get_history_range(start_offset, end_offset);
  }
}
