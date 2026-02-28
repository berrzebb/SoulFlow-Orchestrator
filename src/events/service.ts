import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { with_sqlite, type DatabaseSync } from "../utils/sqlite-helper.js";
import { normalize_text } from "../utils/common.js";
import type { TaskState } from "../contracts.js";
import type { TaskStoreLike } from "../agent/task-store.js";
import type { Logger } from "../logger.js";
import { now_iso } from "../utils/common.js";
import type {
  AppendWorkflowEventInput,
  AppendWorkflowEventResult,
  ListWorkflowEventsFilter,
  WorkflowEvent,
  WorkflowEventSource,
  WorkflowPhase,
} from "./types.js";

const PHASES = new Set<WorkflowPhase>(["assign", "progress", "blocked", "done", "approval"]);
const SOURCES = new Set<WorkflowEventSource>(["outbound", "inbound", "system"]);

function normalize_phase(value: unknown): WorkflowPhase {
  const phase = String(value || "").trim().toLowerCase();
  if (PHASES.has(phase as WorkflowPhase)) return phase as WorkflowPhase;
  return "progress";
}

function normalize_source(value: unknown): WorkflowEventSource {
  const source = String(value || "").trim().toLowerCase();
  if (SOURCES.has(source as WorkflowEventSource)) return source as WorkflowEventSource;
  return "system";
}

type DbEventRow = {
  event_id: string;
  run_id: string;
  task_id: string;
  agent_id: string;
  phase: string;
  summary: string;
  payload_json: string;
  provider: string | null;
  channel: string | null;
  chat_id: string;
  thread_id: string | null;
  source: string;
  detail_file: string | null;
  at: string;
};

export class WorkflowEventService {
  readonly root: string;
  readonly events_dir: string;
  readonly sqlite_path: string;

  private readonly initialized: Promise<void>;
  private write_queue: Promise<void> = Promise.resolve();
  private task_store: TaskStoreLike | null = null;
  private readonly logger: Logger | null;

  constructor(root = process.cwd(), events_dir_override?: string, logger?: Logger | null) {
    this.root = root;
    this.events_dir = events_dir_override || join(root, "runtime", "events");
    this.sqlite_path = join(this.events_dir, "events.db");
    this.logger = logger ?? null;
    this.initialized = this.ensure_initialized();
  }

  bind_task_store(store: TaskStoreLike | null): void {
    this.task_store = store;
  }

  private async enqueue_write<T>(job: () => Promise<T>): Promise<T> {
    const run = this.write_queue.then(job, job);
    this.write_queue = run.then(() => undefined, () => undefined);
    return run;
  }

  private with_sqlite<T>(run: (db: DatabaseSync) => T): T | null {
    return with_sqlite(this.sqlite_path, run, { pragmas: ["foreign_keys=ON"] });
  }

  private async ensure_dirs(): Promise<void> {
    await mkdir(this.events_dir, { recursive: true });
  }

  private async ensure_initialized(): Promise<void> {
    await this.ensure_dirs();
    const initialized = this.with_sqlite((db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS workflow_events (
          event_id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          task_id TEXT NOT NULL,
          agent_id TEXT NOT NULL,
          phase TEXT NOT NULL,
          summary TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          provider TEXT,
          channel TEXT,
          chat_id TEXT NOT NULL,
          thread_id TEXT,
          source TEXT NOT NULL,
          detail_file TEXT,
          at TEXT NOT NULL,
          created_ms INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS workflow_task_details (
          task_id TEXT PRIMARY KEY,
          content TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_workflow_events_at ON workflow_events(at DESC);
        CREATE INDEX IF NOT EXISTS idx_workflow_events_task ON workflow_events(task_id, at DESC);
        CREATE INDEX IF NOT EXISTS idx_workflow_events_run ON workflow_events(run_id, at DESC);
        CREATE INDEX IF NOT EXISTS idx_workflow_events_chat ON workflow_events(chat_id, at DESC);
        CREATE VIRTUAL TABLE IF NOT EXISTS workflow_events_fts USING fts5(
          content,
          event_id UNINDEXED,
          run_id UNINDEXED,
          task_id UNINDEXED,
          agent_id UNINDEXED,
          phase UNINDEXED,
          source UNINDEXED,
          chat_id UNINDEXED,
          content='workflow_events',
          content_rowid='rowid'
        );
        CREATE TRIGGER IF NOT EXISTS workflow_events_ai AFTER INSERT ON workflow_events BEGIN
          INSERT INTO workflow_events_fts(rowid, content, event_id, run_id, task_id, agent_id, phase, source, chat_id)
          VALUES (
            new.rowid,
            COALESCE(new.summary, '') || ' ' || COALESCE(new.payload_json, ''),
            new.event_id,
            new.run_id,
            new.task_id,
            new.agent_id,
            new.phase,
            new.source,
            new.chat_id
          );
        END;
        CREATE TRIGGER IF NOT EXISTS workflow_events_ad AFTER DELETE ON workflow_events BEGIN
          INSERT INTO workflow_events_fts(workflow_events_fts, rowid, content, event_id, run_id, task_id, agent_id, phase, source, chat_id)
          VALUES (
            'delete',
            old.rowid,
            COALESCE(old.summary, '') || ' ' || COALESCE(old.payload_json, ''),
            old.event_id,
            old.run_id,
            old.task_id,
            old.agent_id,
            old.phase,
            old.source,
            old.chat_id
          );
        END;
        CREATE TRIGGER IF NOT EXISTS workflow_events_au AFTER UPDATE ON workflow_events BEGIN
          INSERT INTO workflow_events_fts(workflow_events_fts, rowid, content, event_id, run_id, task_id, agent_id, phase, source, chat_id)
          VALUES (
            'delete',
            old.rowid,
            COALESCE(old.summary, '') || ' ' || COALESCE(old.payload_json, ''),
            old.event_id,
            old.run_id,
            old.task_id,
            old.agent_id,
            old.phase,
            old.source,
            old.chat_id
          );
          INSERT INTO workflow_events_fts(rowid, content, event_id, run_id, task_id, agent_id, phase, source, chat_id)
          VALUES (
            new.rowid,
            COALESCE(new.summary, '') || ' ' || COALESCE(new.payload_json, ''),
            new.event_id,
            new.run_id,
            new.task_id,
            new.agent_id,
            new.phase,
            new.source,
            new.chat_id
          );
        END;
      `);
      return true;
    });
    if (!initialized) {
      this.logger?.error("schema initialization failed");
    }
  }

  private row_to_event(row: DbEventRow): WorkflowEvent | null {
    try {
      const payload = JSON.parse(String(row.payload_json || "{}")) as Record<string, unknown>;
      return {
        event_id: String(row.event_id || ""),
        run_id: String(row.run_id || ""),
        task_id: String(row.task_id || ""),
        agent_id: String(row.agent_id || ""),
        phase: normalize_phase(row.phase),
        summary: String(row.summary || ""),
        payload: (payload && typeof payload === "object" && !Array.isArray(payload)) ? payload : {},
        provider: row.provider || undefined,
        channel: row.channel || undefined,
        chat_id: String(row.chat_id || ""),
        thread_id: row.thread_id || undefined,
        source: normalize_source(row.source),
        detail_file: row.detail_file || null,
        at: String(row.at || ""),
      };
    } catch {
      return null;
    }
  }

  private task_detail_uri(task_id: string): string {
    return `sqlite://events/task_details/${encodeURIComponent(task_id)}`;
  }

  private async append_task_detail(event: WorkflowEvent, detail: string): Promise<string | null> {
    const task_id = normalize_text(event.task_id);
    const body = String(detail || "").trim();
    if (!task_id || !body) return null;
    const section = [
      `## ${event.at} [${event.phase}] run=${event.run_id} agent=${event.agent_id}`,
      "",
      body,
      "",
      "---",
      "",
    ].join("\n");
    const ok = this.with_sqlite((db) => {
      const existing = db.prepare(`
        SELECT content
        FROM workflow_task_details
        WHERE task_id = ?
        LIMIT 1
      `).get(task_id) as { content: string } | undefined;
      const next = `${String(existing?.content || "")}${section}`;
      db.prepare(`
        INSERT INTO workflow_task_details(task_id, content, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(task_id) DO UPDATE SET
          content = excluded.content,
          updated_at = excluded.updated_at
      `).run(task_id, next, now_iso());
      return true;
    });
    if (!ok) return null;
    return this.task_detail_uri(task_id);
  }

  async append(input: AppendWorkflowEventInput): Promise<AppendWorkflowEventResult> {
    await this.initialized;
    return this.enqueue_write(async () => {
      const event_id = normalize_text(input.event_id) || randomUUID().slice(0, 12);
      const existing = this.with_sqlite((db) => db.prepare(`
        SELECT event_id, run_id, task_id, agent_id, phase, summary, payload_json, provider, channel, chat_id, thread_id, source, detail_file, at
        FROM workflow_events
        WHERE event_id = ?
        LIMIT 1
      `).get(event_id) as DbEventRow | undefined) || null;
      if (existing) {
        const event = this.row_to_event(existing);
        if (event) return { deduped: true, event };
      }

      const at = String(input.at || now_iso());
      const phase = normalize_phase(input.phase);
      const summary = normalize_text(input.summary).slice(0, 800) || "(empty)";
      const task_id = normalize_text(input.task_id) || "task-unspecified";
      const run_id = normalize_text(input.run_id) || `run-${Date.now()}`;
      const agent_id = normalize_text(input.agent_id) || "agent";
      const chat_id = normalize_text(input.chat_id) || "unknown-chat";
      const payload = (input.payload && typeof input.payload === "object" && !Array.isArray(input.payload))
        ? { ...(input.payload as Record<string, unknown>) }
        : {};

      const event: WorkflowEvent = {
        event_id,
        run_id,
        task_id,
        agent_id,
        phase,
        summary,
        payload,
        provider: normalize_text(input.provider) || undefined,
        channel: normalize_text(input.channel) || undefined,
        chat_id,
        thread_id: normalize_text(input.thread_id) || undefined,
        source: normalize_source(input.source),
        detail_file: null,
        at,
      };

      const detail_file = await this.append_task_detail(event, String(input.detail || ""));
      if (detail_file) event.detail_file = detail_file;

      this.with_sqlite((db) => {
        db.prepare(`
          INSERT OR IGNORE INTO workflow_events (
            event_id, run_id, task_id, agent_id, phase, summary, payload_json,
            provider, channel, chat_id, thread_id, source, detail_file, at, created_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          event.event_id,
          event.run_id,
          event.task_id,
          event.agent_id,
          event.phase,
          event.summary,
          JSON.stringify(event.payload || {}),
          event.provider || null,
          event.channel || null,
          event.chat_id,
          event.thread_id || null,
          event.source,
          event.detail_file || null,
          event.at,
          Date.now(),
        );
        return true;
      });

      await this.sync_task_state_from_event(event);
      return { deduped: false, event };
    });
  }

  async list(filter?: ListWorkflowEventsFilter): Promise<WorkflowEvent[]> {
    await this.initialized;
    const limit = Math.max(1, Number(filter?.limit || 200));
    const offset = Math.max(0, Number(filter?.offset || 0));
    const where: string[] = [];
    const params: Array<string | number | null> = [];
    if (filter?.phase) {
      where.push("phase = ?");
      params.push(normalize_phase(filter.phase));
    }
    if (filter?.task_id) {
      where.push("task_id = ?");
      params.push(String(filter.task_id));
    }
    if (filter?.run_id) {
      where.push("run_id = ?");
      params.push(String(filter.run_id));
    }
    if (filter?.agent_id) {
      where.push("agent_id = ?");
      params.push(String(filter.agent_id));
    }
    if (filter?.chat_id) {
      where.push("chat_id = ?");
      params.push(String(filter.chat_id));
    }
    if (filter?.source) {
      where.push("source = ?");
      params.push(normalize_source(filter.source));
    }
    const sql = [
      "SELECT event_id, run_id, task_id, agent_id, phase, summary, payload_json, provider, channel, chat_id, thread_id, source, detail_file, at",
      "FROM workflow_events",
      where.length > 0 ? `WHERE ${where.join(" AND ")}` : "",
      "ORDER BY at DESC",
      "LIMIT ? OFFSET ?",
    ].filter(Boolean).join(" ");
    params.push(limit, offset);
    const rows = this.with_sqlite((db) => db.prepare(sql).all(...params) as DbEventRow[]) || [];
    const out: WorkflowEvent[] = [];
    for (const row of rows) {
      const event = this.row_to_event(row);
      if (event) out.push(event);
    }
    return out;
  }

  async read_task_detail(task_id: string): Promise<string> {
    const id = normalize_text(task_id);
    if (!id) return "";
    const row = this.with_sqlite((db) => db.prepare(`
      SELECT content
      FROM workflow_task_details
      WHERE task_id = ?
      LIMIT 1
    `).get(id) as { content: string } | undefined) || null;
    return String(row?.content || "");
  }

  private map_phase_to_status(event: WorkflowEvent): TaskState["status"] {
    if (event.phase === "done") return "completed";
    if (event.phase === "approval") return "waiting_approval";
    if (event.phase === "blocked") {
      const summary = String(event.summary || "").toLowerCase();
      const approval_like = /approve|approval|승인|허용|대기/.test(summary);
      return approval_like ? "waiting_approval" : "failed";
    }
    return "running";
  }

  private async sync_task_state_from_event(event: WorkflowEvent): Promise<void> {
    if (!this.task_store) return;
    const task_id = normalize_text(event.task_id);
    if (!task_id) return;
    const existing = await this.task_store.get(task_id);
    const next_status = this.map_phase_to_status(event);
    const base: TaskState = existing || {
      taskId: task_id,
      title: normalize_text(event.summary).slice(0, 120) || `Workflow:${task_id}`,
      currentTurn: 0,
      maxTurns: Math.max(1, Number(process.env.TASK_LOOP_MAX_TURNS || 40)),
      status: "running",
      currentStep: "assign",
      memory: {},
    };
    const memory = {
      ...(base.memory || {}),
      workflow: {
        event_id: event.event_id,
        run_id: event.run_id,
        phase: event.phase,
        summary: event.summary,
        at: event.at,
        agent_id: event.agent_id,
        provider: event.provider || "",
        channel: event.channel || "",
        chat_id: event.chat_id,
        thread_id: event.thread_id || "",
      },
    };
    const next: TaskState = {
      ...base,
      title: base.title || (normalize_text(event.summary).slice(0, 120) || `Workflow:${task_id}`),
      currentTurn: Math.max(0, Number(base.currentTurn || 0)) + 1,
      status: next_status,
      currentStep: event.phase,
      memory,
      exitReason: next_status === "completed"
        ? "workflow_done_event"
        : next_status === "waiting_approval"
          ? "approval_wait_event"
          : next_status === "failed"
            ? "workflow_blocked_event"
            : undefined,
    };
    await this.task_store.upsert(next);
  }
}
