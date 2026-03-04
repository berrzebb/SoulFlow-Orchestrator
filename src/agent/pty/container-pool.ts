/** ContainerPool — Pty 인스턴스의 생명주기를 관리. */

import type { Logger } from "../../logger.js";
import type { Pty, PtyFactory, PtySpawnOptions, CliAdapter, Disposable, BuildArgsOptions } from "./types.js";

export type ContainerPoolOptions = {
  pty_factory: PtyFactory;
  adapter: CliAdapter;
  default_env: Record<string, string>;
  cwd: string;
  /** 유휴 컨테이너 최대 대기 시간 (ms). 0 = 정리 안 함. */
  max_idle_ms: number;
  logger: Logger;
  /** 커스텀 생존 확인. Docker: docker inspect. 미주입: kill(pid, 0). */
  is_alive?: (pid: string) => Promise<boolean>;
};

type PoolEntry = {
  pty: Pty;
  session_key: string;
  last_activity_ms: number;
  subscriptions: Disposable[];
};

export type ReconcileResult = {
  reattached: string[];
  orphaned: string[];
  cleaned: string[];
};

export class ContainerPool {
  private readonly entries = new Map<string, PoolEntry>();
  private readonly factory: PtyFactory;
  private readonly adapter: CliAdapter;
  private readonly default_env: Record<string, string>;
  private readonly cwd: string;
  private readonly max_idle_ms: number;
  private readonly logger: Logger;
  private readonly is_alive_fn?: (pid: string) => Promise<boolean>;
  private cleanup_timer: ReturnType<typeof setInterval> | null = null;

  constructor(options: ContainerPoolOptions) {
    this.factory = options.pty_factory;
    this.adapter = options.adapter;
    this.default_env = options.default_env;
    this.cwd = options.cwd;
    this.max_idle_ms = options.max_idle_ms;
    this.logger = options.logger;
    this.is_alive_fn = options.is_alive;

    if (this.max_idle_ms > 0) {
      this.cleanup_timer = setInterval(() => this.cleanup(), this.max_idle_ms);
      this.cleanup_timer.unref();
    }
  }

  /** 세션 키에 대한 Pty를 반환. 없으면 spawn. */
  ensure_running(session_key: string, args_options?: BuildArgsOptions, env?: Record<string, string>): Pty {
    const existing = this.entries.get(session_key);
    if (existing) {
      existing.last_activity_ms = Date.now();
      return existing.pty;
    }

    const spawn_options: PtySpawnOptions = {
      name: to_container_name(session_key),
      cwd: this.cwd,
      env: { ...this.default_env, ...env },
    };

    const build_options: BuildArgsOptions = args_options ?? { session_key };

    const pty = this.factory(
      this.adapter.cli_id,
      this.adapter.build_args(build_options),
      spawn_options,
    );

    const entry: PoolEntry = {
      pty,
      session_key,
      last_activity_ms: Date.now(),
      subscriptions: [],
    };

    const exit_sub = pty.onExit((e) => {
      this.logger.debug("pty exited", { session_key, exit_code: e.exitCode });
      this.remove_entry(session_key);
    });
    entry.subscriptions.push(exit_sub);

    this.entries.set(session_key, entry);
    this.logger.debug("pty spawned", { session_key, pid: pty.pid });
    return pty;
  }

  /** 활동 시간 갱신. */
  touch(session_key: string): void {
    const entry = this.entries.get(session_key);
    if (entry) entry.last_activity_ms = Date.now();
  }

  /** 세션 키에 대한 Pty를 조회. 없으면 null. */
  get(session_key: string): Pty | null {
    return this.entries.get(session_key)?.pty ?? null;
  }

  /** 세션 키에 대한 Pty를 강제 종료 후 pool에서 제거. */
  async remove(session_key: string): Promise<void> {
    const entry = this.entries.get(session_key);
    if (!entry) return;
    entry.pty.kill();
    this.remove_entry(session_key);
  }

  /** 유휴 시간 초과된 Pty를 정리. */
  cleanup(): void {
    if (this.max_idle_ms <= 0) return;
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (now - entry.last_activity_ms > this.max_idle_ms) {
        this.logger.debug("idle cleanup", { session_key: key });
        entry.pty.kill();
        this.remove_entry(key);
      }
    }
  }

  /** 전체 Pty 종료. */
  async shutdown(): Promise<void> {
    if (this.cleanup_timer) {
      clearInterval(this.cleanup_timer);
      this.cleanup_timer = null;
    }
    for (const [key, entry] of this.entries) {
      entry.pty.kill();
      this.remove_entry(key);
      this.logger.debug("shutdown kill", { session_key: key });
    }
  }

  list_sessions(): string[] {
    return [...this.entries.keys()];
  }

  get size(): number {
    return this.entries.size;
  }

  /** 풀 상태 정합성 검사. 죽은 프로세스를 정리하고 결과를 반환. */
  async reconcile(): Promise<ReconcileResult> {
    const cleaned: string[] = [];
    for (const [key, entry] of this.entries) {
      const alive = this.is_alive_fn
        ? await this.is_alive_fn(entry.pty.pid)
        : is_process_alive(entry.pty.pid);
      if (!alive) {
        this.logger.debug("reconcile: stale entry", { session_key: key, pid: entry.pty.pid });
        this.remove_entry(key);
        cleaned.push(key);
      }
    }
    return { reattached: [], orphaned: [], cleaned };
  }

  private remove_entry(session_key: string): void {
    const entry = this.entries.get(session_key);
    if (!entry) return;
    for (const sub of entry.subscriptions) sub.dispose();
    this.entries.delete(session_key);
  }
}

/** 프로세스 생존 확인. pid가 숫자가 아닌 경우(컨테이너 ID 등) false. */
function is_process_alive(pid: string): boolean {
  const num = Number(pid);
  if (!Number.isFinite(num) || num <= 0) return false;
  try {
    process.kill(num, 0);
    return true;
  } catch {
    return false;
  }
}

/** 세션 키를 컨테이너 이름으로 변환. 특수문자를 하이픈으로 치환. */
function to_container_name(session_key: string): string {
  return "agent-" + session_key.replace(/[^a-zA-Z0-9-]/g, "-").slice(0, 60);
}
