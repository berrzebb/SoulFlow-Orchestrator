import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { file_exists, now_iso, safe_filename } from "../utils/common.js";
import type {
  AppendWorkflowEventInput,
  AppendWorkflowEventResult,
  ListWorkflowEventsFilter,
  WorkflowEvent,
  WorkflowPhase,
} from "./types.js";

type EventIndex = {
  version: number;
  event_ids: Record<string, string>;
  updated_at: string;
};

const INDEX_VERSION = 1;
const PHASES = new Set<WorkflowPhase>(["assign", "progress", "blocked", "done", "approval"]);

function normalize_text(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalize_phase(value: unknown): WorkflowPhase {
  const phase = String(value || "").trim().toLowerCase();
  if (PHASES.has(phase as WorkflowPhase)) return phase as WorkflowPhase;
  return "progress";
}

function default_index(): EventIndex {
  return {
    version: INDEX_VERSION,
    event_ids: {},
    updated_at: now_iso(),
  };
}

function line_to_event(line: string): WorkflowEvent | null {
  const raw = String(line || "").trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as WorkflowEvent;
    if (!parsed || typeof parsed !== "object" || !parsed.event_id) return null;
    return parsed;
  } catch {
    return null;
  }
}

export class WorkflowEventService {
  readonly root: string;
  readonly events_dir: string;
  readonly events_path: string;
  readonly index_path: string;
  readonly task_details_dir: string;

  private index_cache: EventIndex | null = null;
  private records_cache: WorkflowEvent[] | null = null;
  private write_queue: Promise<void> = Promise.resolve();

  constructor(root = process.cwd(), events_dir_override?: string, task_details_dir_override?: string) {
    this.root = root;
    this.events_dir = events_dir_override || join(root, "runtime", "events");
    this.events_path = join(this.events_dir, "events.jsonl");
    this.index_path = join(this.events_dir, "index.json");
    this.task_details_dir = task_details_dir_override || join(root, "runtime", "tasks", "details");
  }

  private async enqueue_write<T>(job: () => Promise<T>): Promise<T> {
    const run = this.write_queue.then(job, job);
    this.write_queue = run.then(() => undefined, () => undefined);
    return run;
  }

  private async ensure_dirs(): Promise<void> {
    await mkdir(this.events_dir, { recursive: true });
    await mkdir(this.task_details_dir, { recursive: true });
  }

  private async load_records(): Promise<WorkflowEvent[]> {
    if (this.records_cache) return this.records_cache;
    await this.ensure_dirs();
    if (!(await file_exists(this.events_path))) {
      this.records_cache = [];
      return this.records_cache;
    }
    const raw = await readFile(this.events_path, "utf-8");
    const rows = raw
      .split(/\r?\n/g)
      .map((line) => line_to_event(line))
      .filter((v): v is WorkflowEvent => Boolean(v));
    this.records_cache = rows;
    return rows;
  }

  private async load_index(): Promise<EventIndex> {
    if (this.index_cache) return this.index_cache;
    await this.ensure_dirs();
    if (!(await file_exists(this.index_path))) {
      const rebuilt = await this.rebuild_index_from_records();
      this.index_cache = rebuilt;
      await this.write_index(rebuilt);
      return rebuilt;
    }
    try {
      const raw = await readFile(this.index_path, "utf-8");
      const parsed = JSON.parse(raw) as EventIndex;
      this.index_cache = {
        version: Number(parsed.version || INDEX_VERSION),
        event_ids: parsed.event_ids || {},
        updated_at: parsed.updated_at || now_iso(),
      };
      return this.index_cache;
    } catch {
      const rebuilt = await this.rebuild_index_from_records();
      this.index_cache = rebuilt;
      await this.write_index(rebuilt);
      return rebuilt;
    }
  }

  private async rebuild_index_from_records(): Promise<EventIndex> {
    const rows = await this.load_records();
    const out = default_index();
    for (const row of rows) {
      out.event_ids[row.event_id] = row.at;
    }
    out.updated_at = now_iso();
    return out;
  }

  private async write_index(index: EventIndex): Promise<void> {
    await this.ensure_dirs();
    await writeFile(this.index_path, JSON.stringify(index, null, 2), "utf-8");
  }

  private task_detail_path(task_id: string): string {
    const safe = safe_filename(String(task_id || "").trim() || "task-unknown");
    return join(this.task_details_dir, `${safe}.md`);
  }

  private async append_task_detail(event: WorkflowEvent, detail: string): Promise<string | null> {
    const task_id = String(event.task_id || "").trim();
    const body = String(detail || "").trim();
    if (!task_id || !body) return null;
    await this.ensure_dirs();
    const path = this.task_detail_path(task_id);
    const section = [
      `## ${event.at} [${event.phase}] run=${event.run_id} agent=${event.agent_id}`,
      "",
      body,
      "",
      "---",
      "",
    ].join("\n");
    await appendFile(path, section, "utf-8");
    return path;
  }

  async append(input: AppendWorkflowEventInput): Promise<AppendWorkflowEventResult> {
    return this.enqueue_write(async () => {
      const index = await this.load_index();
      const records = await this.load_records();
      const event_id = normalize_text(input.event_id) || randomUUID().slice(0, 12);
      const existing = records.find((r) => r.event_id === event_id);
      if (existing) {
        return { deduped: true, event: existing };
      }
      if (index.event_ids[event_id]) {
        const by_index = records.find((r) => r.event_id === event_id);
        if (by_index) return { deduped: true, event: by_index };
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
        source: input.source || "system",
        detail_file: null,
        at,
      };

      const detail_file = await this.append_task_detail(event, String(input.detail || ""));
      if (detail_file) event.detail_file = detail_file;

      await this.ensure_dirs();
      await appendFile(this.events_path, `${JSON.stringify(event)}\n`, "utf-8");
      records.push(event);
      this.records_cache = records;
      index.event_ids[event.event_id] = event.at;
      index.updated_at = now_iso();
      this.index_cache = index;
      await this.write_index(index);

      return { deduped: false, event };
    });
  }

  async list(filter?: ListWorkflowEventsFilter): Promise<WorkflowEvent[]> {
    const rows = await this.load_records();
    const limit = Math.max(1, Number(filter?.limit || 200));
    const offset = Math.max(0, Number(filter?.offset || 0));
    const out = rows
      .filter((r) => (filter?.phase ? r.phase === filter.phase : true))
      .filter((r) => (filter?.task_id ? r.task_id === filter.task_id : true))
      .filter((r) => (filter?.run_id ? r.run_id === filter.run_id : true))
      .filter((r) => (filter?.agent_id ? r.agent_id === filter.agent_id : true))
      .filter((r) => (filter?.chat_id ? r.chat_id === filter.chat_id : true))
      .filter((r) => (filter?.source ? r.source === filter.source : true))
      .sort((a, b) => String(b.at).localeCompare(String(a.at)));
    return out.slice(offset, offset + limit);
  }

  async read_task_detail(task_id: string): Promise<string> {
    const id = normalize_text(task_id);
    if (!id) return "";
    const path = this.task_detail_path(id);
    if (!(await file_exists(path))) return "";
    try {
      return await readFile(path, "utf-8");
    } catch {
      return "";
    }
  }
}

