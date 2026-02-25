import { mkdir, open, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import type { CronJob, CronOnJob, CronPayload, CronSchedule, CronServiceOptions, CronServiceStatus, CronStore } from "./types.js";
import { file_exists, now_ms } from "../utils/common.js";

type CronStoreFileJob = {
  id: string;
  name: string;
  enabled: boolean;
  schedule: {
    kind: CronSchedule["kind"];
    atMs: number | null;
    everyMs: number | null;
    expr: string | null;
    tz: string | null;
  };
  payload: {
    kind: CronPayload["kind"];
    message: string;
    deliver: boolean;
    channel: string | null;
    to: string | null;
  };
  state: {
    nextRunAtMs: number | null;
    lastRunAtMs: number | null;
    lastStatus: CronJob["state"]["last_status"];
    lastError: string | null;
    running: boolean;
    runningStartedAtMs: number | null;
  };
  createdAtMs: number;
  updatedAtMs: number;
  deleteAfterRun: boolean;
};

type CronStoreFile = {
  version: number;
  jobs: CronStoreFileJob[];
};

function _default_store(): CronStore {
  return { version: 1, jobs: [] };
}

function _is_valid_timezone(tz: string): boolean {
  try {
    // Throws on invalid time zone.
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
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
      for (let i = min; i <= max; i++) out.add(i);
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
      for (let i = a; i <= b; i++) out.add(i);
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
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      weekday: "short",
      hour12: false,
    }).formatToParts(new Date(ms));
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
    if (
      month === null ||
      day === null ||
      hour === null ||
      minute === null ||
      !Number.isFinite(weekday)
    ) {
      return null;
    }
    return { minute, hour, day, month, weekday };
  } catch {
    return null;
  }
}

function _match_parsed_cron(parsed: ParsedCronExpr, parts: CronDateParts): boolean {
  return (
    parsed.minute.has(parts.minute) &&
    parsed.hour.has(parts.hour) &&
    parsed.day.has(parts.day) &&
    parsed.month.has(parts.month) &&
    parsed.weekday.has(parts.weekday)
  );
}

function _compute_next_run(schedule: CronSchedule, now_ms: number): number | null {
  if (schedule.kind === "at") {
    const at = Number(schedule.at_ms || 0);
    // Keep one-shot target time even when already overdue so missed runs can execute on next tick after restart.
    if (!Number.isFinite(at) || at <= 0) return null;
    return at;
  }

  if (schedule.kind === "every") {
    const every = Number(schedule.every_ms || 0);
    if (!Number.isFinite(every) || every <= 0) return null;
    return now_ms + every;
  }

  if (schedule.kind === "cron" && schedule.expr) {
    const parsed = _parse_cron(schedule.expr);
    if (!parsed) return null;
    const tz = String(schedule.tz || "").trim();
    const start = new Date(now_ms);
    start.setSeconds(0, 0);
    // Search up to 366 days, minute resolution.
    for (let i = 0; i < 60 * 24 * 366; i++) {
      const candidate_ms = start.getTime() + i * 60_000;
      if (candidate_ms <= now_ms) continue;
      const parts = tz ? _get_tz_parts(candidate_ms, tz) : _get_local_parts(candidate_ms);
      if (!parts) return null;
      if (_match_parsed_cron(parsed, parts)) return candidate_ms;
    }
  }

  return null;
}

function _validate_schedule_for_add(schedule: CronSchedule): void {
  if (schedule.tz && schedule.kind !== "cron") {
    throw new Error("tz can only be used with cron schedules");
  }
  if (schedule.kind === "cron" && schedule.tz && !_is_valid_timezone(schedule.tz)) {
    throw new Error(`unknown timezone '${schedule.tz}'`);
  }
}

function _to_file(store: CronStore): CronStoreFile {
  return {
    version: store.version,
    jobs: store.jobs.map((j) => ({
      id: j.id,
      name: j.name,
      enabled: j.enabled,
      schedule: {
        kind: j.schedule.kind,
        atMs: j.schedule.at_ms ?? null,
        everyMs: j.schedule.every_ms ?? null,
        expr: j.schedule.expr ?? null,
        tz: j.schedule.tz ?? null,
      },
      payload: {
        kind: j.payload.kind,
        message: j.payload.message,
        deliver: j.payload.deliver,
        channel: j.payload.channel ?? null,
        to: j.payload.to ?? null,
      },
      state: {
        nextRunAtMs: j.state.next_run_at_ms ?? null,
        lastRunAtMs: j.state.last_run_at_ms ?? null,
        lastStatus: j.state.last_status ?? null,
        lastError: j.state.last_error ?? null,
        running: j.state.running === true,
        runningStartedAtMs: j.state.running_started_at_ms ?? null,
      },
      createdAtMs: j.created_at_ms,
      updatedAtMs: j.updated_at_ms,
      deleteAfterRun: j.delete_after_run,
    })),
  };
}

function _from_file(raw: CronStoreFile): CronStore {
  const jobs = Array.isArray(raw.jobs) ? raw.jobs : [];
  return {
    version: Number(raw.version || 1),
    jobs: jobs.map((j): CronJob => ({
      id: String(j.id || ""),
      name: String(j.name || ""),
      enabled: Boolean(j.enabled),
      schedule: {
        kind: j.schedule?.kind || "every",
        at_ms: j.schedule?.atMs ?? null,
        every_ms: j.schedule?.everyMs ?? null,
        expr: j.schedule?.expr ?? null,
        tz: j.schedule?.tz ?? null,
      },
      payload: {
        kind: j.payload?.kind || "agent_turn",
        message: String(j.payload?.message || ""),
        deliver: Boolean(j.payload?.deliver),
        channel: j.payload?.channel ?? null,
        to: j.payload?.to ?? null,
      },
      state: {
        next_run_at_ms: j.state?.nextRunAtMs ?? null,
        last_run_at_ms: j.state?.lastRunAtMs ?? null,
        last_status: j.state?.lastStatus ?? null,
        last_error: j.state?.lastError ?? null,
        running: j.state?.running === true,
        running_started_at_ms: j.state?.runningStartedAtMs ?? null,
      },
      created_at_ms: Number(j.createdAtMs || 0),
      updated_at_ms: Number(j.updatedAtMs || 0),
      delete_after_run: Boolean(j.deleteAfterRun),
    })),
  };
}

export class CronService {
  readonly store_path: string;
  readonly on_job: CronOnJob | null;

  private readonly store_file_path: string;
  private readonly lock_dir_path: string;
  private readonly default_tick_ms: number;
  private readonly running_lease_ms: number;
  private _store: CronStore | null = null;
  private _timer_abort: AbortController | null = null;
  private _timer_task: Promise<void> | null = null;
  private readonly _legacy_timers = new Set<NodeJS.Timeout>();
  private _tick_running = false;
  private _running = false;
  private _paused = false;

  constructor(
    store_path: string,
    on_job: CronOnJob | null = null,
    options?: CronServiceOptions,
  ) {
    this.store_path = store_path;
    this.store_file_path = store_path.toLowerCase().endsWith(".json")
      ? store_path
      : join(store_path, "cron-store.json");
    this.lock_dir_path = join(dirname(this.store_file_path), ".locks");
    this.default_tick_ms = Math.max(1_000, Number(options?.default_tick_ms || 5_000));
    this.running_lease_ms = Math.max(5_000, Number(options?.running_lease_ms || 120_000));
    this.on_job = on_job;
  }

  async _load_store(): Promise<CronStore> {
    if (this._store) return this._store;
    await mkdir(dirname(this.store_file_path), { recursive: true });
    if (!(await file_exists(this.store_file_path))) {
      this._store = _default_store();
      return this._store;
    }
    try {
      const raw = await readFile(this.store_file_path, "utf-8");
      this._store = _from_file(JSON.parse(raw) as CronStoreFile);
    } catch {
      this._store = _default_store();
    }
    return this._store;
  }

  async _save_store(): Promise<void> {
    const store = await this._load_store();
    await mkdir(dirname(this.store_file_path), { recursive: true });
    await writeFile(this.store_file_path, JSON.stringify(_to_file(store), null, 2), "utf-8");
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
      if (job.enabled) job.state.next_run_at_ms = _compute_next_run(job.schedule, now);
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

  private async _arm_timer(): Promise<void> {
    this._timer_abort?.abort();
    this._timer_abort = null;
    this._timer_task = null;
    const next_wake = await this._get_next_wake_ms();
    if (!this._running || this._paused || !next_wake) return;
    const delay_ms = Math.max(0, next_wake - now_ms());
    const controller = new AbortController();
    this._timer_abort = controller;
    this._timer_task = (async () => {
      try {
        await sleep(delay_ms > 0 ? delay_ms : this.default_tick_ms, undefined, { signal: controller.signal });
        if (this._running && !controller.signal.aborted) await this._on_timer();
      } catch {
        // aborted or timer failure; scheduler loop is re-armed by caller.
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
      const due_jobs = store.jobs.filter(
        (j) => (
          j.enabled
          && j.state.next_run_at_ms
          && now >= Number(j.state.next_run_at_ms)
          && !this._is_running_fresh(j, now)
        ),
      );
      for (const job of due_jobs) {
        await this._execute_job(job);
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
    try {
      await this._save_store();
      try {
        if (this.on_job) {
          await this.on_job(job);
        }
        job.state.last_status = "ok";
        job.state.last_error = null;
      } catch (error) {
        job.state.last_status = "error";
        job.state.last_error = error instanceof Error ? error.message : String(error);
      }

      job.state.last_run_at_ms = start_ms;
      job.state.running = false;
      job.state.running_started_at_ms = null;
      job.updated_at_ms = now_ms();

      if (job.schedule.kind === "at") {
        if (job.delete_after_run) {
          store.jobs = store.jobs.filter((j) => j.id !== job.id);
        } else {
          job.enabled = false;
          job.state.next_run_at_ms = null;
        }
      } else {
        job.state.next_run_at_ms = _compute_next_run(job.schedule, now_ms());
      }
    } finally {
      await this._release_job_lock(lock_path);
    }
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
    await this._arm_timer();
  }

  async stop(): Promise<void> {
    this._running = false;
    this._paused = false;
    this._timer_abort?.abort();
    this._timer_abort = null;
    if (this._timer_task) {
      try {
        await this._timer_task;
      } catch {
        // ignore abort/timer errors during shutdown
      }
    }
    this._timer_task = null;
    for (const t of this._legacy_timers) clearInterval(t);
    this._legacy_timers.clear();
  }

  async pause(): Promise<void> {
    this._paused = true;
    this._timer_abort?.abort();
    this._timer_abort = null;
    if (this._timer_task) {
      try {
        await this._timer_task;
      } catch {
        // ignore abort/timer errors during pause
      }
    }
    this._timer_task = null;
  }

  async resume(): Promise<void> {
    if (!this._running) {
      await this.start();
      return;
    }
    this._paused = false;
    await this._arm_timer();
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
  ): Promise<CronJob> {
    const store = await this._load_store();
    _validate_schedule_for_add(schedule);
    const now = now_ms();
    const should_delete_after_run = typeof delete_after_run === "boolean"
      ? delete_after_run
      : schedule.kind === "at";
    const job: CronJob = {
      id: randomUUID().slice(0, 8),
      name,
      enabled: true,
      schedule,
      payload: {
        kind: "agent_turn",
        message,
        deliver,
        channel,
        to,
      },
      state: {
        next_run_at_ms: _compute_next_run(schedule, now),
        last_run_at_ms: null,
        last_status: null,
        last_error: null,
        running: false,
        running_started_at_ms: null,
      },
      created_at_ms: now,
      updated_at_ms: now,
      delete_after_run: should_delete_after_run,
    };
    store.jobs.push(job);
    await this._save_store();
    await this._arm_timer();
    return job;
  }

  async remove_job(job_id: string): Promise<boolean> {
    const store = await this._load_store();
    const before = store.jobs.length;
    store.jobs = store.jobs.filter((j) => j.id !== job_id);
    const removed = store.jobs.length < before;
    if (removed) {
      await this._save_store();
      await this._arm_timer();
    }
    return removed;
  }

  async enable_job(job_id: string, enabled = true): Promise<CronJob | null> {
    const store = await this._load_store();
    for (const job of store.jobs) {
      if (job.id !== job_id) continue;
      job.enabled = enabled;
      job.updated_at_ms = now_ms();
      if (enabled) job.state.next_run_at_ms = _compute_next_run(job.schedule, now_ms());
      else job.state.next_run_at_ms = null;
      await this._save_store();
      await this._arm_timer();
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
      await this._save_store();
      await this._arm_timer();
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

  // lightweight helper kept for runtime metrics ticker.
  every(ms: number, fn: () => Promise<void>): void {
    const t = setInterval(() => { void fn(); }, Math.max(1_000, ms));
    this._legacy_timers.add(t);
  }
}
