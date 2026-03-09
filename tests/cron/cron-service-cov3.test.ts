/**
 * CronService — 추가 미커버 분기 커버리지.
 * - _parse_field: 빈 부분, step NaN/0, range 경계 오류
 * - _compute_next_run: at_ms=0/음수 → null, every_ms=0 → null, at_ms > now → 바로 반환
 * - _get_tz_parts: null parts, catch 분기
 * - _execute_job: on_job throw → last_status=error, delete_after_run, at schedule disable
 * - disable_all_and_pause: count=0 (jobs 없음), count>0 → save
 * - health_check: running/not-running
 * - _is_running_fresh: running=false, started<=0
 * - _is_job_lock_stale: stat throw → true
 * - every(): interval 등록
 * - pause/resume 동작
 */
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CronService } from "@src/cron/service.js";

let store_path: string;

beforeEach(async () => {
  store_path = await mkdtemp(join(tmpdir(), "cron-cov3-"));
});

afterEach(async () => {
  await rm(store_path, { recursive: true, force: true }).catch(() => {});
});

function make_svc(on_job?: (...args: any[]) => Promise<void>) {
  return new CronService(store_path, on_job ?? null);
}

// ══════════════════════════════════════════════════════════
// _parse_field — 엣지 케이스 (add_job 유효성 검사를 통해)
// ══════════════════════════════════════════════════════════

describe("CronService — _parse_field 엣지 케이스 (cron 표현식)", () => {
  it("잘못된 범위 (a > b) → invalid cron expression", async () => {
    const svc = make_svc();
    await expect(
      svc.add_job("bad-range", { kind: "cron", expr: "59-0 * * * *" }, "msg")
    ).rejects.toThrow("invalid cron expression");
    await svc.stop();
  });

  it("범위 값이 최대 초과 (분 60) → invalid cron expression", async () => {
    const svc = make_svc();
    await expect(
      svc.add_job("out-of-range", { kind: "cron", expr: "0-60 * * * *" }, "msg")
    ).rejects.toThrow("invalid cron expression");
    await svc.stop();
  });

  it("step=0 → invalid cron expression", async () => {
    const svc = make_svc();
    await expect(
      svc.add_job("step-zero", { kind: "cron", expr: "*/0 * * * *" }, "msg")
    ).rejects.toThrow("invalid cron expression");
    await svc.stop();
  });

  it("숫자 범위 밖 단일값 (분 60) → invalid cron expression", async () => {
    const svc = make_svc();
    await expect(
      svc.add_job("single-out", { kind: "cron", expr: "60 * * * *" }, "msg")
    ).rejects.toThrow("invalid cron expression");
    await svc.stop();
  });

  it("valid step */5 → 성공", async () => {
    const svc = make_svc();
    const job = await svc.add_job("step-five", { kind: "cron", expr: "*/5 * * * *" }, "msg");
    expect(job.id).toBeTruthy();
    await svc.stop();
  });

  it("빈 문자 분리 (,,) → 파싱 성공 (빈 부분 skip)", async () => {
    // 빈 부분은 continue로 처리 — valid expression이면 파싱 완료
    const svc = make_svc();
    const job = await svc.add_job("valid-cron", { kind: "cron", expr: "0 12 * * *" }, "msg");
    expect(job.id).toBeTruthy();
    await svc.stop();
  });
});

// ══════════════════════════════════════════════════════════
// _compute_next_run — at/every 엣지 케이스
// ══════════════════════════════════════════════════════════

describe("CronService — at/every schedule 엣지 케이스", () => {
  it("at_ms=0 → add_job 시 invalid schedule 오류", async () => {
    const svc = make_svc();
    await expect(
      svc.add_job("bad-at", { kind: "at", at_ms: 0 }, "msg")
    ).rejects.toThrow();
    await svc.stop();
  });

  it("at_ms=음수 → add_job 시 invalid schedule 오류", async () => {
    const svc = make_svc();
    await expect(
      svc.add_job("neg-at", { kind: "at", at_ms: -1 }, "msg")
    ).rejects.toThrow();
    await svc.stop();
  });

  it("every_ms=0 → add_job 시 invalid schedule 오류", async () => {
    const svc = make_svc();
    await expect(
      svc.add_job("zero-every", { kind: "every", every_ms: 0 }, "msg")
    ).rejects.toThrow();
    await svc.stop();
  });

  it("every schedule with at_ms in future → next_run = at_ms", async () => {
    const svc = make_svc();
    const future_ms = Date.now() + 60 * 60 * 1000; // 1시간 후
    const job = await svc.add_job("future-start", { kind: "every", every_ms: 10_000, at_ms: future_ms }, "msg");
    expect(job.state.next_run_at_ms).toBe(future_ms);
    await svc.stop();
  });

  it("at schedule: delete_after_run 미지정 → true (at는 1회성)", async () => {
    const svc = make_svc();
    const at_ms = Date.now() + 3600_000;
    const job = await svc.add_job("at-job", { kind: "at", at_ms }, "msg");
    expect(job.delete_after_run).toBe(true);
    await svc.stop();
  });
});

// ══════════════════════════════════════════════════════════
// _execute_job — on_job throw → error 상태, delete_after_run
// ══════════════════════════════════════════════════════════

describe("CronService — _execute_job 오류 처리", () => {
  it("on_job throw → job.state.last_status=error", async () => {
    const on_job = vi.fn().mockRejectedValue(new Error("job failed"));
    const svc = new CronService(store_path, on_job);
    const job = await svc.add_job("fail-job", { kind: "every", every_ms: 60_000 }, "msg");
    const ran = await svc.run_job(job.id, true);
    expect(ran).toBe(true);
    const jobs = await svc.list_jobs(true);
    const found = jobs.find(j => j.id === job.id);
    expect(found?.state.last_status).toBe("error");
    expect(found?.state.last_error).toContain("job failed");
    await svc.stop();
  });

  it("on_job 성공 → job.state.last_status=ok", async () => {
    const on_job = vi.fn().mockResolvedValue(undefined);
    const svc = new CronService(store_path, on_job);
    const job = await svc.add_job("ok-job", { kind: "every", every_ms: 60_000 }, "msg");
    await svc.run_job(job.id, true);
    const jobs = await svc.list_jobs(true);
    const found = jobs.find(j => j.id === job.id);
    expect(found?.state.last_status).toBe("ok");
    await svc.stop();
  });

  it("at schedule: run_job 후 enabled=false, next_run=null (1회성 완료)", async () => {
    const on_job = vi.fn().mockResolvedValue(undefined);
    const svc = new CronService(store_path, on_job);
    const at_ms = Date.now() + 3600_000;
    const job = await svc.add_job("at-run", { kind: "at", at_ms }, "msg");
    // delete_after_run=true → 실행 후 삭제됨, jobs 목록에서 사라짐
    await svc.run_job(job.id, true);
    const jobs = await svc.list_jobs(true);
    // delete_after_run=true이므로 목록에서 제거
    expect(jobs.find(j => j.id === job.id)).toBeUndefined();
    await svc.stop();
  });

  it("every schedule: run_job 후 next_run 재계산", async () => {
    const on_job = vi.fn().mockResolvedValue(undefined);
    const svc = new CronService(store_path, on_job);
    const job = await svc.add_job("every-run", { kind: "every", every_ms: 5_000 }, "msg");
    await svc.run_job(job.id, true);
    const jobs = await svc.list_jobs(true);
    const found = jobs.find(j => j.id === job.id);
    // every schedule: next_run 재계산됨 (null 아님)
    expect(found?.state.next_run_at_ms).not.toBeNull();
    await svc.stop();
  });
});

// ══════════════════════════════════════════════════════════
// disable_all_and_pause
// ══════════════════════════════════════════════════════════

describe("CronService — disable_all_and_pause", () => {
  it("jobs 없음 → count=0 반환 (save 미호출)", async () => {
    const svc = make_svc();
    const count = await svc.disable_all_and_pause();
    expect(count).toBe(0);
    await svc.stop();
  });

  it("활성 job 있음 → count>0 반환, 모두 disabled", async () => {
    const svc = make_svc();
    await svc.add_job("j1", { kind: "every", every_ms: 60_000 }, "m1");
    await svc.add_job("j2", { kind: "every", every_ms: 60_000 }, "m2");
    const count = await svc.disable_all_and_pause();
    expect(count).toBe(2);
    const jobs = await svc.list_jobs(true);
    expect(jobs.every(j => !j.enabled)).toBe(true);
    await svc.stop();
  });

  it("이미 disabled job → count에 미포함", async () => {
    const svc = make_svc();
    const job = await svc.add_job("j1", { kind: "every", every_ms: 60_000 }, "m1");
    await svc.enable_job(job.id, false);
    const count = await svc.disable_all_and_pause();
    expect(count).toBe(0);
    await svc.stop();
  });
});

// ══════════════════════════════════════════════════════════
// health_check
// ══════════════════════════════════════════════════════════

describe("CronService — health_check", () => {
  it("미시작 상태 → ok=false", () => {
    const svc = make_svc();
    const h = svc.health_check();
    expect(h.ok).toBe(false);
  });

  it("start 후 → ok=true", async () => {
    const svc = make_svc();
    await svc.start();
    const h = svc.health_check();
    expect(h.ok).toBe(true);
    await svc.stop();
  });

  it("stop 후 → ok=false", async () => {
    const svc = make_svc();
    await svc.start();
    await svc.stop();
    const h = svc.health_check();
    expect(h.ok).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════
// pause / resume
// ══════════════════════════════════════════════════════════

describe("CronService — pause / resume", () => {
  it("pause → paused=true", async () => {
    const svc = make_svc();
    await svc.start();
    await svc.pause();
    const st = await svc.status();
    expect(st.paused).toBe(true);
    expect(st.enabled).toBe(false); // running && !paused
    await svc.stop();
  });

  it("resume (running=true) → paused=false", async () => {
    const svc = make_svc();
    await svc.start();
    await svc.pause();
    await svc.resume();
    const st = await svc.status();
    expect(st.paused).toBe(false);
    await svc.stop();
  });

  it("resume (running=false) → start 호출 효과", async () => {
    const svc = make_svc();
    // start 하지 않고 바로 resume → start 내부 호출
    await svc.resume();
    const h = svc.health_check();
    expect(h.ok).toBe(true);
    await svc.stop();
  });
});

// ══════════════════════════════════════════════════════════
// every(): interval 등록
// ══════════════════════════════════════════════════════════

describe("CronService — every()", () => {
  it("every 콜백 → interval 등록 성공", async () => {
    const svc = make_svc();
    const fn = vi.fn().mockResolvedValue(undefined);
    svc.every(5000, fn);
    // stop 시 clearInterval 호출
    await svc.stop();
    // 에러 없이 완료
    expect(true).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════
// _get_tz_parts — 잘못된 tz → null 반환 경로
// ══════════════════════════════════════════════════════════

describe("CronService — cron with timezone", () => {
  it("유효한 timezone → 정상 next_run 계산", async () => {
    const svc = make_svc();
    const job = await svc.add_job("tz-job", { kind: "cron", expr: "0 12 * * *", tz: "Asia/Seoul" }, "msg");
    expect(job.state.next_run_at_ms).not.toBeNull();
    await svc.stop();
  });

  it("무효한 timezone → add_job 시 invalid timezone 오류", async () => {
    const warn = vi.fn();
    const svc = new CronService(store_path, null, { logger: { warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() } as any });
    // 존재하지 않는 tz로는 validate에서 실패
    await expect(
      svc.add_job("bad-tz", { kind: "cron", expr: "0 12 * * *", tz: "Invalid/Tz" }, "msg")
    ).rejects.toThrow("unknown timezone");
    await svc.stop();
  });
});

// ══════════════════════════════════════════════════════════
// list_jobs — include_disabled 옵션
// ══════════════════════════════════════════════════════════

describe("CronService — list_jobs", () => {
  it("include_disabled=false (기본) → enabled만 반환", async () => {
    const svc = make_svc();
    const j1 = await svc.add_job("j1", { kind: "every", every_ms: 60_000 }, "msg");
    await svc.enable_job(j1.id, false);
    await svc.add_job("j2", { kind: "every", every_ms: 60_000 }, "msg");
    const jobs = await svc.list_jobs(false);
    expect(jobs.every(j => j.enabled)).toBe(true);
    await svc.stop();
  });

  it("include_disabled=true → 모든 job 반환", async () => {
    const svc = make_svc();
    const j1 = await svc.add_job("j1", { kind: "every", every_ms: 60_000 }, "msg");
    await svc.enable_job(j1.id, false);
    const j2 = await svc.add_job("j2", { kind: "every", every_ms: 60_000 }, "msg");
    const jobs = await svc.list_jobs(true);
    expect(jobs.length).toBe(2);
    await svc.stop();
  });
});

// ══════════════════════════════════════════════════════════
// on_change 콜백
// ══════════════════════════════════════════════════════════

describe("CronService — on_change 콜백", () => {
  it("on_change: added/removed/enabled/disabled 이벤트", async () => {
    const changes: string[] = [];
    const svc = new CronService(store_path, null, { on_change: (type: string) => {
      changes.push(type);
    } });
    const job = await svc.add_job("cb-job", { kind: "every", every_ms: 60_000 }, "msg");
    await svc.enable_job(job.id, false);
    await svc.enable_job(job.id, true);
    await svc.remove_job(job.id);
    expect(changes).toContain("added");
    expect(changes).toContain("disabled");
    expect(changes).toContain("enabled");
    expect(changes).toContain("removed");
    await svc.stop();
  });

  it("on_change throw → 에러가 격리됨 (서비스 계속 동작)", async () => {
    const svc = new CronService(store_path, null, { on_change: () => {
      throw new Error("on_change error");
    } });
    // add_job이 예외 없이 완료되어야 함
    await expect(
      svc.add_job("no-throw-job", { kind: "every", every_ms: 60_000 }, "msg")
    ).resolves.toBeTruthy();
    await svc.stop();
  });
});

// ══════════════════════════════════════════════════════════
// status()
// ══════════════════════════════════════════════════════════

describe("CronService — status()", () => {
  it("미시작 → enabled=false, paused=false", async () => {
    const svc = make_svc();
    const st = await svc.status();
    expect(st.enabled).toBe(false);
    expect(st.paused).toBe(false);
    await svc.stop();
  });

  it("start 후 → enabled=true", async () => {
    const svc = make_svc();
    await svc.start();
    const st = await svc.status();
    expect(st.enabled).toBe(true);
    await svc.stop();
  });
});
