/** 요청 실행 흐름의 통합 추적. run_id → loop/task/subagent 연결 + cascade 취소. */

import type { TeamScopeOpts } from "../contracts.js";
import { now_iso, short_id } from "../utils/common.js";
import type { ChannelProvider } from "../channels/types.js";
import type { ExecutionMode } from "./types.js";

/* ── Types ─────────────────────────────────────────── */

export type ProcessStatus = "running" | "completed" | "failed" | "cancelled";

export type ProcessEntry = {
  run_id: string;
  /** 소유 팀. 외부 채널(Slack 등)은 빈 문자열 → superadmin만 조회 가능. */
  team_id: string;
  provider: ChannelProvider;
  chat_id: string;
  alias: string;
  sender_id: string;
  mode: ExecutionMode;
  status: ProcessStatus;
  started_at: string;
  ended_at?: string;
  loop_id?: string;
  task_id?: string;
  workflow_id?: string;
  subagent_ids: string[];
  tool_calls_count: number;
  executor_provider?: string;
  error?: string;
};

export interface CancelStrategy {
  abort_run(provider: ChannelProvider, chat_id: string, alias: string): boolean;
  stop_loop(loop_id: string): boolean;
  cancel_task(task_id: string): Promise<boolean>;
  cancel_subagent(id: string): boolean;
}

export interface ProcessTrackerLike {
  start(params: { provider: ChannelProvider; chat_id: string; alias: string; sender_id: string; team_id?: string }): string;
  set_mode(run_id: string, mode: ExecutionMode): void;
  set_executor(run_id: string, executor: string): void;
  link_loop(run_id: string, loop_id: string): void;
  link_task(run_id: string, task_id: string): void;
  link_subagent(run_id: string, subagent_id: string): void;
  link_workflow(run_id: string, workflow_id: string): void;
  set_tool_count(run_id: string, count: number): void;
  end(run_id: string, status: ProcessStatus, error?: string): void;
  get(run_id: string): ProcessEntry | null;
  find_active_by_key(provider: ChannelProvider, chat_id: string, alias: string): ProcessEntry | null;
  list_active(team_id?: string): ProcessEntry[];
  list_recent(limit?: number, team_id?: string): ProcessEntry[];
  cancel(run_id: string, opts?: TeamScopeOpts): Promise<{ cancelled: boolean; details: string }>;
}

/* ── Implementation ────────────────────────────────── */

const DEFAULT_MAX_HISTORY = 100;

function run_key(provider: ChannelProvider, chat_id: string, alias: string): string {
  return `${provider}:${chat_id}:${alias}`.toLowerCase();
}

export class ProcessTracker implements ProcessTrackerLike {
  private readonly active = new Map<string, ProcessEntry>();
  private readonly history: ProcessEntry[] = [];
  private readonly key_index = new Map<string, string>();
  private readonly max_history: number;
  private readonly cancel_strategy: CancelStrategy | null;
  private readonly on_change: ((type: "start" | "end", entry: ProcessEntry) => void) | null;

  constructor(options?: {
    max_history?: number;
    cancel_strategy?: CancelStrategy | null;
    on_change?: (type: "start" | "end", entry: ProcessEntry) => void;
  }) {
    this.max_history = options?.max_history ?? DEFAULT_MAX_HISTORY;
    this.cancel_strategy = options?.cancel_strategy ?? null;
    this.on_change = options?.on_change ?? null;
  }

  start(params: { provider: ChannelProvider; chat_id: string; alias: string; sender_id: string; team_id?: string }): string {
    const id = short_id();
    const entry: ProcessEntry = {
      run_id: id,
      team_id: params.team_id ?? "",
      provider: params.provider,
      chat_id: params.chat_id,
      alias: params.alias,
      sender_id: params.sender_id,
      mode: "once",
      status: "running",
      started_at: now_iso(),
      subagent_ids: [],
      tool_calls_count: 0,
    };
    this.active.set(id, entry);
    this.key_index.set(run_key(params.provider, params.chat_id, params.alias), id);
    this.on_change?.("start", entry);
    return id;
  }

  set_mode(run_id: string, mode: ExecutionMode): void {
    const e = this.active.get(run_id);
    if (e) e.mode = mode;
  }

  set_executor(run_id: string, executor: string): void {
    const e = this.active.get(run_id);
    if (e) e.executor_provider = executor;
  }

  link_loop(run_id: string, loop_id: string): void {
    const e = this.active.get(run_id);
    if (e) e.loop_id = loop_id;
  }

  link_task(run_id: string, task_id: string): void {
    const e = this.active.get(run_id);
    if (e) e.task_id = task_id;
  }

  link_subagent(run_id: string, subagent_id: string): void {
    const e = this.active.get(run_id);
    if (e && !e.subagent_ids.includes(subagent_id)) {
      e.subagent_ids.push(subagent_id);
    }
  }

  link_workflow(run_id: string, workflow_id: string): void {
    const e = this.active.get(run_id);
    if (e) e.workflow_id = workflow_id;
  }

  set_tool_count(run_id: string, count: number): void {
    const e = this.active.get(run_id);
    if (e) e.tool_calls_count = count;
  }

  end(run_id: string, status: ProcessStatus, error?: string): void {
    const e = this.active.get(run_id);
    if (!e) return;
    e.status = status;
    e.ended_at = now_iso();
    if (error) e.error = error;

    this.active.delete(run_id);
    const k = run_key(e.provider, e.chat_id, e.alias);
    if (this.key_index.get(k) === run_id) this.key_index.delete(k);

    this.history.push(e);
    while (this.history.length > this.max_history) this.history.shift();
    this.on_change?.("end", e);
  }

  get(run_id: string): ProcessEntry | null {
    return this.active.get(run_id) ?? this.history.find((e) => e.run_id === run_id) ?? null;
  }

  find_active_by_key(provider: ChannelProvider, chat_id: string, alias: string): ProcessEntry | null {
    const id = this.key_index.get(run_key(provider, chat_id, alias));
    return id ? (this.active.get(id) ?? null) : null;
  }

  list_active(team_id?: string): ProcessEntry[] {
    const all = [...this.active.values()];
    if (team_id === undefined) return all;
    return all.filter((e) => e.team_id === team_id);
  }

  list_recent(limit = 20, team_id?: string): ProcessEntry[] {
    if (team_id === undefined) return this.history.slice(-Math.max(1, limit)).reverse();
    const filtered = this.history.filter((e) => e.team_id === team_id);
    return filtered.slice(-Math.max(1, limit)).reverse();
  }

  async cancel(run_id: string, opts?: TeamScopeOpts): Promise<{ cancelled: boolean; details: string }> {
    const e = this.active.get(run_id);
    if (!e) return { cancelled: false, details: "프로세스를 찾을 수 없습니다" };
    if (opts?.team_id !== undefined && e.team_id !== opts.team_id) {
      return { cancelled: false, details: "프로세스를 찾을 수 없습니다" };
    }
    if (!this.cancel_strategy) return { cancelled: false, details: "cancel_strategy 미설정" };

    const steps: string[] = [];

    for (const sid of e.subagent_ids) {
      if (this.cancel_strategy.cancel_subagent(sid)) steps.push(`subagent:${sid}`);
    }
    if (e.loop_id && this.cancel_strategy.stop_loop(e.loop_id)) {
      steps.push(`loop:${e.loop_id}`);
    }
    if (e.task_id) {
      const ok = await this.cancel_strategy.cancel_task(e.task_id);
      if (ok) steps.push(`task:${e.task_id}`);
    }
    this.cancel_strategy.abort_run(e.provider, e.chat_id, e.alias);
    steps.push("abort_signal");

    this.end(run_id, "cancelled", "cascade_cancel");
    return { cancelled: true, details: steps.join(", ") };
  }
}
