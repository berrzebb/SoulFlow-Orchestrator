import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { ServiceLike } from "../runtime/service.types.js";
import {
  DEFAULT_HEARTBEAT_INTERVAL_S,
  HEARTBEAT_OK_TOKEN,
  HEARTBEAT_PROMPT,
  type HeartbeatServiceOptions,
  type HeartbeatStatus,
  type OnHeartbeat,
  type OnNotify,
} from "./types.js";
import { file_exists } from "../utils/common.js";

const SKIP_PATTERNS = new Set(["- [ ]", "* [ ]", "- [x]", "* [x]"]);

export function is_heartbeat_empty(content: string | null): boolean {
  if (!content) return true;
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("<!--") || SKIP_PATTERNS.has(line)) continue;
    return false;
  }
  return true;
}

export class HeartbeatService implements ServiceLike {
  readonly name = "heartbeat";
  readonly workspace: string;
  readonly heartbeat_file: string;
  readonly on_heartbeat: OnHeartbeat | null;
  readonly on_notify: OnNotify | null;
  readonly interval_s: number;
  private _enabled: boolean;

  private _running = false;
  private _paused = false;
  private _loop_abort: AbortController | null = null;
  private _loop_task: Promise<void> | null = null;

  constructor(workspace = process.cwd(), options?: HeartbeatServiceOptions) {
    this.workspace = workspace;
    this.heartbeat_file = join(workspace, "HEARTBEAT.md");
    this.on_heartbeat = options?.on_heartbeat ?? null;
    this.on_notify = options?.on_notify ?? null;
    this.interval_s = Math.max(5, Number(options?.interval_s || DEFAULT_HEARTBEAT_INTERVAL_S));
    this._enabled = options?.enabled ?? true;
  }

  private async _read_heartbeat_file(): Promise<string | null> {
    if (!(await file_exists(this.heartbeat_file))) return null;
    try {
      return await readFile(this.heartbeat_file, "utf-8");
    } catch {
      return null;
    }
  }

  async start(): Promise<void> {
    if (!this._enabled || this._running) return;
    this._running = true;
    this._paused = false;
    const controller = new AbortController();
    this._loop_abort = controller;
    this._loop_task = this._run_loop(controller.signal);
  }

  async stop(): Promise<void> {
    this._running = false;
    this._paused = false;
    this._loop_abort?.abort();
    this._loop_abort = null;
    if (this._loop_task) {
      try {
        await this._loop_task;
      } catch {
        // ignore abort/timer errors during shutdown
      }
    }
    this._loop_task = null;
  }

  async pause(): Promise<void> {
    this._paused = true;
    this._loop_abort?.abort();
    this._loop_abort = null;
    if (this._loop_task) {
      try {
        await this._loop_task;
      } catch {
        // ignore abort/timer errors during pause
      }
    }
    this._loop_task = null;
  }

  async resume(): Promise<void> {
    if (!this._enabled) return;
    if (!this._running) {
      await this.start();
      return;
    }
    if (!this._paused) return;
    this._paused = false;
    const controller = new AbortController();
    this._loop_abort = controller;
    this._loop_task = this._run_loop(controller.signal);
  }

  set_enabled(enabled: boolean): void {
    this._enabled = enabled;
  }

  private async _run_loop(signal: AbortSignal): Promise<void> {
    while (this._running && !signal.aborted) {
      try {
        await sleep(this.interval_s * 1000, undefined, { signal });
        if (this._running && !this._paused && !signal.aborted) await this._tick();
      } catch {
        if (signal.aborted) return;
      }
    }
  }

  private async _tick(): Promise<void> {
    const content = await this._read_heartbeat_file();
    if (is_heartbeat_empty(content)) return;
    if (!this.on_heartbeat) return;
    try {
      const response = await this.on_heartbeat(HEARTBEAT_PROMPT);
      if (response.toUpperCase().includes(HEARTBEAT_OK_TOKEN)) return;
      if (this.on_notify) await this.on_notify(response);
    } catch {
      // heartbeat failures are isolated from scheduler loop.
    }
  }

  async trigger_now(): Promise<string | null> {
    if (!this.on_heartbeat) return null;
    return this.on_heartbeat(HEARTBEAT_PROMPT);
  }

  health_check(): { ok: boolean; details?: Record<string, unknown> } {
    return { ok: this._running && this._enabled, details: { paused: this._paused, interval_s: this.interval_s } };
  }

  status(): HeartbeatStatus {
    return {
      running: this._running,
      enabled: this._enabled && !this._paused,
      paused: this._paused,
      interval_s: this.interval_s,
      heartbeat_file: this.heartbeat_file,
    };
  }
}
