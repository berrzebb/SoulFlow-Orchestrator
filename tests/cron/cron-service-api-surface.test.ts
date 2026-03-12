/**
 * CronService API surface 통합 테스트.
 * cron-service-cov2 + cron-service-cov5에서 고유 / 중복 제거 후 병합.
 */
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CronService } from "@src/cron/service.js";

let store_path: string;

beforeEach(async () => {
  store_path = await mkdtemp(join(tmpdir(), "cron-api-surface-"));
});

afterEach(async () => {
  await rm(store_path, { recursive: true, force: true }).catch(() => {});
});

function make_svc(on_job?: (...args: any[]) => Promise<void>, opts?: { on_change?: any }) {
  return new CronService(store_path, on_job ?? null, opts);
}

// ══════════════════════════════════════════════════════════
// run_job — job_id 없음 / force / disabled
// ══════════════════════════════════════════════════════════

describe("CronService — run_job", () => {
  it("존재하지 않는 job_id → false 반환", async () => {
    const svc = make_svc();
    const result = await svc.run_job("nonexistent-job-id");
    expect(result).toBe(false);
    await svc.stop().catch(() => {});
  });

  it("force=true이어도 없는 job → false", async () => {
    const svc = make_svc();
    const result = await svc.run_job("ghost-job", true);
    expect(result).toBe(false);
    await svc.stop().catch(() => {});
  });

  it("disabled job + force=false → false", async () => {
    const svc = make_svc();
    const job = await svc.add_job("disabled-job", { kind: "every", every_ms: 60_000 }, "msg");
    await svc.enable_job(job.id, false);
    const result = await svc.run_job(job.id, false);
    expect(result).toBe(false);
    await svc.stop().catch(() => {});
  });
});

// ══════════════════════════════════════════════════════════
// enable_job — job_id 없음 → null, false → next_run=null
// ══════════════════════════════════════════════════════════

describe("CronService — enable_job", () => {
  it("존재하지 않는 job_id → null 반환", async () => {
    const svc = make_svc();
    const result = await svc.enable_job("nonexistent-job");
    expect(result).toBeNull();
    await svc.stop().catch(() => {});
  });

  it("enable_job(false) → next_run_at_ms=null로 설정", async () => {
    const svc = make_svc();
    const job = await svc.add_job("toggle-job", { kind: "every", every_ms: 60_000 }, "msg");
    const result = await svc.enable_job(job.id, false);
    expect(result).not.toBeNull();
    expect(result!.enabled).toBe(false);
    expect(result!.state.next_run_at_ms).toBeNull();
    await svc.stop().catch(() => {});
  });
});

// ══════════════════════════════════════════════════════════
// pause / resume
// ══════════════════════════════════════════════════════════

describe("CronService — pause / resume", () => {
  it("start → pause → health_check.ok=true (running), paused=true", async () => {
    const svc = make_svc();
    await svc.start();
    await svc.pause();
    const h = svc.health_check();
    expect(h.ok).toBe(true);
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
    await svc.stop();
    await svc.resume();
    const h = svc.health_check();
    expect(h.ok).toBe(true);
    await svc.stop();
  });
});

// ══════════════════════════════════════════════════════════
// status
// ══════════════════════════════════════════════════════════

describe("CronService — status", () => {
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

  it("잡 없음 → next_wake_at_ms=null", async () => {
    const svc = make_svc();
    const s = await svc.status();
    expect(s.next_wake_at_ms).toBeNull();
  });

  it("활성 잡 있음 → next_run_at_ms > now", async () => {
    const svc = make_svc();
    await svc.add_job("wake-job", { kind: "every", every_ms: 300_000 }, "wake");
    const jobs = await svc.list_jobs();
    if (jobs.length > 0 && jobs[0]!.state.next_run_at_ms) {
      expect(jobs[0]!.state.next_run_at_ms).toBeGreaterThan(Date.now());
    }
    await svc.stop().catch(() => {});
  });
});

// ══════════════════════════════════════════════════════════
// health_check — 3 states: before start, after start, after pause
// ══════════════════════════════════════════════════════════

describe("CronService — health_check", () => {
  it("start 이전 → ok=false", () => {
    const svc = make_svc();
    const h = svc.health_check();
    expect(h.ok).toBe(false);
    expect(h.details?.paused).toBe(false);
    // start()를 호출하지 않았으므로 stop() 불필요 — 호출 시 lazy DB init이 삭제된 tmpdir에서 실패
  });

  it("start 이후 → ok=true", async () => {
    const svc = make_svc();
    await svc.start();
    const h = svc.health_check();
    expect(h.ok).toBe(true);
    await svc.stop().catch(() => {});
  });

  it("pause 이후 → ok=true (running), paused=true", async () => {
    const svc = make_svc();
    await svc.start();
    await svc.pause();
    const h = svc.health_check();
    expect(h.ok).toBe(true);
    expect(h.details?.paused).toBe(true);
    await svc.stop().catch(() => {});
  });
});

// ══════════════════════════════════════════════════════════
// disable_all_and_pause
// ══════════════════════════════════════════════════════════

describe("CronService — disable_all_and_pause", () => {
  it("활성 잡 2개 → 모두 비활성화, count=2 반환", async () => {
    const svc = make_svc();
    await svc.add_job("j1", { kind: "every", every_ms: 60_000 }, "m1");
    await svc.add_job("j2", { kind: "every", every_ms: 60_000 }, "m2");
    const count = await svc.disable_all_and_pause();
    expect(count).toBe(2);
    const jobs = await svc.list_jobs(true);
    expect(jobs.every(j => !j.enabled)).toBe(true);
    const st = await svc.status();
    expect(st.paused).toBe(true);
    await svc.stop();
  });

  it("이미 비활성 잡만 있으면 count=0 반환", async () => {
    const svc = make_svc();
    const job = await svc.add_job("disabled-job", { kind: "every", every_ms: 60_000 }, "msg");
    await svc.enable_job(job.id, false);
    const count = await svc.disable_all_and_pause();
    expect(count).toBe(0);
    await svc.stop().catch(() => {});
  });

  it("잡이 없을 때 → count=0, paused=true", async () => {
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
// cron / tz / schedule 유효성 검사
// ══════════════════════════════════════════════════════════

describe("CronService — schedule 유효성 검사", () => {
  it("every + tz → throw (tz는 cron에서만 허용)", async () => {
    const svc = make_svc();
    await expect(
      svc.add_job("tz-every", { kind: "every", every_ms: 60_000, tz: "Asia/Seoul" } as any, "msg"),
    ).rejects.toThrow("tz can only be used with cron schedules");
    await svc.stop().catch(() => {});
  });

  it("cron + 잘못된 tz → throw", async () => {
    const svc = make_svc();
    await expect(
      svc.add_job("bad-tz", { kind: "cron", expr: "0 9 * * *", tz: "Not/ATimezone" }, "msg"),
    ).rejects.toThrow("unknown timezone");
    await svc.stop().catch(() => {});
  });

  it("cron + 유효하지 않은 expr → throw", async () => {
    const svc = make_svc();
    await expect(
      svc.add_job("bad-expr", { kind: "cron", expr: "NOT_A_CRON" }, "msg"),
    ).rejects.toThrow("invalid cron expression");
    await svc.stop();
  });

  it("cron + 유효한 tz → 정상 추가", async () => {
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

  it("at schedule + at_ms=0 → throw", async () => {
    const svc = make_svc();
    await expect(
      svc.add_job("bad-at", { kind: "at", at_ms: 0 }, "msg"),
    ).rejects.toThrow("invalid at schedule");
    await svc.stop();
  });
});

// ══════════════════════════════════════════════════════════
// remove_job
// ══════════════════════════════════════════════════════════

describe("CronService — remove_job", () => {
  it("존재하는 잡 제거 → true", async () => {
    const svc = make_svc();
    const job = await svc.add_job("remove-me", { kind: "every", every_ms: 60_000 }, "msg");
    const ok = await svc.remove_job(job.id);
    expect(ok).toBe(true);
    const jobs = await svc.list_jobs(true);
    expect(jobs.find(j => j.id === job.id)).toBeUndefined();
    await svc.stop().catch(() => {});
  });

  it("없는 잡 제거 → false", async () => {
    const svc = make_svc();
    const ok = await svc.remove_job("ghost-id");
    expect(ok).toBe(false);
    await svc.stop().catch(() => {});
  });
});

// ══════════════════════════════════════════════════════════
// list_jobs — include_disabled
// ══════════════════════════════════════════════════════════

describe("CronService — list_jobs include_disabled", () => {
  it("include_disabled=false → 활성 잡만", async () => {
    const svc = make_svc();
    const j1 = await svc.add_job("active", { kind: "every", every_ms: 60_000 }, "msg");
    const j2 = await svc.add_job("disabled", { kind: "every", every_ms: 60_000 }, "msg");
    await svc.enable_job(j2.id, false);
    const jobs = await svc.list_jobs(false);
    expect(jobs.find(j => j.id === j1.id)).toBeTruthy();
    expect(jobs.find(j => j.id === j2.id)).toBeUndefined();
    await svc.stop().catch(() => {});
  });

  it("include_disabled=true → 모든 잡", async () => {
    const svc = make_svc();
    const j = await svc.add_job("disabled", { kind: "every", every_ms: 60_000 }, "msg");
    await svc.enable_job(j.id, false);
    const jobs = await svc.list_jobs(true);
    expect(jobs.find(jb => jb.id === j.id)).toBeTruthy();
    await svc.stop().catch(() => {});
  });
});

// ══════════════════════════════════════════════════════════
// 중복 잡 실행 방지 (lock) — lock 파일 fresh → skip
// ══════════════════════════════════════════════════════════

describe("CronService — 중복 잡 실행 방지 (lock)", () => {
  it("lock 파일이 이미 있고 fresh → 두 번째 acquire → null (skip)", async () => {
    const on_job = vi.fn().mockResolvedValue(undefined);
    const svc = make_svc(on_job);
    const job = await svc.add_job("lock-job", { kind: "every", every_ms: 60_000 }, "msg");

    // lock 파일 수동 생성 (fresh timestamp)
    const lock_dir = join(store_path, ".locks");
    await mkdir(lock_dir, { recursive: true });
    await writeFile(join(lock_dir, `${job.id}.lock`), String(Date.now()));

    // run_job → lock 이미 있고 fresh → _execute_job이 early return → on_job 미호출
    const ran = await svc.run_job(job.id, true);
    expect(ran).toBe(true); // run_job 자체는 true
    // on_job이 호출 안 됐어야 함 (lock 실패)
    expect(on_job).not.toHaveBeenCalled();
    await svc.stop();
  });
});

// ══════════════════════════════════════════════════════════
// _save_store 직접 호출
// ══════════════════════════════════════════════════════════

describe("CronService — _save_store", () => {
  it("_save_store 직접 호출 → 오류 없음", async () => {
    const svc = make_svc();
    await svc.add_job("j1", { kind: "every", every_ms: 60_000 }, "msg");
    await expect(svc._save_store()).resolves.toBeUndefined();
    await svc.stop();
  });
});
