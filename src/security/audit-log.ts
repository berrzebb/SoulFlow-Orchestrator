/** 보안 감사 로그 — SQLite 기반 이벤트 기록 + 조회. */

import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";

export type AuditEventType =
  | "secret_access"
  | "secret_modify"
  | "tool_execute"
  | "approval_request"
  | "approval_response"
  | "command_execute"
  | "provider_fallback";

export type AuditEntry = {
  id: string;
  timestamp: string;
  event_type: AuditEventType;
  actor: string;
  target?: string;
  details?: Record<string, unknown>;
  provider?: string;
  chat_id?: string;
};

export type AuditRecordInput = Omit<AuditEntry, "id" | "timestamp">;

export type AuditQueryFilter = {
  event_type?: AuditEventType;
  actor?: string;
  since?: string;
  limit?: number;
};

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY NOT NULL,
    timestamp TEXT NOT NULL,
    event_type TEXT NOT NULL,
    actor TEXT NOT NULL,
    target TEXT,
    details TEXT,
    provider TEXT,
    chat_id TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);
  CREATE INDEX IF NOT EXISTS idx_audit_event_type ON audit_log(event_type);
  CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor);
`;

export class AuditLog {
  private db: Database.Database | null = null;
  private readonly db_path: string;

  constructor(db_path: string) {
    this.db_path = db_path;
  }

  private get_db(): Database.Database {
    if (!this.db) throw new Error("audit_log_not_initialized");
    return this.db;
  }

  async ensure_ready(): Promise<void> {
    if (this.db) return;
    await mkdir(dirname(this.db_path), { recursive: true });
    this.db = new Database(this.db_path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA);
  }

  async record(entry: AuditRecordInput): Promise<void> {
    await this.ensure_ready();
    const id = randomUUID();
    const timestamp = new Date().toISOString();
    this.get_db().prepare(`
      INSERT INTO audit_log (id, timestamp, event_type, actor, target, details, provider, chat_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      timestamp,
      entry.event_type,
      entry.actor,
      entry.target ?? null,
      entry.details ? JSON.stringify(entry.details) : null,
      entry.provider ?? null,
      entry.chat_id ?? null,
    );
  }

  async query(filter?: AuditQueryFilter): Promise<AuditEntry[]> {
    await this.ensure_ready();
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter?.event_type) {
      conditions.push("event_type = ?");
      params.push(filter.event_type);
    }
    if (filter?.actor) {
      conditions.push("actor = ?");
      params.push(filter.actor);
    }
    if (filter?.since) {
      conditions.push("timestamp >= ?");
      params.push(filter.since);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = Math.min(1000, Math.max(1, filter?.limit ?? 100));
    const sql = `SELECT id, timestamp, event_type, actor, target, details, provider, chat_id FROM audit_log ${where} ORDER BY timestamp DESC LIMIT ?`;
    params.push(limit);

    const rows = this.get_db().prepare(sql).all(...params) as Array<{
      id: string; timestamp: string; event_type: string; actor: string;
      target: string | null; details: string | null; provider: string | null; chat_id: string | null;
    }>;

    return rows.map((r) => ({
      id: r.id,
      timestamp: r.timestamp,
      event_type: r.event_type as AuditEventType,
      actor: r.actor,
      target: r.target ?? undefined,
      details: r.details ? JSON.parse(r.details) as Record<string, unknown> : undefined,
      provider: r.provider ?? undefined,
      chat_id: r.chat_id ?? undefined,
    }));
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }
}
