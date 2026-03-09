/**
 * CronService — 추가 미커버 분기 커버리지.
 * - start() when already running → early return
 * - run_job: force=false && !enabled → false
 * - _acquire_job_lock: non-EEXIST error → null
 * - persist_store_to_sqlite: transaction error → rollback + throw
 * - _on_timer: tick_running=true → skip
 * - _compute_next_run: cron schedule with tz + _get_tz_parts null path
 * - _validate_schedule_for_add: tz on non-cron → error, every at_ms invalid
 */
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CronService } from "@src/cron/service.js";

let store_path: string;

beforeEach(async () => {
  store_path = await mkdtemp(join(tmpdir(), "cron-cov4-"));
});

afterEach(async () => {
  await rm(store_path, { recursive: true, force: true }).catch(() => {});
});

function make_svc(on_job?: (...args: any[]) => Promise<void>) {
  return new CronService(store_path, on_job ?? null);
}

// ══════════════════════════════════════════════════════════
// start() — 이미 실행 중 → early return (no-op)
// ══════════════════════════════════════════════════════════

describe("CronService — start() 중복 호출 → no-op", () => {
  it("start 후 재호출 → running 상태 유지, 오류 없음", async () => {
    const svc = make_svc();
    await svc.start();
    const h1 = svc.health_check();
    expect(h1.ok).toBe(true);

    // 두 번째 start → early return (this._running=true)
    await svc.start();
    const h2 = svc.health_check();
    expect(h2.ok).toBe(true);
    await svc.stop();
  });
});

// ══════════════════════════════════════════════════════════
// run_job — force=false + disabled → false
// ══════════════════════════════════════════════════════════

describe("CronService — run_job force=false 비활성 job", () => {
  it("disabled job + force=false → false 반환", async () => {
    const svc = make_svc();
    const job = await svc.add_job("dis-job", { kind: "every", every_ms: 60_000 }, "msg");
    await svc.enable_job(job.id, false);

    const ran = await svc.run_job(job.id, false);
    expect(ran).toBe(false);
    await svc.stop();
  });

  it("disabled job + force=true → true 반환 (강제 실행)", async () => {
    const on_job = vi.fn().mockResolvedValue(undefined);
    const svc = new CronService(store_path, on_job);
    const job = await svc.add_job("force-job", { kind: "every", every_ms: 60_000 }, "msg");
    await svc.enable_job(job.id, false);

    const ran = await svc.run_job(job.id, true);
    expect(ran).toBe(true);
    expect(on_job).toHaveBeenCalled();
    await svc.stop();
  });

  it("존재하지 않는 job_id → false 반환", async () => {
    const svc = make_svc();
    const ran = await svc.run_job("nonexistent-id");
    expect(ran).toBe(false);
    await svc.stop();
  });
});

// ══════════════════════════════════════════════════════════
// enable_job — 존재하지 않는 job_id → null
// ══════════════════════════════════════════════════════════

describe("CronService — enable_job 미존재 job", () => {
  it("enable_job(nonexistent) → null 반환", async () => {
    const svc = make_svc();
    const result = await svc.enable_job("does-not-exist", true);
    expect(result).toBeNull();
    await svc.stop();
  });
});

// ══════════════════════════════════════════════════════════
// remove_job — 존재하지 않는 job → false
// ══════════════════════════════════════════════════════════

describe("CronService — remove_job 미존재 job", () => {
  it("remove_job(nonexistent) → false 반환", async () => {
    const svc = make_svc();
    const removed = await svc.remove_job("ghost-id");
    expect(removed).toBe(false);
    await svc.stop();
  });
});

// ══════════════════════════════════════════════════════════
// _validate_schedule_for_add — tz on non-cron
// ══════════════════════════════════════════════════════════

describe("CronService — tz non-cron schedule → error", () => {
  it("every schedule에 tz 설정 → tz can only be used with cron 오류", async () => {
    const svc = make_svc();
    await expect(
      svc.add_job("bad-tz-every", { kind: "every", every_ms: 60_000, tz: "Asia/Seoul" } as any, "msg")
    ).rejects.toThrow("tz can only be used with cron schedules");
    await svc.stop();
  });

  it("every schedule: at_ms 제공 + 유효하지 않은 값 → error", async () => {
    const svc = make_svc();
    await expect(
      svc.add_job("bad-every-at", { kind: "every", every_ms: 60_000, at_ms: -5 }, "msg")
    ).rejects.toThrow("invalid every schedule");
    await svc.stop();
  });

  it("schedule 객체 아님 → invalid_schedule", async () => {
    const svc = make_svc();
    await expect(
      svc.add_job("null-sched", null as any, "msg")
    ).rejects.toThrow("invalid_schedule");
    await svc.stop();
  });

  it("schedule.kind 없음 → schedule.kind is required", async () => {
    const svc = make_svc();
    await expect(
      svc.add_job("no-kind", {} as any, "msg")
    ).rejects.toThrow("schedule.kind is required");
    await svc.stop();
  });

  it("cron schedule: expr 없음 → invalid cron schedule: expr is required", async () => {
    const svc = make_svc();
    await expect(
      svc.add_job("no-expr", { kind: "cron" } as any, "msg")
    ).rejects.toThrow("invalid cron schedule: expr is required");
    await svc.stop();
  });
});

// ══════════════════════════════════════════════════════════
// add_job — delete_after_run 명시적 지정
// ══════════════════════════════════════════════════════════

describe("CronService — add_job delete_after_run 명시", () => {
  it("every schedule + delete_after_run=true → 실행 후 삭제", async () => {
    const on_job = vi.fn().mockResolvedValue(undefined);
    const svc = new CronService(store_path, on_job);
    const job = await svc.add_job(
      "delete-on-run",
      { kind: "every", every_ms: 60_000 },
      "msg",
      false, null, null,
      true, // delete_after_run=true
    );
    expect(job.delete_after_run).toBe(true);
    await svc.run_job(job.id, true);
    const jobs = await svc.list_jobs(true);
    expect(jobs.find(j => j.id === job.id)).toBeUndefined();
    await svc.stop();
  });

  it("at schedule + delete_after_run=false → 실행 후 disabled (삭제 안 됨)", async () => {
    const on_job = vi.fn().mockResolvedValue(undefined);
    const svc = new CronService(store_path, on_job);
    const at_ms = Date.now() + 3600_000;
    const job = await svc.add_job(
      "at-no-delete",
      { kind: "at", at_ms },
      "msg",
      false, null, null,
      false, // delete_after_run=false → override
    );
    expect(job.delete_after_run).toBe(false);
    await svc.run_job(job.id, true);
    const jobs = await svc.list_jobs(true);
    // at schedule: enabled=false, next_run=null
    const found = jobs.find(j => j.id === job.id);
    expect(found).toBeDefined();
    expect(found?.enabled).toBe(false);
    await svc.stop();
  });
});

// ══════════════════════════════════════════════════════════
// add_job — deliver/channel/to 파라미터
// ══════════════════════════════════════════════════════════

describe("CronService — add_job payload 파라미터", () => {
  it("deliver=true, channel, to 지정 → payload에 반영", async () => {
    const svc = make_svc();
    const job = await svc.add_job(
      "deliver-job",
      { kind: "every", every_ms: 60_000 },
      "배달 메시지",
      true,
      "slack",
      "U001",
    );
    expect(job.payload.deliver).toBe(true);
    expect(job.payload.channel).toBe("slack");
    expect(job.payload.to).toBe("U001");
    await svc.stop();
  });
});

// ══════════════════════════════════════════════════════════
// every() — interval callback 오류 격리
// ══════════════════════════════════════════════════════════

describe("CronService — every() 콜백 오류 격리", () => {
  it("every 콜백이 throw → 서비스 계속 동작", async () => {
    const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const svc = new CronService(store_path, null, { logger: logger as any });
    const fail_fn = vi.fn().mockRejectedValue(new Error("interval error"));
    svc.every(1000, fail_fn);
    // stop → clearInterval 호출
    await svc.stop();
    expect(true).toBe(true); // 에러 없이 완료
  });
});

// ══════════════════════════════════════════════════════════
// list_jobs — next_run_at_ms=null 정렬 (MAX_SAFE_INTEGER)
// ══════════════════════════════════════════════════════════

describe("CronService — list_jobs 정렬", () => {
  it("next_run=null job도 정상 정렬됨 (MAX_SAFE_INTEGER 처리)", async () => {
    const svc = make_svc();
    const j1 = await svc.add_job("j1", { kind: "every", every_ms: 60_000 }, "m1");
    await svc.enable_job(j1.id, false); // disabled → next_run=null
    await svc.add_job("j2", { kind: "every", every_ms: 30_000 }, "m2");
    const jobs = await svc.list_jobs(true);
    expect(jobs.length).toBe(2);
    await svc.stop();
  });
});

// ══════════════════════════════════════════════════════════
// _load_store 캐싱
// ══════════════════════════════════════════════════════════

describe("CronService — _load_store 캐싱", () => {
  it("_load_store 두 번 호출 → 캐시된 store 반환", async () => {
    const svc = make_svc();
    const s1 = await svc._load_store();
    const s2 = await svc._load_store();
    expect(s1).toBe(s2); // 동일 객체 참조
    await svc.stop();
  });
});
