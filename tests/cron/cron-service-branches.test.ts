/**
 * CronService — 내부 분기 커버리지 통합 테스트.
 * coverage + cov6 + cov7 + cov8 + cov9에서 고유 테스트만 병합.
 */
import { mkdtemp, rm, writeFile, mkdir, utimes } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CronService } from "@src/cron/service.js";
import type { CronJob } from "@src/cron/types.js";

let store_path: string;

beforeEach(async () => {
  store_path = await mkdtemp(join(tmpdir(), "cron-branch-"));
});

afterEach(async () => {
  await rm(store_path, { recursive: true, force: true }).catch(() => {});
});

function make_svc(on_job?: (...args: any[]) => Promise<void>, opts?: Record<string, any>) {
  return new CronService(store_path, on_job ?? null, opts);
}

function make_job(id: string, overrides: Partial<CronJob> = {}): CronJob {
  const now = Date.now();
  return {
    id,
    name: "test-job",
    enabled: true,
    schedule: { kind: "every", every_ms: 60_000, at_ms: null, expr: null, tz: null },
    payload: { kind: "agent_turn", message: "test", deliver: false, channel: null, to: null },
    state: {
      next_run_at_ms: now - 1000,
      last_run_at_ms: null,
      last_status: null,
      last_error: null,
      running: false,
      running_started_at_ms: null,
    },
    created_at_ms: now,
    updated_at_ms: now,
    delete_after_run: false,
    ...overrides,
  };
}

// ══════════════════════════════════════════
// _parse_field — step 패턴 + 엣지 케이스
// ══════════════════════════════════════════

describe("CronService — _parse_field", () => {
  it("*/5 분 필드 → 5분 간격", async () => {
    const svc = make_svc();
    const job = await svc.add_job("step-job", { kind: "cron", expr: "*/5 * * * *" }, "msg");
    expect(job.state.next_run_at_ms).toBeGreaterThan(Date.now());
    await svc.stop().catch(() => {});
  });

  it("*/2 시간 필드 → 2시간 간격", async () => {
    const svc = make_svc();
    const job = await svc.add_job("step-hour", { kind: "cron", expr: "0 */2 * * *" }, "msg");
    expect(job.state.next_run_at_ms).toBeGreaterThan(Date.now());
    await svc.stop().catch(() => {});
  });

  it("'1,,2 * * * *' → 빈 part skip → 유효 (cov7)", async () => {
    const svc = make_svc();
    const job = await svc.add_job("test", { kind: "cron", expr: "1,,2 * * * *" }, "body");
    expect(job.id).toBeTruthy();
    await svc.stop();
  });

  it("잘못된 범위 59-0 → invalid cron expression", async () => {
    const svc = make_svc();
    await expect(svc.add_job("bad-range", { kind: "cron", expr: "59-0 * * * *" }, "msg"))
      .rejects.toThrow("invalid cron expression");
    await svc.stop().catch(() => {});
  });

  it("범위 값 최대 초과 0-60 → invalid cron expression", async () => {
    const svc = make_svc();
    await expect(svc.add_job("out-of-range", { kind: "cron", expr: "0-60 * * * *" }, "msg"))
      .rejects.toThrow("invalid cron expression");
    await svc.stop().catch(() => {});
  });

  it("step=0 (*/0) → invalid cron expression", async () => {
    const svc = make_svc();
    await expect(svc.add_job("step-zero", { kind: "cron", expr: "*/0 * * * *" }, "msg"))
      .rejects.toThrow("invalid cron expression");
    await svc.stop().catch(() => {});
  });

  it("범위 밖 단일값 (분 60) → invalid cron expression", async () => {
    const svc = make_svc();
    await expect(svc.add_job("single-out", { kind: "cron", expr: "60 * * * *" }, "msg"))
      .rejects.toThrow("invalid cron expression");
    await svc.stop().catch(() => {});
  });
});

// ══════════════════════════════════════════
// weekday 7 정규화
// ══════════════════════════════════════════

describe("CronService — weekday 7 정규화", () => {
  it("weekday=7 → 0으로 정규화 (일요일)", async () => {
    const svc = make_svc();
    const job = await svc.add_job("sun-job", { kind: "cron", expr: "0 9 * * 7" }, "sunday");
    expect(job.state.next_run_at_ms).toBeGreaterThan(Date.now());
    await svc.stop().catch(() => {});
  });

  it("weekday 0,7 → 중복 일요일 처리", async () => {
    const svc = make_svc();
    const job = await svc.add_job("sun-dup", { kind: "cron", expr: "0 9 * * 0,7" }, "sunday");
    expect(job.state.next_run_at_ms).toBeGreaterThan(Date.now());
    await svc.stop().catch(() => {});
  });
});

// ══════════════════════════════════════════
// on_change — pause/resume 콜백
// ══════════════════════════════════════════

describe("CronService — on_change pause/resume", () => {
  it("pause/resume → paused/resumed 콜백", async () => {
    const changes: string[] = [];
    const svc = make_svc(undefined, {
      on_change: (type: string) => { changes.push(type); },
    });
    await svc.start();
    changes.length = 0;
    await svc.pause();
    expect(changes).toContain("paused");
    await svc.resume();
    expect(changes).toContain("resumed");
    await svc.stop().catch(() => {});
  });
});

// ══════════════════════════════════════════
// every + at_ms 경로
// ══════════════════════════════════════════

describe("CronService — every + at_ms", () => {
  it("at_ms 미래 → next_run = at_ms", async () => {
    const svc = make_svc();
    const future = Date.now() + 3_600_000;
    const job = await svc.add_job("deferred", { kind: "every", every_ms: 60_000, at_ms: future }, "d");
    expect(job.state.next_run_at_ms).toBe(future);
    await svc.stop().catch(() => {});
  });

  it("at_ms 과거 → next_run = now + every_ms", async () => {
    const svc = make_svc();
    const past = Date.now() - 60_000;
    const job = await svc.add_job("past", { kind: "every", every_ms: 60_000, at_ms: past }, "p");
    expect(job.state.next_run_at_ms).toBeGreaterThan(Date.now());
    expect(job.state.next_run_at_ms).not.toBe(past);
    await svc.stop().catch(() => {});
  });
});

// ══════════════════════════════════════════
// _validate_schedule_for_add — 추가 경로
// ══════════════════════════════════════════

describe("CronService — _validate_schedule_for_add 추가", () => {
  it("빈 cron expr → expr is required", async () => {
    const svc = make_svc();
    await expect(svc.add_job("empty-cron", { kind: "cron", expr: "" }, "x"))
      .rejects.toThrow("expr is required");
    await svc.stop().catch(() => {});
  });

  it("invalid every at_ms=-1 → Error", async () => {
    const svc = make_svc();
    await expect(svc.add_job("bad", { kind: "every", every_ms: 60_000, at_ms: -1 }, "x"))
      .rejects.toThrow();
    await svc.stop().catch(() => {});
  });

  it("schedule 없음 → invalid_schedule", async () => {
    const svc = make_svc();
    await expect(svc.add_job("no-sched", null as any, "x"))
      .rejects.toThrow("invalid_schedule");
    await svc.stop().catch(() => {});
  });
});

// ══════════════════════════════════════════
// Public API 추가 경로
// ══════════════════════════════════════════

describe("CronService — 공개 API 추가 경로", () => {
  it("start() 중복 호출 → no-op", async () => {
    const svc = make_svc();
    await svc.start();
    expect(svc.health_check().ok).toBe(true);
    await svc.start();
    expect(svc.health_check().ok).toBe(true);
    await svc.stop().catch(() => {});
  });

  it("schedule.kind 없음 → throw", async () => {
    const svc = make_svc();
    await expect(svc.add_job("no-kind", {} as any, "msg"))
      .rejects.toThrow("schedule.kind is required");
    await svc.stop().catch(() => {});
  });

  it("cron schedule: expr 없음 → throw", async () => {
    const svc = make_svc();
    await expect(svc.add_job("no-expr", { kind: "cron" } as any, "msg"))
      .rejects.toThrow("invalid cron schedule: expr is required");
    await svc.stop().catch(() => {});
  });

  it("list_jobs null next_run 정렬", async () => {
    const svc = make_svc();
    const j1 = await svc.add_job("j1", { kind: "every", every_ms: 60_000 }, "m1");
    await svc.enable_job(j1.id, false);
    await svc.add_job("j2", { kind: "every", every_ms: 30_000 }, "m2");
    const jobs = await svc.list_jobs(true);
    expect(jobs.length).toBe(2);
    const idx_j2 = jobs.findIndex(j => j.name === "j2");
    const idx_j1 = jobs.findIndex(j => j.name === "j1");
    expect(idx_j2).toBeLessThan(idx_j1);
    await svc.stop().catch(() => {});
  });

  it("every() 등록 후 stop() → 타이머 정리", async () => {
    const svc = make_svc();
    let count = 0;
    svc.every(60_000, async () => { count++; });
    await svc.stop();
    expect(count).toBe(0);
  });

  it("enable_job(true) → next_run 재계산 (cov7)", async () => {
    const svc = make_svc();
    const job = await svc.add_job("togglable", { kind: "every", every_ms: 60_000 }, "msg");
    await svc.enable_job(job.id, false);
    const updated = await svc.enable_job(job.id, true);
    expect(updated?.enabled).toBe(true);
    expect(updated?.state.next_run_at_ms).toBeGreaterThan(0);
    await svc.stop();
  });

  it("두 잡 등록 후 두 번째 id로 run_job → 첫 번째 continue (cov8)", async () => {
    const on_job = vi.fn().mockResolvedValue(undefined);
    const svc = new CronService(store_path, on_job, {});
    await svc.add_job("job1", { kind: "every", every_ms: 60_000 }, "msg1");
    const job2 = await svc.add_job("job2", { kind: "every", every_ms: 60_000 }, "msg2");
    const result = await svc.run_job(job2.id, true);
    expect(result).toBe(true);
    expect(on_job).toHaveBeenCalledTimes(1);
    await svc.stop();
  });
});

// ══════════════════════════════════════════
// _load_store / _recompute_next_runs 내부 경로
// ══════════════════════════════════════════

describe("CronService — _load_store / _recompute", () => {
  it("_load_store 캐시 히트 — 두 번 호출해도 같은 store", async () => {
    const svc = make_svc();
    const s1 = await svc._load_store();
    const s2 = await svc._load_store();
    expect(s1).toBe(s2);
    await svc.stop().catch(() => {});
  });

  it("stale running 잡 → _recompute_next_runs에서 리셋", async () => {
    const svc = new CronService(store_path, null, { running_lease_ms: 5_000 });
    const job = await svc.add_job("stale", { kind: "every", every_ms: 60_000 }, "test");
    const store = await svc._load_store();
    const j = store.jobs.find(j => j.id === job.id);
    if (j) {
      j.state.running = true;
      j.state.running_started_at_ms = Date.now() - 30_000;
    }
    await svc._save_store();
    svc._store = null;
    await svc.start();
    const jobs = await svc.list_jobs(true);
    const updated = jobs.find(j => j.id === job.id);
    expect(updated?.state.running).toBe(false);
    await svc.stop().catch(() => {});
  });

  it("running=true + fresh → skip (cov7)", async () => {
    const svc = make_svc();
    const job = await svc.add_job("runner", { kind: "every", every_ms: 60_000 }, "msg");
    const store = await (svc as any)._load_store();
    const j = store.jobs.find((x: any) => x.id === job.id);
    j.state.running = true;
    j.state.running_started_at_ms = Date.now();
    await (svc as any)._recompute_next_runs();
    expect(j.state.running).toBe(true);
    await svc.stop();
  });

  it("running=false + enabled → next_run 갱신 (cov7)", async () => {
    const svc = make_svc();
    await svc.add_job("enabled-job", { kind: "every", every_ms: 60_000 }, "msg");
    await (svc as any)._recompute_next_runs();
    const store = await (svc as any)._load_store();
    const j = store.jobs.find((x: any) => x.name === "enabled-job");
    expect(j.state.next_run_at_ms).toBeGreaterThan(0);
    await svc.stop();
  });
});

// ══════════════════════════════════════════
// _on_timer 내부 경로
// ══════════════════════════════════════════

describe("CronService — _on_timer", () => {
  it("paused=true → 즉시 반환 (cov7)", async () => {
    const svc = make_svc();
    (svc as any)._running = true;
    (svc as any)._paused = true;
    await expect((svc as any)._on_timer()).resolves.toBeUndefined();
    await svc.stop();
  });

  it("running=false → 즉시 반환 (cov7)", async () => {
    const svc = make_svc();
    (svc as any)._running = false;
    await expect((svc as any)._on_timer()).resolves.toBeUndefined();
    await svc.stop().catch(() => {});
  });

  it("_tick_running=true → 조기 반환 (cov9)", async () => {
    const svc = new CronService(store_path, null, {});
    await (svc as any)._load_store();
    (svc as any)._running = true;
    (svc as any)._paused = false;
    (svc as any)._tick_running = true;
    await (svc as any)._on_timer();
    expect((svc as any)._tick_running).toBe(true);
    await svc.stop();
  });

  it("due job on_job throw → last_status=error (cov7)", async () => {
    const on_job = vi.fn().mockRejectedValue(new Error("job-fail"));
    const svc = new CronService(store_path, on_job, {});
    const past_ms = Date.now() - 5_000;
    const job = await svc.add_job("fail-job", { kind: "at", at_ms: past_ms }, "msg");
    (svc as any)._running = true;
    const store = await (svc as any)._load_store();
    const j = store.jobs.find((x: any) => x.id === job.id);
    j.state.next_run_at_ms = past_ms;
    j.enabled = true;
    await (svc as any)._on_timer();
    expect(j.state.last_status).toBe("error");
    await svc.stop();
  });
});

// ══════════════════════════════════════════
// _is_running_fresh
// ══════════════════════════════════════════

describe("CronService — _is_running_fresh", () => {
  const call = (job: unknown) =>
    (CronService.prototype as any)._is_running_fresh.call({}, job);

  it("running=false → false (cov7)", () => {
    expect(call({ state: { running: false, running_started_at_ms: null } })).toBe(false);
  });

  it("running=true + started=0 → false (cov8)", () => {
    expect(call({ state: { running: true, running_started_at_ms: 0 } })).toBe(false);
  });

  it("running=true + started=null → false (cov8)", () => {
    expect(call({ state: { running: true, running_started_at_ms: null } })).toBe(false);
  });
});

// ══════════════════════════════════════════
// _is_job_lock_stale / _acquire_job_lock
// ══════════════════════════════════════════

describe("CronService — lock 관련", () => {
  it("_is_job_lock_stale: 존재하지 않는 경로 → true (cov6)", async () => {
    const svc = make_svc();
    const result = await (svc as any)._is_job_lock_stale("/nonexistent/ghost.lock");
    expect(result).toBe(true);
    await svc.stop();
  });

  it("_is_job_lock_stale: lock 파일 + mtime 존재 → boolean (cov7)", async () => {
    const svc = make_svc();
    const lock_dir = join(store_path, ".locks");
    await mkdir(lock_dir, { recursive: true });
    const lock_path = join(lock_dir, "test.lock");
    await writeFile(lock_path, "0");
    const stale = await (svc as any)._is_job_lock_stale(lock_path);
    expect(typeof stale).toBe("boolean");
    await svc.stop();
  });

  it("stale lock → unlink 후 새 lock 획득 (cov6)", async () => {
    const svc = make_svc();
    const lock_dir = join(store_path, ".locks");
    await mkdir(lock_dir, { recursive: true });
    const lock_file = join(lock_dir, "stale-job.lock");
    await writeFile(lock_file, "stale");
    const old_time = new Date(Date.now() - 10 * 60 * 1000);
    await utimes(lock_file, old_time, old_time);
    const lock_path = await (svc as any)._acquire_job_lock("stale-job");
    expect(lock_path).toBeTruthy();
    expect(typeof lock_path).toBe("string");
    await svc.stop();
  });
});

// ══════════════════════════════════════════
// every() callback 예외 (fake timers)
// ══════════════════════════════════════════

describe("CronService — every() callback 예외 (cov6)", () => {
  it("callback reject → logger.error 호출", async () => {
    vi.useFakeTimers();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any;
    const svc = new CronService(store_path, null, { logger });
    svc.every(1000, vi.fn().mockRejectedValue(new Error("callback error")));
    await vi.advanceTimersByTimeAsync(1100);
    expect(logger.error).toHaveBeenCalledWith(
      "interval callback failed",
      expect.objectContaining({ error: expect.stringContaining("callback error") }),
    );
    vi.useRealTimers();
    await svc.stop();
  });
});

// ══════════════════════════════════════════
// _compute_next_run 내부 경로 (cov8, cov9)
// ══════════════════════════════════════════

describe("CronService — _compute_next_run 내부 경로", () => {
  it("invalid tz 잡 → _get_tz_parts catch → on_warn (cov8)", async () => {
    const warn_calls: string[] = [];
    const logger = {
      debug: vi.fn(), info: vi.fn(), error: vi.fn(),
      warn: (msg: string) => { warn_calls.push(msg); },
    };
    const svc = new CronService(store_path, null, { logger: logger as any });
    const store = await (svc as any)._load_store();
    store.jobs.push({
      id: "bad-tz-job", name: "bad tz", enabled: true,
      schedule: { kind: "cron", expr: "0 * * * *", tz: "Not/A/Timezone", at_ms: null, every_ms: null },
      payload: { kind: "agent_turn", message: "test", deliver: false, channel: null, to: null },
      state: { next_run_at_ms: null, last_run_at_ms: null, last_status: null, last_error: null, running: false, running_started_at_ms: null },
      created_at_ms: Date.now(), updated_at_ms: Date.now(), delete_after_run: false,
    });
    await (svc as any)._recompute_next_runs();
    expect(warn_calls.length).toBeGreaterThan(0);
    const job = store.jobs.find((j: any) => j.id === "bad-tz-job");
    expect(job?.state?.next_run_at_ms).toBeNull();
    await svc.stop();
  });

  it("at schedule, at_ms=null → null (cov9)", async () => {
    const svc = make_svc();
    const store = await (svc as any)._load_store();
    store.jobs.push(make_job("j-at", {
      schedule: { kind: "at", at_ms: null, every_ms: null, expr: null, tz: null },
    }));
    await (svc as any)._recompute_next_runs();
    const job = store.jobs.find((j: CronJob) => j.id === "j-at");
    expect(job?.state?.next_run_at_ms).toBeNull();
    await svc.stop();
  });

  it("every schedule, every_ms=null → null (cov9)", async () => {
    const svc = make_svc();
    const store = await (svc as any)._load_store();
    store.jobs.push(make_job("j-ev", {
      schedule: { kind: "every", every_ms: null, at_ms: null, expr: null, tz: null },
    }));
    await (svc as any)._recompute_next_runs();
    const job = store.jobs.find((j: CronJob) => j.id === "j-ev");
    expect(job?.state?.next_run_at_ms).toBeNull();
    await svc.stop();
  });

  it("cron expr 4 fields → _parse_cron null (cov9)", async () => {
    const svc = make_svc();
    const store = await (svc as any)._load_store();
    store.jobs.push(make_job("j-bad-cron", {
      schedule: { kind: "cron", expr: "0 * * *", at_ms: null, every_ms: null, tz: null },
    }));
    await (svc as any)._recompute_next_runs();
    const job = store.jobs.find((j: CronJob) => j.id === "j-bad-cron");
    expect(job?.state?.next_run_at_ms).toBeNull();
    await svc.stop();
  });

  it("cron expr='' → falls through → null (cov9)", async () => {
    const svc = make_svc();
    const store = await (svc as any)._load_store();
    store.jobs.push(make_job("j-empty-cron", {
      schedule: { kind: "cron", expr: "", at_ms: null, every_ms: null, tz: null },
    }));
    await (svc as any)._recompute_next_runs();
    const job = store.jobs.find((j: CronJob) => j.id === "j-empty-cron");
    expect(job?.state?.next_run_at_ms).toBeNull();
    await svc.stop();
  });
});

// ══════════════════════════════════════════
// persist_store — ROLLBACK (cov9)
// ══════════════════════════════════════════

describe("CronService — persist_store ROLLBACK", () => {
  it("같은 id 두 잡 → PK 충돌 → ROLLBACK → DB 복구", async () => {
    const svc = make_svc();
    const store = await (svc as any)._load_store();
    store.jobs.push(make_job("good-id"));
    await (svc as any)._save_store();
    const dup = make_job("dup-id");
    store.jobs.push(dup, { ...dup });
    await expect((svc as any)._save_store()).rejects.toThrow();
    (svc as any)._store = null;
    const recovered = await (svc as any)._load_store();
    expect(recovered.jobs.some((j: CronJob) => j.id === "good-id")).toBe(true);
    await svc.stop();
  });
});
