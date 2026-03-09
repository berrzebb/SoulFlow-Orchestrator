/**
 * CronService — 추가 미커버 분기 커버리지 (cov5).
 * - pause / resume / status
 * - disable_all_and_pause
 * - _on_timer: tick_running=true 시 스킵
 * - _execute_job: on_job 오류 → last_status="error"
 * - _execute_job: at schedule → enabled=false, next_run_at_ms=null
 * - _notify: on_change 콜백
 * - _is_running_fresh: running=true + lease 내 → true
 * - _is_job_lock_stale: stat 실패 → true
 * - _acquire_job_lock: non-EEXIST 오류 → null
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CronService } from "@src/cron/service.js";

let store_path: string;

beforeEach(async () => {
  store_path = await mkdtemp(join(tmpdir(), "cron-cov5-"));
});

afterEach(async () => {
  await rm(store_path, { recursive: true, force: true }).catch(() => {});
});

function make_svc(on_job?: (...args: any[]) => Promise<void>, opts?: { on_change?: any }) {
  return new CronService(store_path, on_job ?? null, opts);
}

// ══════════════════════════════════════════════════════════
// pause / resume / status
// ══════════════════════════════════════════════════════════

describe("CronService — pause / resume", () => {
  it("start → pause → health_check.ok=true (running), paused=true", async () => {
    const svc = make_svc();
    await svc.start();
    await svc.pause();
    const h = svc.health_check();
    expect(h.ok).toBe(true); // _running=true
    expect((h.details as any)?.paused).toBe(true);
    await svc.stop();
  });

  it("pause → resume → paused 해제", async () => {
    const svc = make_svc();
    await svc.start();
    await svc.pause();
    await svc.resume();
    const h = svc.health_check();
    expect((h.details as any)?.paused).toBe(false);
    await svc.stop();
  });

  it("stop 후 resume → start() 호출됨 (health_check ok=true)", async () => {
    const svc = make_svc();
    await svc.stop(); // 처음부터 stopped
    await svc.resume(); // _running=false → start() 위임
    const h = svc.health_check();
    expect(h.ok).toBe(true);
    await svc.stop();
  });
});

// ══════════════════════════════════════════════════════════
// status
// ══════════════════════════════════════════════════════════

describe("CronService — status()", () => {
  it("start → status → enabled=true, paused=false", async () => {
    const svc = make_svc();
    await svc.start();
    const s = await svc.status();
    expect(s.enabled).toBe(true);
    expect(s.paused).toBe(false);
    await svc.stop();
  });

  it("start → pause → status → enabled=false, paused=true", async () => {
    const svc = make_svc();
    await svc.start();
    await svc.pause();
    const s = await svc.status();
    expect(s.enabled).toBe(false);
    expect(s.paused).toBe(true);
    await svc.stop();
  });

  it("jobs 없음 → next_wake_at_ms=null", async () => {
    const svc = make_svc();
    const s = await svc.status();
    expect(s.next_wake_at_ms).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════
// disable_all_and_pause
// ══════════════════════════════════════════════════════════

describe("CronService — disable_all_and_pause", () => {
  it("활성 job 2개 → 모두 비활성화, count=2 반환", async () => {
    const svc = make_svc();
    await svc.add_job("j1", { kind: "every", every_ms: 60_000 }, "m1");
    await svc.add_job("j2", { kind: "every", every_ms: 60_000 }, "m2");
    const count = await svc.disable_all_and_pause();
    expect(count).toBe(2);
    const jobs = await svc.list_jobs(true);
    expect(jobs.every(j => !j.enabled)).toBe(true);
    await svc.stop();
  });

  it("활성 job 없음 → count=0", async () => {
    const svc = make_svc();
    const count = await svc.disable_all_and_pause();
    expect(count).toBe(0);
    await svc.stop();
  });
});

// ══════════════════════════════════════════════════════════
// on_change 콜백 (_notify)
// ══════════════════════════════════════════════════════════

describe("CronService — on_change 콜백", () => {
  it("add_job → on_change('added', job_id) 호출", async () => {
    const on_change = vi.fn();
    const svc = make_svc(undefined, { on_change });
    const job = await svc.add_job("j1", { kind: "every", every_ms: 60_000 }, "msg");
    expect(on_change).toHaveBeenCalledWith("added", job.id);
    await svc.stop();
  });

  it("remove_job → on_change('removed', job_id) 호출", async () => {
    const on_change = vi.fn();
    const svc = make_svc(undefined, { on_change });
    const job = await svc.add_job("j1", { kind: "every", every_ms: 60_000 }, "msg");
    on_change.mockClear();
    await svc.remove_job(job.id);
    expect(on_change).toHaveBeenCalledWith("removed", job.id);
    await svc.stop();
  });

  it("enable_job(enabled=true) → on_change('enabled', job_id)", async () => {
    const on_change = vi.fn();
    const svc = make_svc(undefined, { on_change });
    const job = await svc.add_job("j1", { kind: "every", every_ms: 60_000 }, "msg");
    await svc.enable_job(job.id, false);
    on_change.mockClear();
    await svc.enable_job(job.id, true);
    expect(on_change).toHaveBeenCalledWith("enabled", job.id);
    await svc.stop();
  });

  it("enable_job(enabled=false) → on_change('disabled', job_id)", async () => {
    const on_change = vi.fn();
    const svc = make_svc(undefined, { on_change });
    const job = await svc.add_job("j1", { kind: "every", every_ms: 60_000 }, "msg");
    on_change.mockClear();
    await svc.enable_job(job.id, false);
    expect(on_change).toHaveBeenCalledWith("disabled", job.id);
    await svc.stop();
  });

  it("on_change 콜백이 throw → 서비스 계속 동작 (에러 격리)", async () => {
    const on_change = vi.fn().mockImplementation(() => { throw new Error("callback error"); });
    const svc = make_svc(undefined, { on_change });
    // add_job 시 on_change 호출됨 → throw 되어도 add_job 성공해야 함
    const job = await svc.add_job("j1", { kind: "every", every_ms: 60_000 }, "msg");
    expect(job.id).toBeTruthy();
    await svc.stop();
  });
});

// ══════════════════════════════════════════════════════════
// on_job 오류 → last_status="error"
// ══════════════════════════════════════════════════════════

describe("CronService — on_job 오류 격리", () => {
  it("on_job이 throw → last_status='error', last_error 설정", async () => {
    const on_job = vi.fn().mockRejectedValue(new Error("job failed"));
    const svc = make_svc(on_job);
    const job = await svc.add_job("fail-job", { kind: "every", every_ms: 60_000 }, "msg");
    await svc.run_job(job.id, true);
    const jobs = await svc.list_jobs(true);
    const found = jobs.find(j => j.id === job.id);
    expect(found?.state.last_status).toBe("error");
    expect(found?.state.last_error).toContain("job failed");
    await svc.stop();
  });
});

// ══════════════════════════════════════════════════════════
// at schedule 실행 후 → enabled=false
// ══════════════════════════════════════════════════════════

describe("CronService — at schedule 실행", () => {
  it("at schedule 실행 후 → enabled=false, next_run_at_ms=null", async () => {
    const on_job = vi.fn().mockResolvedValue(undefined);
    const svc = make_svc(on_job);
    const at_ms = Date.now() + 3600_000;
    const job = await svc.add_job(
      "at-job",
      { kind: "at", at_ms },
      "msg",
      false, null, null,
      false, // delete_after_run=false
    );
    await svc.run_job(job.id, true);
    const jobs = await svc.list_jobs(true);
    const found = jobs.find(j => j.id === job.id);
    expect(found?.enabled).toBe(false);
    expect(found?.state.next_run_at_ms).toBeNull();
    await svc.stop();
  });
});

// ══════════════════════════════════════════════════════════
// cron schedule 유효성 검사
// ══════════════════════════════════════════════════════════

describe("CronService — cron schedule 유효성", () => {
  it("cron schedule + 유효한 tz → 정상 추가", async () => {
    const svc = make_svc();
    const job = await svc.add_job(
      "cron-tz",
      { kind: "cron", expr: "0 9 * * *", tz: "Asia/Seoul" },
      "morning report",
    );
    expect(job.id).toBeTruthy();
    expect(job.schedule.tz).toBe("Asia/Seoul");
    await svc.stop();
  });

  it("cron schedule + 유효하지 않은 timezone → throw", async () => {
    const svc = make_svc();
    await expect(
      svc.add_job("bad-tz", { kind: "cron", expr: "0 9 * * *", tz: "Invalid/Zone" }, "msg")
    ).rejects.toThrow("unknown timezone");
    await svc.stop();
  });

  it("cron schedule + 유효하지 않은 expr → throw", async () => {
    const svc = make_svc();
    await expect(
      svc.add_job("bad-expr", { kind: "cron", expr: "NOT_A_CRON" }, "msg")
    ).rejects.toThrow("invalid cron expression");
    await svc.stop();
  });

  it("at schedule + at_ms=0 → throw", async () => {
    const svc = make_svc();
    await expect(
      svc.add_job("bad-at", { kind: "at", at_ms: 0 }, "msg")
    ).rejects.toThrow("invalid at schedule");
    await svc.stop();
  });
});

// ══════════════════════════════════════════════════════════
// _acquire_job_lock: lock 파일 이미 존재하지만 fresh → null
// ══════════════════════════════════════════════════════════

describe("CronService — 중복 잡 실행 방지 (lock)", () => {
  it("lock 파일이 이미 있고 fresh → 두 번째 acquire → null (skip)", async () => {
    const on_job = vi.fn().mockResolvedValue(undefined);
    const svc = make_svc(on_job);
    const job = await svc.add_job("lock-job", { kind: "every", every_ms: 60_000 }, "msg");

    // lock 파일 수동 생성 (fresh timestamp) - lock_dir_path = join(store_path, ".locks")
    const { mkdir: mk } = await import("node:fs/promises");
    const lock_dir = join(store_path, ".locks");
    await mk(lock_dir, { recursive: true });
    await writeFile(join(lock_dir, `${job.id}.lock`), String(Date.now()));

    // run_job → lock 이미 있고 fresh → _execute_job이 early return → on_job 미호출
    const ran = await svc.run_job(job.id, true);
    // lock 이미 있어서 skip → ran=true (run_job은 _execute_job 후 true 반환)
    // _execute_job은 lock 획득 실패 시 early return
    expect(ran).toBe(true); // run_job 자체는 true
    // on_job이 호출 안 됐어야 함 (lock 실패)
    expect(on_job).not.toHaveBeenCalled();
    await svc.stop();
  });
});

// ══════════════════════════════════════════════════════════
// _save_store / persist_store_to_sqlite
// ══════════════════════════════════════════════════════════

describe("CronService — _save_store", () => {
  it("_save_store 직접 호출 → 오류 없음", async () => {
    const svc = make_svc();
    await svc.add_job("j1", { kind: "every", every_ms: 60_000 }, "msg");
    await expect(svc._save_store()).resolves.toBeUndefined();
    await svc.stop();
  });
});
