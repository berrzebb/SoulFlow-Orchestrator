/** Lane Queue — 세션별 메시지 직렬화 + 배치 수집 + 글로벌 동시성 제한. */

import { Semaphore } from "./semaphore.js";

export type LaneQueueOptions = {
  /** 전체 세션에 걸친 최대 동시 API 호출 수. 0 또는 미설정 = 제한 없음. */
  global_concurrency?: number;
};

type QueuedItem<T> = {
  task: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

/** FIFO 직렬 큐. 동시 실행 방지. */
export class Lane {
  private queue: QueuedItem<unknown>[] = [];
  private running = false;

  async enqueue<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ task, resolve: resolve as (v: unknown) => void, reject });
      if (!this.running) void this.drain();
    });
  }

  get pending(): number {
    return this.queue.length;
  }

  get is_idle(): boolean {
    return !this.running && this.queue.length === 0;
  }

  private async drain(): Promise<void> {
    this.running = true;
    while (this.queue.length > 0) {
      const item = this.queue.shift()!;
      try {
        const result = await item.task();
        item.resolve(result);
      } catch (err) {
        item.reject(err);
      }
    }
    this.running = false;
  }
}

export type LaneMode = "followup" | "collect";

/** 세션별 메시지 큐. followup/collect 모드 + 글로벌 동시성 제한. */
export class LaneQueue {
  private readonly session_lanes = new Map<string, Lane>();
  private readonly pending_followups = new Map<string, string[]>();
  private readonly collected = new Map<string, string[]>();
  private readonly global_semaphore: Semaphore | null;

  constructor(options?: LaneQueueOptions) {
    const concurrency = options?.global_concurrency ?? 0;
    this.global_semaphore = concurrency > 0 ? new Semaphore(concurrency) : null;
  }

  private resolve_lane(session_key: string): Lane {
    let lane = this.session_lanes.get(session_key);
    if (!lane) {
      lane = new Lane();
      this.session_lanes.set(session_key, lane);
    }
    return lane;
  }

  /** 직렬화된 실행. 같은 세션의 동시 호출이 순서대로 실행. 글로벌 세마포어로 전체 동시성 제한. */
  async execute<T>(session_key: string, task: () => Promise<T>): Promise<T> {
    const run = () => this.resolve_lane(session_key).enqueue(task);
    if (!this.global_semaphore) return run();
    const release = await this.global_semaphore.acquire();
    try { return await run(); } finally { release(); }
  }

  /** 현재 턴 완료 후 전달할 메시지를 큐잉. */
  followup(session_key: string, content: string): void {
    const list = this.pending_followups.get(session_key) ?? [];
    list.push(content);
    this.pending_followups.set(session_key, list);
  }

  /** 여러 메시지를 수집하여 배치 전달. */
  collect(session_key: string, content: string): void {
    const list = this.collected.get(session_key) ?? [];
    list.push(content);
    this.collected.set(session_key, list);
  }

  /** 큐에 쌓인 followup 메시지를 꺼냄. */
  drain_followups(session_key: string): string[] {
    const list = this.pending_followups.get(session_key) ?? [];
    this.pending_followups.delete(session_key);
    return list;
  }

  /** 수집된 메시지를 합쳐서 반환. */
  drain_collected(session_key: string, separator = "\n\n"): string | null {
    const list = this.collected.get(session_key);
    if (!list?.length) return null;
    this.collected.delete(session_key);
    return list.join(separator);
  }

  /** followup이 도착할 때까지 최대 timeout_ms만큼 대기. 없으면 null. */
  wait_for_followup(session_key: string, timeout_ms: number): Promise<string[] | null> {
    const immediate = this.drain_followups(session_key);
    if (immediate.length > 0) return Promise.resolve(immediate);

    return new Promise<string[] | null>((resolve) => {
      const interval = 200;
      let elapsed = 0;
      const timer = setInterval(() => {
        elapsed += interval;
        const items = this.drain_followups(session_key);
        if (items.length > 0) { clearInterval(timer); resolve(items); }
        else if (elapsed >= timeout_ms) { clearInterval(timer); resolve(null); }
      }, interval);
    });
  }

  /** 세션 정리. */
  clear(session_key: string): void {
    this.session_lanes.delete(session_key);
    this.pending_followups.delete(session_key);
    this.collected.delete(session_key);
  }

  /** 유휴 레인 정리. 메모리 누수 방지. */
  prune_idle(): number {
    let pruned = 0;
    for (const [key, lane] of this.session_lanes) {
      if (lane.is_idle) {
        this.session_lanes.delete(key);
        pruned++;
      }
    }
    return pruned;
  }

  get session_count(): number {
    return this.session_lanes.size;
  }
}
