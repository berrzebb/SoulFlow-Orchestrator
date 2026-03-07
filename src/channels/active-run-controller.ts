/** 실행 중인 에이전트 런 관리. ChannelManager에서 분리된 dedicated port. */

import type { ChannelProvider } from "./types.js";

export type ActiveRun = {
  abort: AbortController;
  provider: ChannelProvider;
  chat_id: string;
  alias: string;
  done: Promise<void>;
  send_input?: (text: string) => void;
};

export interface ActiveRunControllerLike {
  register(key: string, run: ActiveRun): void;
  unregister(key: string, expected_abort: AbortController): void;
  get(key: string): ActiveRun | undefined;
  /** key 매칭되는 런 취소. key 미지정 시 전체 취소. 취소 수 반환. */
  cancel(key?: string): number;
  find_by_chat_id(chat_id: string): ActiveRun | undefined;
  readonly size: number;
  clear(): void;
}

export class ActiveRunController implements ActiveRunControllerLike {
  private readonly runs = new Map<string, ActiveRun>();
  private tracker: { find_active_by_key(p: string, c: string, a: string): { run_id: string } | null | undefined; end(run_id: string, status: string, reason: string): void } | null = null;

  set_tracker(t: typeof this.tracker): void { this.tracker = t; }

  get size(): number { return this.runs.size; }

  register(key: string, run: ActiveRun): void {
    this.runs.set(key, run);
  }

  unregister(key: string, expected_abort: AbortController): void {
    const current = this.runs.get(key);
    if (current?.abort === expected_abort) this.runs.delete(key);
  }

  get(key: string): ActiveRun | undefined {
    return this.runs.get(key);
  }

  cancel(key?: string): number {
    const lk = key?.toLowerCase();
    const targets = lk
      ? [...this.runs.keys()].filter((k) => k === lk || k.startsWith(`${lk}:`))
      : [...this.runs.keys()];
    for (const k of targets) {
      const run = this.runs.get(k);
      if (run) {
        run.abort.abort();
        const entry = this.tracker?.find_active_by_key(run.provider, run.chat_id, run.alias);
        if (entry) this.tracker!.end(entry.run_id, "cancelled", "stopped_by_request");
      }
      this.runs.delete(k);
    }
    return targets.length;
  }

  find_by_chat_id(chat_id: string): ActiveRun | undefined {
    for (const [, run] of this.runs) {
      if (run.chat_id === chat_id && run.send_input && !run.abort.signal.aborted) {
        return run;
      }
    }
    return undefined;
  }

  clear(): void {
    this.runs.clear();
  }
}
