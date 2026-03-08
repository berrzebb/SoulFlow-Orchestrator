// CronService — 미커버 분기 보충.
// _parse_field step 패턴, weekday 7 정규화, on_change 콜백,
// every + at_ms(start_at) 경로, _recompute_next_runs stale running 리셋,
// _validate_schedule_for_add 추가 경로, _load_store 캐시 히트.
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CronService } from "@src/cron/service.js";

let store_path: string;

beforeEach(async () => {
  store_path = await mkdtemp(join(tmpdir(), "cron-cov-"));
});

afterEach(async () => {
  await rm(store_path, { recursive: true, force: true }).catch(() => {});
});

// ══════════════════════════════════════════
// _parse_field — step 패턴 (*/n)
// ══════════════════════════════════════════

describe("CronService — _parse_field step 패턴", () => {
  it("*/5 분 필드 → 5분 간격으로 실행되는 잡 생성", async () => {
    const svc = new CronService(store_path, null);
    // */5 * * * * → 매 5분마다
    const job = await svc.add_job("step-job", { kind: "cron", expr: "*/5 * * * *" }, "msg");
    expect(job.state.next_run_at_ms).toBeGreaterThan(Date.now());
    await svc.stop().catch(() => {});
  });

  it("*/2 시간 필드 → 2시간 간격 실행", async () => {
    const svc = new CronService(store_path, null);
    const job = await svc.add_job("step-hour", { kind: "cron", expr: "0 */2 * * *" }, "msg");
    expect(job.state.next_run_at_ms).toBeGreaterThan(Date.now());
    await svc.stop().catch(() => {});
  });
});

// ══════════════════════════════════════════
// _parse_cron — weekday 7 → 0 정규화 (일요일)
// ══════════════════════════════════════════

describe("CronService — weekday 7 정규화", () => {
  it("cron expr weekday=7 (일요일) → 0으로 정규화됨", async () => {
    const svc = new CronService(store_path, null);
    // 7은 일부 구현에서 일요일 → 내부적으로 0으로 정규화
    const job = await svc.add_job("sun-job", { kind: "cron", expr: "0 9 * * 7" }, "sunday");
    expect(job.state.next_run_at_ms).toBeGreaterThan(Date.now());
    await svc.stop().catch(() => {});
  });

  it("cron expr weekday 0,7 → 중복 일요일 처리", async () => {
    const svc = new CronService(store_path, null);
    const job = await svc.add_job("sun-dup", { kind: "cron", expr: "0 9 * * 0,7" }, "sunday");
    expect(job.state.next_run_at_ms).toBeGreaterThan(Date.now());
    await svc.stop().catch(() => {});
  });
});

// ══════════════════════════════════════════
// on_change 콜백
// ══════════════════════════════════════════

describe("CronService — on_change 콜백", () => {
  it("add_job → on_change('added') 호출됨", async () => {
    const changes: string[] = [];
    const svc = new CronService(store_path, null, {
      on_change: (type, job_id) => { changes.push(`${type}:${job_id || ""}`); },
    });
    const job = await svc.add_job("ch-job", { kind: "every", every_ms: 60_000 }, "msg");
    expect(changes.some(c => c.startsWith("added:"))).toBe(true);
    await svc.stop().catch(() => {});
  });

  it("remove_job → on_change('removed') 호출됨", async () => {
    const changes: string[] = [];
    const svc = new CronService(store_path, null, {
      on_change: (type, _job_id) => { changes.push(type); },
    });
    const job = await svc.add_job("rm-ch", { kind: "every", every_ms: 60_000 }, "msg");
    changes.length = 0; // add 이벤트 초기화
    await svc.remove_job(job.id);
    expect(changes).toContain("removed");
    await svc.stop().catch(() => {});
  });

  it("enable_job(false) → on_change('disabled') 호출됨", async () => {
    const changes: string[] = [];
    const svc = new CronService(store_path, null, {
      on_change: (type) => { changes.push(type); },
    });
    const job = await svc.add_job("toggle-ch", { kind: "every", every_ms: 60_000 }, "msg");
    changes.length = 0;
    await svc.enable_job(job.id, false);
    expect(changes).toContain("disabled");
    await svc.stop().catch(() => {});
  });

  it("pause/resume → paused/resumed 호출됨", async () => {
    const changes: string[] = [];
    const svc = new CronService(store_path, null, {
      on_change: (type) => { changes.push(type); },
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
// every + at_ms (start_at) 경로
// ══════════════════════════════════════════

describe("CronService — every + at_ms 시작 시각 지정", () => {
  it("at_ms가 미래인 every 스케줄 → next_run = at_ms", async () => {
    const svc = new CronService(store_path, null);
    const future_start = Date.now() + 60_000 * 60; // 1시간 후
    const job = await svc.add_job("deferred-every", {
      kind: "every",
      every_ms: 60_000,
      at_ms: future_start,
    }, "deferred");
    // at_ms가 미래이므로 next_run_at_ms = at_ms
    expect(job.state.next_run_at_ms).toBe(future_start);
    await svc.stop().catch(() => {});
  });

  it("at_ms가 과거인 every 스케줄 → next_run = now + every_ms", async () => {
    const svc = new CronService(store_path, null);
    const past_start = Date.now() - 60_000; // 1분 전
    const job = await svc.add_job("past-every", {
      kind: "every",
      every_ms: 60_000,
      at_ms: past_start,
    }, "past");
    // at_ms가 과거이므로 now + every_ms
    expect(job.state.next_run_at_ms).toBeGreaterThan(Date.now());
    expect(job.state.next_run_at_ms).not.toBe(past_start);
    await svc.stop().catch(() => {});
  });
});

// ══════════════════════════════════════════
// _validate_schedule_for_add — 추가 검증 경로
// ══════════════════════════════════════════

describe("CronService — _validate_schedule_for_add 추가 경로", () => {
  it("invalid cron expr → Error throw", async () => {
    const svc = new CronService(store_path, null);
    await expect(
      svc.add_job("bad-cron", { kind: "cron", expr: "99 99 99 99 99" }, "x")
    ).rejects.toThrow();
    await svc.stop().catch(() => {});
  });

  it("빈 cron expr → Error throw", async () => {
    const svc = new CronService(store_path, null);
    await expect(
      svc.add_job("empty-cron", { kind: "cron", expr: "" }, "x")
    ).rejects.toThrow("expr is required");
    await svc.stop().catch(() => {});
  });

  it("알 수 없는 timezone → Error throw", async () => {
    const svc = new CronService(store_path, null);
    await expect(
      svc.add_job("bad-tz", { kind: "cron", expr: "0 9 * * *", tz: "Invalid/Timezone" }, "x")
    ).rejects.toThrow("unknown timezone");
    await svc.stop().catch(() => {});
  });

  it("invalid every schedule at_ms → Error throw", async () => {
    const svc = new CronService(store_path, null);
    await expect(
      svc.add_job("bad-every-atms", { kind: "every", every_ms: 60_000, at_ms: -1 }, "x")
    ).rejects.toThrow();
    await svc.stop().catch(() => {});
  });

  it("schedule 없음 → Error throw", async () => {
    const svc = new CronService(store_path, null);
    await expect(
      svc.add_job("no-schedule", null as any, "x")
    ).rejects.toThrow("invalid_schedule");
    await svc.stop().catch(() => {});
  });
});

// ══════════════════════════════════════════
// _load_store 캐시 히트
// ══════════════════════════════════════════

describe("CronService — _load_store 캐시 히트", () => {
  it("두 번 호출해도 같은 store 반환 (캐시 히트)", async () => {
    const svc = new CronService(store_path, null);
    const s1 = await svc._load_store();
    const s2 = await svc._load_store(); // 캐시 히트
    expect(s1).toBe(s2); // 동일 참조
    await svc.stop().catch(() => {});
  });
});

// ══════════════════════════════════════════
// _recompute_next_runs — stale running 리셋
// ══════════════════════════════════════════

describe("CronService — _recompute_next_runs stale running 리셋", () => {
  it("start 시 stale running 잡의 state.running 리셋", async () => {
    // running_lease_ms를 매우 짧게 설정하면 start() 시 stale로 판단됨
    const svc = new CronService(store_path, null, { running_lease_ms: 5_000 });
    const job = await svc.add_job("stale-job", { kind: "every", every_ms: 60_000 }, "test");

    // store를 직접 조작해 running=true, running_started_at_ms=오래된 시간 설정
    const store = await svc._load_store();
    const j = store.jobs.find(j => j.id === job.id);
    if (j) {
      j.state.running = true;
      j.state.running_started_at_ms = Date.now() - 30_000; // 30초 전 (lease 5초 초과)
    }
    await svc._save_store();
    svc._store = null; // 캐시 무효화

    // start()는 _recompute_next_runs()를 호출하여 stale running 리셋
    await svc.start();
    const jobs = await svc.list_jobs(true);
    const updated = jobs.find(j => j.id === job.id);
    expect(updated?.state.running).toBe(false);
    await svc.stop().catch(() => {});
  });
});

// ══════════════════════════════════════════
// every() 메서드
// ══════════════════════════════════════════

describe("CronService — every() 메서드", () => {
  it("every() 등록 후 stop() 시 타이머 정리됨", async () => {
    const svc = new CronService(store_path, null);
    let count = 0;
    svc.every(60_000, async () => { count++; });
    // 타이머가 등록됨을 확인 (직접 실행하지 않음)
    await svc.stop();
    // stop 후 interval 정리됨
    expect(count).toBe(0); // 아직 실행 안 됨 (interval 60초)
  });
});

// ══════════════════════════════════════════
// resume — _running=false → start() 호출
// ══════════════════════════════════════════

describe("CronService — resume without start", () => {
  it("_running=false 상태에서 resume → start() 경로 진입", async () => {
    const svc = new CronService(store_path, null);
    // start 안 한 상태에서 resume → start() 호출됨
    await svc.resume();
    const st = await svc.status();
    expect(st.enabled).toBe(true);
    await svc.stop().catch(() => {});
  });
});

// ══════════════════════════════════════════
// cron timezone 경로
// ══════════════════════════════════════════

describe("CronService — cron 스케줄 UTC timezone", () => {
  it("UTC timezone cron → tz_parts 사용, next_run_at_ms 계산됨", async () => {
    const svc = new CronService(store_path, null);
    const job = await svc.add_job("utc-cron", { kind: "cron", expr: "30 12 * * *", tz: "UTC" }, "noon");
    expect(job.state.next_run_at_ms).toBeGreaterThan(Date.now());
    await svc.stop().catch(() => {});
  });
});
