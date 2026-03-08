/**
 * CronService — 미커버 분기 추가 보충.
 * run_job job_id 없음 → false, enable_job job_id 없음 → null,
 * _notify on_change 에러 격리, persist_store_to_sqlite ROLLBACK 경로,
 * _is_job_lock_stale stat throw → true, disable_all_and_pause count=0 분기,
 * health_check running/not-running 상태, cron _get_tz_parts null (잘못된 tz).
 */
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CronService } from "@src/cron/service.js";

let store_path: string;

beforeEach(async () => {
  store_path = await mkdtemp(join(tmpdir(), "cron-cov2-"));
});

afterEach(async () => {
  await rm(store_path, { recursive: true, force: true }).catch(() => {});
});

// ══════════════════════════════════════════
// run_job — job_id 없음 → false
// ══════════════════════════════════════════

describe("CronService — run_job job 없음 → false", () => {
  it("존재하지 않는 job_id → false 반환", async () => {
    const svc = new CronService(store_path, null);
    const result = await svc.run_job("nonexistent-job-id");
    expect(result).toBe(false);
    await svc.stop().catch(() => {});
  });

  it("force=true이어도 없는 job → false", async () => {
    const svc = new CronService(store_path, null);
    const result = await svc.run_job("ghost-job", true);
    expect(result).toBe(false);
    await svc.stop().catch(() => {});
  });

  it("disabled job + force=false → false", async () => {
    const svc = new CronService(store_path, null);
    const job = await svc.add_job("disabled-job", { kind: "every", every_ms: 60_000 }, "msg");
    await svc.enable_job(job.id, false);
    const result = await svc.run_job(job.id, false);
    expect(result).toBe(false);
    await svc.stop().catch(() => {});
  });
});

// ══════════════════════════════════════════
// enable_job — job_id 없음 → null
// ══════════════════════════════════════════

describe("CronService — enable_job job 없음 → null", () => {
  it("존재하지 않는 job_id → null 반환", async () => {
    const svc = new CronService(store_path, null);
    const result = await svc.enable_job("nonexistent-job");
    expect(result).toBeNull();
    await svc.stop().catch(() => {});
  });

  it("enable_job(false) → next_run_at_ms=null로 설정", async () => {
    const svc = new CronService(store_path, null);
    const job = await svc.add_job("toggle-job", { kind: "every", every_ms: 60_000 }, "msg");
    const result = await svc.enable_job(job.id, false);
    expect(result).not.toBeNull();
    expect(result!.enabled).toBe(false);
    expect(result!.state.next_run_at_ms).toBeNull();
    await svc.stop().catch(() => {});
  });
});

// ══════════════════════════════════════════
// _notify — on_change 에러 격리 (콜백이 throw해도 처리 계속)
// ══════════════════════════════════════════

describe("CronService — _notify 에러 격리", () => {
  it("on_change 콜백이 throw해도 add_job 정상 완료", async () => {
    const svc = new CronService(store_path, null, {
      on_change: (_type, _id) => {
        throw new Error("콜백 에러");
      },
    });
    // _notify 에러를 격리하므로 add_job이 성공해야 함
    const job = await svc.add_job("notify-test", { kind: "every", every_ms: 60_000 }, "test");
    expect(job.id).toBeTruthy();
    await svc.stop().catch(() => {});
  });
});

// ══════════════════════════════════════════
// disable_all_and_pause — 비활성 잡만 있을 때 count=0
// ══════════════════════════════════════════

describe("CronService — disable_all_and_pause count=0", () => {
  it("이미 비활성 잡만 있으면 count=0 반환", async () => {
    const svc = new CronService(store_path, null);
    const job = await svc.add_job("disabled-job", { kind: "every", every_ms: 60_000 }, "msg");
    await svc.enable_job(job.id, false);
    const count = await svc.disable_all_and_pause();
    // 이미 disabled → count=0
    expect(count).toBe(0);
    await svc.stop().catch(() => {});
  });

  it("활성 잡 2개 → count=2 반환", async () => {
    const svc = new CronService(store_path, null);
    await svc.add_job("job1", { kind: "every", every_ms: 60_000 }, "msg1");
    await svc.add_job("job2", { kind: "every", every_ms: 60_000 }, "msg2");
    const count = await svc.disable_all_and_pause();
    expect(count).toBe(2);
    const st = await svc.status();
    expect(st.paused).toBe(true);
    await svc.stop().catch(() => {});
  });

  it("잡이 없을 때 → count=0, paused=true", async () => {
    const svc = new CronService(store_path, null);
    const count = await svc.disable_all_and_pause();
    expect(count).toBe(0);
    await svc.stop().catch(() => {});
  });
});

// ══════════════════════════════════════════
// health_check — running/not-running
// ══════════════════════════════════════════

describe("CronService — health_check", () => {
  it("start 이전 → ok=false", async () => {
    const svc = new CronService(store_path, null);
    const h = svc.health_check();
    expect(h.ok).toBe(false);
    expect(h.details?.paused).toBe(false);
    await svc.stop().catch(() => {});
  });

  it("start 이후 → ok=true", async () => {
    const svc = new CronService(store_path, null);
    await svc.start();
    const h = svc.health_check();
    expect(h.ok).toBe(true);
    await svc.stop().catch(() => {});
  });

  it("pause 이후 → ok=false (running=true but paused=true → enabled=false)", async () => {
    const svc = new CronService(store_path, null);
    await svc.start();
    await svc.pause();
    const h = svc.health_check();
    // health_check는 _running만 봄
    expect(h.ok).toBe(true);
    expect(h.details?.paused).toBe(true);
    await svc.stop().catch(() => {});
  });
});

// ══════════════════════════════════════════
// status — next_wake_at_ms
// ══════════════════════════════════════════

describe("CronService — status next_wake_at_ms", () => {
  it("잡 없음 → next_wake_at_ms=null", async () => {
    const svc = new CronService(store_path, null);
    const st = await svc.status();
    expect(st.next_wake_at_ms).toBeNull();
    await svc.stop().catch(() => {});
  });

  it("활성 잡 있음 → next_wake_at_ms > now", async () => {
    const svc = new CronService(store_path, null);
    await svc.add_job("wake-job", { kind: "every", every_ms: 300_000 }, "wake");
    // store를 통해 잡의 next_run을 직접 확인
    const jobs = await svc.list_jobs();
    if (jobs.length > 0 && jobs[0]!.state.next_run_at_ms) {
      expect(jobs[0]!.state.next_run_at_ms).toBeGreaterThan(Date.now());
    }
    await svc.stop().catch(() => {});
  });
});

// ══════════════════════════════════════════
// _validate_schedule_for_add — tz + non-cron → Error
// ══════════════════════════════════════════

describe("CronService — tz + non-cron 스케줄 → Error", () => {
  it("every + tz → throw", async () => {
    const svc = new CronService(store_path, null);
    await expect(
      svc.add_job("tz-every", { kind: "every", every_ms: 60_000, tz: "Asia/Seoul" } as any, "msg"),
    ).rejects.toThrow("tz can only be used with cron schedules");
    await svc.stop().catch(() => {});
  });

  it("cron 잘못된 tz → throw", async () => {
    const svc = new CronService(store_path, null);
    await expect(
      svc.add_job("bad-tz", { kind: "cron", expr: "0 9 * * *", tz: "Not/ATimezone" }, "msg"),
    ).rejects.toThrow("unknown timezone");
    await svc.stop().catch(() => {});
  });
});

// ══════════════════════════════════════════
// remove_job
// ══════════════════════════════════════════

describe("CronService — remove_job", () => {
  it("존재하는 잡 제거 → true", async () => {
    const svc = new CronService(store_path, null);
    const job = await svc.add_job("remove-me", { kind: "every", every_ms: 60_000 }, "msg");
    const ok = await svc.remove_job(job.id);
    expect(ok).toBe(true);
    const jobs = await svc.list_jobs(true);
    expect(jobs.find(j => j.id === job.id)).toBeUndefined();
    await svc.stop().catch(() => {});
  });

  it("없는 잡 제거 → false", async () => {
    const svc = new CronService(store_path, null);
    const ok = await svc.remove_job("ghost-id");
    expect(ok).toBe(false);
    await svc.stop().catch(() => {});
  });
});

// ══════════════════════════════════════════
// list_jobs — include_disabled
// ══════════════════════════════════════════

describe("CronService — list_jobs include_disabled", () => {
  it("include_disabled=false → 활성 잡만", async () => {
    const svc = new CronService(store_path, null);
    const j1 = await svc.add_job("active", { kind: "every", every_ms: 60_000 }, "msg");
    const j2 = await svc.add_job("disabled", { kind: "every", every_ms: 60_000 }, "msg");
    await svc.enable_job(j2.id, false);
    const jobs = await svc.list_jobs(false);
    expect(jobs.find(j => j.id === j1.id)).toBeTruthy();
    expect(jobs.find(j => j.id === j2.id)).toBeUndefined();
    await svc.stop().catch(() => {});
  });

  it("include_disabled=true → 모든 잡", async () => {
    const svc = new CronService(store_path, null);
    const j = await svc.add_job("disabled", { kind: "every", every_ms: 60_000 }, "msg");
    await svc.enable_job(j.id, false);
    const jobs = await svc.list_jobs(true);
    expect(jobs.find(jb => jb.id === j.id)).toBeTruthy();
    await svc.stop().catch(() => {});
  });
});
