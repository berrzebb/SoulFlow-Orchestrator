import { mkdir, open, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { with_sqlite, with_sqlite_strict } from "../utils/sqlite-helper.js";
import type {
  CronJob,
  CronJobOverrides,
  CronOnJob,
  CronPayload,
  CronRetryPolicy,
  CronSchedule,
  CronScheduleKind,
  CronServiceOptions,
  CronServiceStatus,
  CronStore,
} from "./types.js";
import { DEFAULT_RETRY_ONESHOT, DEFAULT_RETRY_RECURRING } from "./types.js";
import type { CronScheduler } from "./contracts.js";
import type { ServiceLike } from "../runtime/service.types.js";
import type { Logger } from "../logger.js";
import { now_ms, error_message, short_id} from "../utils/common.js";

type CronDbRow = {
  id: string;
  name: string;
  enabled: number;
  schedule_kind: string;
  schedule_at_ms: number | null;
  schedule_every_ms: number | null;
  schedule_expr: string | null;
  schedule_tz: string | null;
  schedule_stagger_ms: number | null;
  payload_kind: string;
  payload_message: string;
  payload_deliver: number;
  payload_channel: string | null;
  payload_to: string | null;
  payload_overrides: string | null;
  state_next_run_at_ms: number | null;
  state_last_run_at_ms: number | null;
  state_last_status: string | null;
  state_last_error: string | null;
  state_running: number;
  state_running_started_at_ms: number | null;
  state_retry_attempt: number | null;
  created_at_ms: number;
  updated_at_ms: number;
  delete_after_run: number;
  retry_max_retries: number | null;
  retry_backoff_ms: string | null;
};

const _tz_formatter_cache = new Map<string, Intl.DateTimeFormat>();

function _get_tz_formatter(tz: string): Intl.DateTimeFormat {
  let fmt = _tz_formatter_cache.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      month: "numeric", day: "numeric",
      hour: "numeric", minute: "numeric",
      weekday: "short", hour12: false,
    });
    _tz_formatter_cache.set(tz, fmt);
  }
  return fmt;
}

function _is_valid_timezone(tz: string): boolean {
  try {
    _get_tz_formatter(tz);
    return true;
  } catch {
    return false;
  }
}

function _parse_field(value: string, min: number, max: number): Set<number> | null {
  const out = new Set<number>();
  const parts = value.split(",");
  for (const part_raw of parts) {
    const part = part_raw.trim();
    if (!part) continue;
    if (part === "*") {
      for (let i = min; i <= max; i += 1) out.add(i);
      continue;
    }
    const step = part.match(/^\*\/(\d+)$/);
    if (step) {
      const n = Number(step[1]);
      if (!Number.isFinite(n) || n <= 0) return null;
      for (let i = min; i <= max; i += n) out.add(i);
      continue;
    }
    const range = part.match(/^(\d+)-(\d+)$/);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      if (!Number.isFinite(a) || !Number.isFinite(b) || a > b || a < min || b > max) return null;
      for (let i = a; i <= b; i += 1) out.add(i);
      continue;
    }
    const single = Number(part);
    if (!Number.isFinite(single) || single < min || single > max) return null;
    out.add(single);
  }
  return out;
}

type ParsedCronExpr = {
  minute: Set<number>;
  hour: Set<number>;
  day: Set<number>;
  month: Set<number>;
  weekday: Set<number>;
};

type CronDateParts = {
  minute: number;
  hour: number;
  day: number;
  month: number;
  weekday: number;
};

const WEEKDAY_SHORT_MAP: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

function _parse_cron(expr: string): ParsedCronExpr | null {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const minute = _parse_field(fields[0], 0, 59);
  const hour = _parse_field(fields[1], 0, 23);
  const day = _parse_field(fields[2], 1, 31);
  const month = _parse_field(fields[3], 1, 12);
  const weekday = _parse_field(fields[4], 0, 7);
  if (!minute || !hour || !day || !month || !weekday) return null;
  if (weekday.has(7)) {
    weekday.add(0);
    weekday.delete(7);
  }
  return { minute, hour, day, month, weekday };
}

function _get_local_parts(ms: number): CronDateParts {
  const t = new Date(ms);
  return {
    minute: t.getMinutes(),
    hour: t.getHours(),
    day: t.getDate(),
    month: t.getMonth() + 1,
    weekday: t.getDay(),
  };
}

function _get_tz_parts(ms: number, tz: string): CronDateParts | null {
  try {
    const parts = _get_tz_formatter(tz).formatToParts(new Date(ms));
    const num = (type: "month" | "day" | "hour" | "minute"): number | null => {
      const raw = parts.find((p) => p.type === type)?.value || "";
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    };
    const weekday_token = String(parts.find((p) => p.type === "weekday")?.value || "").slice(0, 3).toLowerCase();
    const weekday = WEEKDAY_SHORT_MAP[weekday_token];
    const month = num("month");
    const day = num("day");
    const hour = num("hour");
    const minute = num("minute");
    if (month === null || day === null || hour === null || minute === null || !Number.isFinite(weekday)) {
      return null;
    }
    return { minute, hour, day, month, weekday };
  } catch {
    return null;
  }
}

function _match_parsed_cron(parsed: ParsedCronExpr, parts: CronDateParts): boolean {
  return (
    parsed.minute.has(parts.minute)
    && parsed.hour.has(parts.hour)
    && parsed.day.has(parts.day)
    && parsed.month.has(parts.month)
    && parsed.weekday.has(parts.weekday)
  );
}

/** job ID 기반 결정적 stagger 오프셋. 동일 job은 항상 동일 오프셋. */
function _deterministic_stagger(job_id: string, max_ms: number): number {
  let hash = 0;
  for (let i = 0; i < job_id.length; i += 1) {
    hash = ((hash << 5) - hash + job_id.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % max_ms;
}

/** 매 시 정각 실행 cron 감지. minute=0, hour에 "*" 포함. */
function _is_top_of_hour_cron(expr: string): boolean {
  const fields = expr.trim().split(/\s+/);
  return fields.length === 5 && fields[0] === "0" && (fields[1] || "").includes("*");
}

const _TOP_OF_HOUR_STAGGER_MS = 5 * 60_000;

/** stagger 상한 (ms). 명시적 설정 > 시 정각 자동 감지 > 0. */
function _resolve_stagger_max_ms(schedule: CronSchedule): number {
  if (schedule.stagger_ms != null && schedule.stagger_ms > 0) return schedule.stagger_ms;
  if (schedule.kind === "cron" && schedule.expr && _is_top_of_hour_cron(schedule.expr)) {
    return _TOP_OF_HOUR_STAGGER_MS;
  }
  return 0;
}

/** 재시도 정책에서 현재 attempt에 해당하는 백오프 지연 (ms). */
function _get_retry_delay(policy: CronRetryPolicy, attempt: number): number {
  const idx = Math.min(attempt - 1, policy.backoff_ms.length - 1);
  return policy.backoff_ms[Math.max(0, idx)] || 30_000;
}

/** 스케줄 종류에 따른 기본 재시도 정책. */
function _default_retry_policy(kind: CronScheduleKind): CronRetryPolicy {
  return kind === "at" ? DEFAULT_RETRY_ONESHOT : DEFAULT_RETRY_RECURRING;
}

/** 재시도 가능 여부 판단. max_retries=-1이면 무제한. */
function _should_retry(policy: CronRetryPolicy, attempt: number): boolean {
  if (policy.max_retries < 0) return true;
  return attempt <= policy.max_retries;
}

function _compute_next_run(schedule: CronSchedule, now: number, on_warn?: (msg: string) => void, stagger_id?: string): number | null {
  if (schedule.kind === "at") {
    const at = Number(schedule.at_ms || 0);
    if (!Number.isFinite(at) || at <= 0) return null;
    return at;
  }

  if (schedule.kind === "every") {
    const every = Number(schedule.every_ms || 0);
    if (!Number.isFinite(every) || every <= 0) return null;
    const start_at = Number(schedule.at_ms || 0);
    if (Number.isFinite(start_at) && start_at > 0 && now < start_at) return start_at;
    return now + every;
  }

  if (schedule.kind === "cron" && schedule.expr) {
    const parsed = _parse_cron(schedule.expr);
    if (!parsed) return null;
    const tz = String(schedule.tz || "").trim();
    const end_ms = now + 366 * 24 * 60 * 60_000;
    let candidate_ms = Math.floor(now / 60_000) * 60_000 + 60_000; // 다음 분 경계
    while (candidate_ms <= end_ms) {
      const parts = tz ? _get_tz_parts(candidate_ms, tz) : _get_local_parts(candidate_ms);
      if (!parts) {
        on_warn?.(`timezone parsing failed for tz=${tz}, aborting next-run computation`);
        return null;
      }
      // 월 불일치 — 다음 달 1일 00:00으로 점프
      if (!parsed.month.has(parts.month)) {
        const d = new Date(candidate_ms);
        d.setMonth(d.getMonth() + 1, 1);
        d.setHours(0, 0, 0, 0);
        candidate_ms = d.getTime();
        continue;
      }
      // 요일 또는 일 불일치 — 다음 날 00:00으로 점프
      if (!parsed.day.has(parts.day) || !parsed.weekday.has(parts.weekday)) {
        const d = new Date(candidate_ms);
        d.setDate(d.getDate() + 1);
        d.setHours(0, 0, 0, 0);
        candidate_ms = d.getTime();
        continue;
      }
      // 시 불일치 — 다음 시간 :00분으로 점프
      if (!parsed.hour.has(parts.hour)) {
        const d = new Date(candidate_ms);
        d.setHours(d.getHours() + 1, 0, 0, 0);
        candidate_ms = d.getTime();
        continue;
      }
      if (_match_parsed_cron(parsed, parts)) {
        const max_stagger = _resolve_stagger_max_ms(schedule);
        const stagger = (max_stagger > 0 && stagger_id)
          ? _deterministic_stagger(stagger_id, max_stagger)
          : 0;
        return candidate_ms + stagger;
      }
      candidate_ms += 60_000;
    }
  }

  return null;
}

function _validate_schedule_for_add(schedule: CronSchedule): void {
  if (!schedule || typeof schedule !== "object") throw new Error("invalid_schedule");
  if (!schedule.kind) throw new Error("schedule.kind is required");
  if (schedule.tz && schedule.kind !== "cron") throw new Error("tz can only be used with cron schedules");
  if (schedule.kind === "at") {
    const at = Number(schedule.at_ms || 0);
    if (!Number.isFinite(at) || at <= 0) {
      throw new Error("invalid at schedule: at_ms must be a positive epoch milliseconds");
    }
    return;
  }
  if (schedule.kind === "every") {
    const every = Number(schedule.every_ms || 0);
    if (!Number.isFinite(every) || every <= 0) {
      throw new Error("invalid every schedule: every_ms must be a positive number");
    }
    if (schedule.at_ms !== undefined && schedule.at_ms !== null) {
      const start_at = Number(schedule.at_ms || 0);
      if (!Number.isFinite(start_at) || start_at <= 0) {
        throw new Error("invalid every schedule: at_ms must be a positive epoch milliseconds when provided");
      }
    }
    return;
  }
  if (schedule.kind === "cron") {
    const expr = String(schedule.expr || "").trim();
    if (!expr) throw new Error("invalid cron schedule: expr is required");
    if (!_parse_cron(expr)) throw new Error(`invalid cron expression '${expr}'`);
  }
  if (schedule.kind === "cron" && schedule.tz && !_is_valid_timezone(schedule.tz)) {
    throw new Error(`unknown timezone '${schedule.tz}'`);
  }
}

function _parse_json_or_null<T>(raw: string | null): T | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

function _row_to_job(row: CronDbRow): CronJob {
  const retry_backoff = _parse_json_or_null<number[]>(row.retry_backoff_ms);
  const has_retry = row.retry_max_retries !== null && row.retry_max_retries !== undefined;
  return {
    id: String(row.id || ""),
    name: String(row.name || ""),
    enabled: Number(row.enabled || 0) === 1,
    schedule: {
      kind: String(row.schedule_kind || "every") as CronSchedule["kind"],
      at_ms: row.schedule_at_ms ?? null,
      every_ms: row.schedule_every_ms ?? null,
      expr: row.schedule_expr ?? null,
      tz: row.schedule_tz ?? null,
      stagger_ms: row.schedule_stagger_ms ?? null,
    },
    payload: {
      kind: String(row.payload_kind || "agent_turn") as CronPayload["kind"],
      message: String(row.payload_message || ""),
      deliver: Number(row.payload_deliver || 0) === 1,
      channel: row.payload_channel ?? null,
      to: row.payload_to ?? null,
      overrides: _parse_json_or_null<CronJobOverrides>(row.payload_overrides),
    },
    state: {
      next_run_at_ms: row.state_next_run_at_ms ?? null,
      last_run_at_ms: row.state_last_run_at_ms ?? null,
      last_status: (row.state_last_status || null) as CronJob["state"]["last_status"],
      last_error: row.state_last_error ?? null,
      running: Number(row.state_running || 0) === 1,
      running_started_at_ms: row.state_running_started_at_ms ?? null,
      retry_attempt: Number(row.state_retry_attempt || 0),
    },
    created_at_ms: Number(row.created_at_ms || 0),
    updated_at_ms: Number(row.updated_at_ms || 0),
    delete_after_run: Number(row.delete_after_run || 0) === 1,
    retry: has_retry
      ? { max_retries: Number(row.retry_max_retries), backoff_ms: retry_backoff || [30_000, 60_000, 300_000] }
      : null,
  };
}

export class CronService implements CronScheduler, ServiceLike {
  readonly name = "cron";
  private readonly store_path: string;
  readonly on_job: CronOnJob | null;

  private readonly sqlite_path: string;
  private readonly lock_dir_path: string;
  private readonly running_lease_ms: number;
  private readonly initialized: Promise<void>;
  private _store: CronStore | null = null;
  private _timer_abort: AbortController | null = null;
  private _timer_task: Promise<void> | null = null;
  private readonly _interval_timers = new Set<NodeJS.Timeout>();
  private _tick_running = false;
  private _running = false;
  private _paused = false;
  private readonly logger: Logger | null;
  private readonly _on_change: ((type: import("./types.js").CronChangeType, job_id?: string) => void) | null;

  constructor(store_path: string, on_job: CronOnJob | null = null, options?: CronServiceOptions) {
    this.store_path = store_path;
    this.sqlite_path = join(store_path, "cron.db");
    this.lock_dir_path = join(store_path, ".locks");
    this.running_lease_ms = Math.max(5_000, Number(options?.running_lease_ms || 120_000));
    this.on_job = on_job;
    this.logger = options?.logger ?? null;
    this._on_change = options?.on_change ?? null;
    this.initialized = this.ensure_initialized();
  }

  private async ensure_initialized(): Promise<void> {
    await mkdir(this.store_path, { recursive: true });
    with_sqlite_strict(this.sqlite_path,(db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS cron_jobs (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          enabled INTEGER NOT NULL,
          schedule_kind TEXT NOT NULL,
          schedule_at_ms INTEGER,
          schedule_every_ms INTEGER,
          schedule_expr TEXT,
          schedule_tz TEXT,
          payload_kind TEXT NOT NULL,
          payload_message TEXT NOT NULL,
          payload_deliver INTEGER NOT NULL,
          payload_channel TEXT,
          payload_to TEXT,
          state_next_run_at_ms INTEGER,
          state_last_run_at_ms INTEGER,
          state_last_status TEXT,
          state_last_error TEXT,
          state_running INTEGER NOT NULL,
          state_running_started_at_ms INTEGER,
          created_at_ms INTEGER NOT NULL,
          updated_at_ms INTEGER NOT NULL,
          delete_after_run INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_cron_jobs_enabled_next_run
          ON cron_jobs(enabled, state_next_run_at_ms);
        CREATE INDEX IF NOT EXISTS idx_cron_jobs_updated
          ON cron_jobs(updated_at_ms DESC);
        CREATE VIRTUAL TABLE IF NOT EXISTS cron_jobs_fts USING fts5(
          content,
          id UNINDEXED,
          schedule_kind UNINDEXED,
          payload_kind UNINDEXED,
          content='cron_jobs',
          content_rowid='rowid'
        );
        CREATE TRIGGER IF NOT EXISTS cron_jobs_ai AFTER INSERT ON cron_jobs BEGIN
          INSERT INTO cron_jobs_fts(rowid, content, id, schedule_kind, payload_kind)
          VALUES (
            new.rowid,
            COALESCE(new.name, '') || ' ' || COALESCE(new.payload_message, ''),
            new.id,
            new.schedule_kind,
            new.payload_kind
          );
        END;
        CREATE TRIGGER IF NOT EXISTS cron_jobs_ad AFTER DELETE ON cron_jobs BEGIN
          INSERT INTO cron_jobs_fts(cron_jobs_fts, rowid, content, id, schedule_kind, payload_kind)
          VALUES (
            'delete',
            old.rowid,
            COALESCE(old.name, '') || ' ' || COALESCE(old.payload_message, ''),
            old.id,
            old.schedule_kind,
            old.payload_kind
          );
        END;
        CREATE TRIGGER IF NOT EXISTS cron_jobs_au AFTER UPDATE ON cron_jobs BEGIN
          INSERT INTO cron_jobs_fts(cron_jobs_fts, rowid, content, id, schedule_kind, payload_kind)
          VALUES (
            'delete',
            old.rowid,
            COALESCE(old.name, '') || ' ' || COALESCE(old.payload_message, ''),
            old.id,
            old.schedule_kind,
            old.payload_kind
          );
          INSERT INTO cron_jobs_fts(rowid, content, id, schedule_kind, payload_kind)
          VALUES (
            new.rowid,
            COALESCE(new.name, '') || ' ' || COALESCE(new.payload_message, ''),
            new.id,
            new.schedule_kind,
            new.payload_kind
          );
        END;
      `);
      // v2 마이그레이션: retry, stagger, overrides 컬럼 추가
      const v2_columns = [
        "schedule_stagger_ms INTEGER",
        "payload_overrides TEXT",
        "state_retry_attempt INTEGER DEFAULT 0",
        "retry_max_retries INTEGER",
        "retry_backoff_ms TEXT",
      ];
      for (const col of v2_columns) {
        try { db.exec(`ALTER TABLE cron_jobs ADD COLUMN ${col}`); } catch { /* 이미 존재 */ }
      }
      return true;
    });
  }

  private async persist_store_to_sqlite(store: CronStore): Promise<void> {
    with_sqlite_strict(this.sqlite_path,(db) => {
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("DELETE FROM cron_jobs").run();
        const stmt = db.prepare(`
          INSERT INTO cron_jobs (
            id, name, enabled, schedule_kind, schedule_at_ms, schedule_every_ms, schedule_expr, schedule_tz,
            schedule_stagger_ms,
            payload_kind, payload_message, payload_deliver, payload_channel, payload_to, payload_overrides,
            state_next_run_at_ms, state_last_run_at_ms, state_last_status, state_last_error, state_running,
            state_running_started_at_ms, state_retry_attempt,
            created_at_ms, updated_at_ms, delete_after_run,
            retry_max_retries, retry_backoff_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const job of store.jobs) {
          stmt.run(
            job.id,
            job.name,
            job.enabled ? 1 : 0,
            job.schedule.kind,
            job.schedule.at_ms ?? null,
            job.schedule.every_ms ?? null,
            job.schedule.expr ?? null,
            job.schedule.tz ?? null,
            job.schedule.stagger_ms ?? null,
            job.payload.kind,
            job.payload.message,
            job.payload.deliver ? 1 : 0,
            job.payload.channel ?? null,
            job.payload.to ?? null,
            job.payload.overrides ? JSON.stringify(job.payload.overrides) : null,
            job.state.next_run_at_ms ?? null,
            job.state.last_run_at_ms ?? null,
            job.state.last_status ?? null,
            job.state.last_error ?? null,
            job.state.running ? 1 : 0,
            job.state.running_started_at_ms ?? null,
            job.state.retry_attempt ?? 0,
            job.created_at_ms,
            job.updated_at_ms,
            job.delete_after_run ? 1 : 0,
            job.retry?.max_retries ?? null,
            job.retry?.backoff_ms ? JSON.stringify(job.retry.backoff_ms) : null,
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
  }

  async _load_store(): Promise<CronStore> {
    await this.initialized;
    if (this._store) return this._store;
    const rows = with_sqlite(this.sqlite_path,(db) => db.prepare(`
      SELECT
        id, name, enabled, schedule_kind, schedule_at_ms, schedule_every_ms, schedule_expr, schedule_tz,
        schedule_stagger_ms,
        payload_kind, payload_message, payload_deliver, payload_channel, payload_to, payload_overrides,
        state_next_run_at_ms, state_last_run_at_ms, state_last_status, state_last_error, state_running,
        state_running_started_at_ms, state_retry_attempt,
        created_at_ms, updated_at_ms, delete_after_run,
        retry_max_retries, retry_backoff_ms
      FROM cron_jobs
      ORDER BY created_at_ms ASC
    `).all() as CronDbRow[]) || [];
    this._store = {
      version: 1,
      jobs: rows.map((row) => _row_to_job(row)),
    };
    return this._store;
  }

  async _save_store(): Promise<void> {
    const store = await this._load_store();
    await this.persist_store_to_sqlite(store);
  }

  private async _recompute_next_runs(): Promise<void> {
    const store = await this._load_store();
    const now = now_ms();
    for (const job of store.jobs) {
      if (this._is_running_fresh(job, now)) continue;
      if (job.state.running) {
        job.state.running = false;
        job.state.running_started_at_ms = null;
      }
      if (job.enabled) job.state.next_run_at_ms = _compute_next_run(job.schedule, now, (m) => this.logger?.warn(m), job.id);
    }
  }

  private async _get_next_wake_ms(): Promise<number | null> {
    const store = await this._load_store();
    const times = store.jobs
      .filter((j) => j.enabled && j.state.next_run_at_ms)
      .filter((j) => !this._is_running_fresh(j))
      .map((j) => Number(j.state.next_run_at_ms || 0))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (times.length === 0) return null;
    return Math.min(...times);
  }

  private async _save_and_rearm(): Promise<void> {
    await this._save_store();
    await this._arm_timer();
  }

  private async _cancel_timer(): Promise<void> {
    this._timer_abort?.abort();
    this._timer_abort = null;
    if (this._timer_task) {
      try { await this._timer_task; } catch { /* aborted */ }
    }
    this._timer_task = null;
  }

  private async _arm_timer(): Promise<void> {
    await this._cancel_timer();
    const next_wake = await this._get_next_wake_ms();
    if (!this._running || this._paused || !next_wake) return;
    const delay_ms = Math.max(0, next_wake - now_ms());
    const controller = new AbortController();
    this._timer_abort = controller;
    this._timer_task = (async () => {
      try {
        await sleep(delay_ms, undefined, { signal: controller.signal });
        if (this._running && !controller.signal.aborted) await this._on_timer();
      } catch {
        // aborted or timer failure
      }
    })();
  }

  private async _on_timer(): Promise<void> {
    if (!this._running || this._paused) return;
    if (this._tick_running) return;
    this._tick_running = true;
    try {
      const store = await this._load_store();
      const now = now_ms();
      const due_jobs = store.jobs.filter((j) =>
        j.enabled
        && j.state.next_run_at_ms
        && now >= Number(j.state.next_run_at_ms)
        && !this._is_running_fresh(j, now)
      );
      for (const job of due_jobs) {
        try {
          await this._execute_job(job);
        } catch (e) {
          job.state.last_status = "error";
          job.state.last_error = error_message(e);
        }
      }
      await this._save_store();
    } finally {
      this._tick_running = false;
      if (this._running) await this._arm_timer();
    }
  }

  private async _execute_job(job: CronJob): Promise<void> {
    const lock_path = await this._acquire_job_lock(job.id);
    if (!lock_path) return;
    const store = await this._load_store();
    const start_ms = now_ms();
    job.state.running = true;
    job.state.running_started_at_ms = start_ms;
    job.updated_at_ms = start_ms;
    const attempt = (job.state.retry_attempt || 0);
    this.logger?.info("cron_job_start", { job_id: job.id, name: job.name, schedule: job.schedule.kind, retry_attempt: attempt });
    try {
      await this._save_store();
      let exec_error: string | null = null;
      try {
        if (this.on_job) await this.on_job(job);
        job.state.last_status = "ok";
        job.state.last_error = null;
        job.state.retry_attempt = 0;
        this.logger?.info("cron_job_finish", { job_id: job.id, name: job.name, status: "ok" });
      } catch (error) {
        exec_error = error_message(error);
        job.state.last_status = "error";
        job.state.last_error = exec_error;
        this.logger?.warn("cron_job_finish", { job_id: job.id, name: job.name, status: "error", error: exec_error });
      }

      job.state.last_run_at_ms = start_ms;
      job.state.running = false;
      job.state.running_started_at_ms = null;
      job.updated_at_ms = now_ms();

      if (exec_error) {
        this._schedule_retry_or_advance(job, store);
      } else if (job.delete_after_run) {
        store.jobs = store.jobs.filter((j) => j.id !== job.id);
      } else if (job.schedule.kind === "at") {
        job.enabled = false;
        job.state.next_run_at_ms = null;
      } else {
        job.state.next_run_at_ms = _compute_next_run(job.schedule, now_ms(), (m) => this.logger?.warn(m), job.id);
      }
      this._notify("executed", job.id);
    } finally {
      await this._release_job_lock(lock_path);
    }
  }

  /** 실패 시 재시도 스케줄링. 재시도 횟수 초과 시 정상 스케줄로 진행. */
  private _schedule_retry_or_advance(job: CronJob, store: CronStore): void {
    const policy = job.retry || _default_retry_policy(job.schedule.kind);
    const next_attempt = (job.state.retry_attempt || 0) + 1;

    if (_should_retry(policy, next_attempt)) {
      const delay = _get_retry_delay(policy, next_attempt);
      job.state.retry_attempt = next_attempt;
      job.state.next_run_at_ms = now_ms() + delay;
      this.logger?.info("cron_job_retry_scheduled", {
        job_id: job.id, attempt: next_attempt, delay_ms: delay,
        max_retries: policy.max_retries,
      });
    } else {
      // 재시도 횟수 초과 → 정상 흐름으로 복귀
      job.state.retry_attempt = 0;
      this.logger?.warn("cron_job_retry_exhausted", { job_id: job.id, attempts: next_attempt - 1 });
      if (job.delete_after_run) {
        store.jobs = store.jobs.filter((j) => j.id !== job.id);
      } else if (job.schedule.kind === "at") {
        job.enabled = false;
        job.state.next_run_at_ms = null;
      } else {
        job.state.next_run_at_ms = _compute_next_run(job.schedule, now_ms(), (m) => this.logger?.warn(m), job.id);
      }
    }
  }

  private _notify(type: import("./types.js").CronChangeType, job_id?: string): void {
    try { this._on_change?.(type, job_id); } catch { /* noop */ }
  }

  private _is_running_fresh(job: CronJob, now = now_ms()): boolean {
    if (!job.state.running) return false;
    const started = Number(job.state.running_started_at_ms || 0);
    if (!Number.isFinite(started) || started <= 0) return false;
    return (now - started) < this.running_lease_ms;
  }

  private async _acquire_job_lock(job_id: string): Promise<string | null> {
    await mkdir(this.lock_dir_path, { recursive: true });
    const lock_path = join(this.lock_dir_path, `${job_id}.lock`);
    for (let i = 0; i < 2; i += 1) {
      try {
        const handle = await open(lock_path, "wx");
        await handle.writeFile(String(now_ms()), "utf-8");
        await handle.close();
        return lock_path;
      } catch (error) {
        const code = (error as { code?: string } | null)?.code || "";
        if (code !== "EEXIST") return null;
        const stale = await this._is_job_lock_stale(lock_path);
        if (!stale) return null;
        try {
          await unlink(lock_path);
        } catch {
          return null;
        }
      }
    }
    return null;
  }

  private async _is_job_lock_stale(lock_path: string): Promise<boolean> {
    try {
      const info = await stat(lock_path);
      const mtime = Number(info.mtimeMs || 0);
      if (!Number.isFinite(mtime) || mtime <= 0) return true;
      return (now_ms() - mtime) > this.running_lease_ms;
    } catch {
      return true;
    }
  }

  private async _release_job_lock(lock_path: string): Promise<void> {
    try {
      await unlink(lock_path);
    } catch {
      // ignore lock cleanup errors
    }
  }

  async start(): Promise<void> {
    if (this._running) return;
    this._running = true;
    this._paused = false;
    await this._load_store();
    await this._recompute_next_runs();
    await this._save_store();
    await this._on_timer();
    await this._arm_timer();
  }

  async stop(): Promise<void> {
    this._running = false;
    this._paused = false;
    await this._cancel_timer();
    for (const t of this._interval_timers) clearInterval(t);
    this._interval_timers.clear();
  }

  health_check(): { ok: boolean; details?: Record<string, unknown> } {
    return { ok: this._running, details: { paused: this._paused } };
  }

  async pause(): Promise<void> {
    this._paused = true;
    await this._cancel_timer();
    this._notify("paused");
  }

  async resume(): Promise<void> {
    if (!this._running) {
      await this.start();
      return;
    }
    this._paused = false;
    await this._arm_timer();
    this._notify("resumed");
  }

  async list_jobs(include_disabled = false): Promise<CronJob[]> {
    const store = await this._load_store();
    const jobs = include_disabled ? [...store.jobs] : store.jobs.filter((j) => j.enabled);
    return jobs.sort((a, b) => {
      const aa = a.state.next_run_at_ms ?? Number.MAX_SAFE_INTEGER;
      const bb = b.state.next_run_at_ms ?? Number.MAX_SAFE_INTEGER;
      return Number(aa) - Number(bb);
    });
  }

  async add_job(
    name: string,
    schedule: CronSchedule,
    message: string,
    deliver = false,
    channel: string | null = null,
    to: string | null = null,
    delete_after_run?: boolean,
    options?: { retry?: CronRetryPolicy; overrides?: CronJobOverrides },
  ): Promise<CronJob> {
    const store = await this._load_store();
    _validate_schedule_for_add(schedule);
    const now = now_ms();
    const should_delete_after_run = typeof delete_after_run === "boolean"
      ? delete_after_run
      : schedule.kind === "at";
    const id = short_id(8);
    const job: CronJob = {
      id,
      name,
      enabled: true,
      schedule,
      payload: {
        kind: "agent_turn",
        message,
        deliver,
        channel,
        to,
        overrides: options?.overrides ?? null,
      },
      state: {
        next_run_at_ms: _compute_next_run(schedule, now, (m) => this.logger?.warn(m), id),
        last_run_at_ms: null,
        last_status: null,
        last_error: null,
        running: false,
        running_started_at_ms: null,
        retry_attempt: 0,
      },
      created_at_ms: now,
      updated_at_ms: now,
      delete_after_run: should_delete_after_run,
      retry: options?.retry ?? null,
    };
    store.jobs.push(job);
    await this._save_and_rearm();
    this._notify("added", job.id);
    this.logger?.info("cron_job_add", { job_id: job.id, name, schedule: schedule.kind });
    return job;
  }

  async remove_job(job_id: string): Promise<boolean> {
    const store = await this._load_store();
    const before = store.jobs.length;
    store.jobs = store.jobs.filter((j) => j.id !== job_id);
    const removed = store.jobs.length < before;
    if (removed) {
      await this._save_and_rearm();
      this._notify("removed", job_id);
      this.logger?.info("cron_job_remove", { job_id });
    }
    return removed;
  }

  async enable_job(job_id: string, enabled = true): Promise<CronJob | null> {
    const store = await this._load_store();
    for (const job of store.jobs) {
      if (job.id !== job_id) continue;
      job.enabled = enabled;
      job.updated_at_ms = now_ms();
      if (enabled) {
        job.state.next_run_at_ms = _compute_next_run(job.schedule, now_ms(), (m) => this.logger?.warn(m), job.id);
        job.state.retry_attempt = 0;
      }
      else job.state.next_run_at_ms = null;
      await this._save_and_rearm();
      this._notify(enabled ? "enabled" : "disabled", job_id);
      this.logger?.info("cron_job_toggle", { job_id, enabled });
      return job;
    }
    return null;
  }

  async run_job(job_id: string, force = false): Promise<boolean> {
    const store = await this._load_store();
    for (const job of store.jobs) {
      if (job.id !== job_id) continue;
      if (!force && !job.enabled) return false;
      await this._execute_job(job);
      await this._save_and_rearm();
      return true;
    }
    return false;
  }

  async status(): Promise<CronServiceStatus> {
    const store = await this._load_store();
    return {
      enabled: this._running && !this._paused,
      paused: this._paused,
      jobs: store.jobs.length,
      next_wake_at_ms: await this._get_next_wake_ms(),
    };
  }

  every(ms: number, fn: () => Promise<void>): void {
    const t = setInterval(() => {
      fn().catch((e) => this.logger?.error("interval callback failed", { error: error_message(e) }));
    }, Math.max(1_000, ms));
    this._interval_timers.add(t);
  }

  async disable_all_and_pause(): Promise<number> {
    const store = await this._load_store();
    let count = 0;
    for (const job of store.jobs) {
      if (job.enabled) {
        job.enabled = false;
        job.state.next_run_at_ms = null;
        job.updated_at_ms = now_ms();
        count++;
      }
    }
    this._paused = true;
    await this._cancel_timer();
    if (count > 0) await this._save_store();
    return count;
  }
}
