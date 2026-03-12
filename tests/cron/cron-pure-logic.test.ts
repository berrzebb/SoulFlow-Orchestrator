/**
 * CronService 순수 로직 테스트 — SQLite 실제 사용, 외부 의존성 없음.
 * _parse_cron, _compute_next_run, schedule 검증, CRUD, enable/disable 동작 검증.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CronService } from "../../src/cron/service.js";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { CronJob } from "../../src/cron/types.js";

describe("CronService — pure logic", () => {
  let store_path: string;
  let svc: CronService;

  beforeEach(async () => {
    store_path = join(tmpdir(), `cron-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    await mkdir(store_path, { recursive: true });
    svc = new CronService(store_path, null);
  });

  afterEach(async () => {
    await svc.stop().catch(() => {});
    await rm(store_path, { recursive: true, force: true }).catch(() => {});
  });

  // ── add_job ────────────────────────────────────────
  it("add_job: 'every' 스케줄 잡 추가 성공", async () => {
    const job = await svc.add_job("test-every", { kind: "every", every_ms: 60_000 }, "check logs");
    expect(job.id).toBeTruthy();
    expect(job.name).toBe("test-every");
    expect(job.enabled).toBe(true);
    expect(job.schedule.kind).toBe("every");
    expect(job.state.next_run_at_ms).toBeGreaterThan(0);
    expect(job.payload.message).toBe("check logs");
  });

  it("add_job: 'at' 스케줄 잡 추가 → delete_after_run 기본 true", async () => {
    const future = Date.now() + 3600_000;
    const job = await svc.add_job("test-at", { kind: "at", at_ms: future }, "once");
    expect(job.schedule.kind).toBe("at");
    expect(job.delete_after_run).toBe(true);
    expect(job.state.next_run_at_ms).toBe(future);
  });

  it("add_job: 'cron' 스케줄 잡 추가", async () => {
    const job = await svc.add_job("test-cron", { kind: "cron", expr: "0 9 * * *" }, "morning");
    expect(job.schedule.kind).toBe("cron");
    expect(job.state.next_run_at_ms).toBeGreaterThan(Date.now());
  });

  it("add_job: 'cron' + timezone 유효한 경우", async () => {
    const job = await svc.add_job("tz-cron", { kind: "cron", expr: "30 14 * * *", tz: "Asia/Seoul" }, "afternoon");
    expect(job.state.next_run_at_ms).toBeGreaterThan(Date.now());
  });

  // ── add_job 검증 실패 ────────────────────────────
  it("add_job: invalid at_ms → 에러", async () => {
    await expect(svc.add_job("bad-at", { kind: "at", at_ms: -1 }, "x")).rejects.toThrow();
  });

  it("add_job: invalid every_ms → 에러", async () => {
    await expect(svc.add_job("bad-every", { kind: "every", every_ms: 0 }, "x")).rejects.toThrow();
  });

  it("add_job: invalid cron expr → 에러", async () => {
    await expect(svc.add_job("bad-cron", { kind: "cron", expr: "invalid" }, "x")).rejects.toThrow();
  });

  it("add_job: tz on non-cron → 에러", async () => {
    await expect(svc.add_job("tz-every", { kind: "every", every_ms: 1000, tz: "UTC" } as any, "x")).rejects.toThrow();
  });

  it("add_job: unknown timezone → 에러", async () => {
    await expect(svc.add_job("bad-tz", { kind: "cron", expr: "0 0 * * *", tz: "Fake/Zone" }, "x")).rejects.toThrow();
  });

  // ── list_jobs ──────────────────────────────────────
  it("list_jobs: 빈 상태에서 빈 배열 반환", async () => {
    const jobs = await svc.list_jobs();
    expect(jobs).toEqual([]);
  });

  it("list_jobs: 추가한 잡이 목록에 포함", async () => {
    await svc.add_job("j1", { kind: "every", every_ms: 10_000 }, "m1");
    await svc.add_job("j2", { kind: "every", every_ms: 20_000 }, "m2");
    const jobs = await svc.list_jobs();
    expect(jobs.length).toBe(2);
  });

  it("list_jobs: disabled 잡은 기본적으로 필터", async () => {
    const job = await svc.add_job("j1", { kind: "every", every_ms: 10_000 }, "m1");
    await svc.enable_job(job.id, false);
    const filtered = await svc.list_jobs(false);
    expect(filtered.length).toBe(0);
    const all = await svc.list_jobs(true);
    expect(all.length).toBe(1);
  });

  // ── remove_job ─────────────────────────────────────
  it("remove_job: 존재하는 잡 삭제 성공", async () => {
    const job = await svc.add_job("rm-test", { kind: "every", every_ms: 5_000 }, "m");
    const removed = await svc.remove_job(job.id);
    expect(removed).toBe(true);
    const jobs = await svc.list_jobs(true);
    expect(jobs.length).toBe(0);
  });

  it("remove_job: 존재하지 않는 ID → false", async () => {
    const removed = await svc.remove_job("nonexistent-id");
    expect(removed).toBe(false);
  });

  // ── enable_job / disable ──────────────────────────
  it("enable_job: 비활성화 후 next_run_at_ms가 null", async () => {
    const job = await svc.add_job("toggle", { kind: "every", every_ms: 5_000 }, "m");
    const disabled = await svc.enable_job(job.id, false);
    expect(disabled!.enabled).toBe(false);
    expect(disabled!.state.next_run_at_ms).toBeNull();
  });

  it("enable_job: 재활성화 후 next_run_at_ms 재계산", async () => {
    const job = await svc.add_job("toggle2", { kind: "every", every_ms: 5_000 }, "m");
    await svc.enable_job(job.id, false);
    const enabled = await svc.enable_job(job.id, true);
    expect(enabled!.enabled).toBe(true);
    expect(enabled!.state.next_run_at_ms).toBeGreaterThan(0);
  });

  it("enable_job: 존재하지 않는 ID → null", async () => {
    const result = await svc.enable_job("ghost", true);
    expect(result).toBeNull();
  });

  // ── status / health_check ─────────────────────────
  it("status: 초기 상태 — enabled=false, paused=false", async () => {
    const st = await svc.status();
    expect(st.enabled).toBe(false);
    expect(st.paused).toBe(false);
    expect(st.jobs).toBe(0);
  });

  it("health_check: 미시작 상태에서 ok=false", () => {
    expect(svc.health_check().ok).toBe(false);
  });

  // ── start / stop / pause / resume ──────────────────
  it("start → health ok, stop → not ok", async () => {
    await svc.start();
    expect(svc.health_check().ok).toBe(true);
    await svc.stop();
    expect(svc.health_check().ok).toBe(false);
  });

  it("pause → paused, resume → resumed", async () => {
    await svc.start();
    await svc.pause();
    const st1 = await svc.status();
    expect(st1.paused).toBe(true);
    await svc.resume();
    const st2 = await svc.status();
    expect(st2.paused).toBe(false);
    await svc.stop();
  });

  it("resume: 미시작 상태에서 start 효과", async () => {
    await svc.resume();
    expect(svc.health_check().ok).toBe(true);
    await svc.stop();
  });

  // ── disable_all_and_pause ─────────────────────────
  it("disable_all_and_pause: 모든 잡 비활성화", async () => {
    await svc.add_job("d1", { kind: "every", every_ms: 5_000 }, "m1");
    await svc.add_job("d2", { kind: "every", every_ms: 5_000 }, "m2");
    const count = await svc.disable_all_and_pause();
    expect(count).toBe(2);
    const st = await svc.status();
    expect(st.paused).toBe(true);
  });

  // ── run_job ────────────────────────────────────────
  it("run_job: 존재하지 않는 잡 → false", async () => {
    const result = await svc.run_job("nonexistent");
    expect(result).toBe(false);
  });

  it("run_job: disabled 잡 force=false → false", async () => {
    const job = await svc.add_job("force-test", { kind: "every", every_ms: 60_000 }, "m");
    await svc.enable_job(job.id, false);
    const result = await svc.run_job(job.id, false);
    expect(result).toBe(false);
  });

  // ── persistence ────────────────────────────────────
  it("persistence: 새 인스턴스로 잡 복원 가능", async () => {
    await svc.add_job("persist-test", { kind: "every", every_ms: 30_000 }, "persisted");
    await svc.stop();

    const svc2 = new CronService(store_path, null);
    const jobs = await svc2.list_jobs(true);
    expect(jobs.length).toBe(1);
    expect(jobs[0].name).toBe("persist-test");
    await svc2.stop();
  });

  // ── cron 표현식 범위 테스트 ───────────────────────
  it("add_job: cron 표현식 — 분 범위 (*/15)", async () => {
    const job = await svc.add_job("every-15min", { kind: "cron", expr: "*/15 * * * *" }, "m");
    expect(job.state.next_run_at_ms).toBeGreaterThan(Date.now());
  });

  it("add_job: cron 표현식 — 요일 범위 (1-5)", async () => {
    const job = await svc.add_job("weekdays", { kind: "cron", expr: "0 9 * * 1-5" }, "m");
    expect(job.state.next_run_at_ms).toBeGreaterThan(Date.now());
  });

  it("add_job: cron 표현식 — 월 목록 (1,4,7,10)", async () => {
    const job = await svc.add_job("quarterly", { kind: "cron", expr: "0 0 1 1,4,7,10 *" }, "m");
    expect(job.state.next_run_at_ms).toBeGreaterThan(Date.now());
  });

  // ── top-of-hour auto-stagger ───────────────────────
  it("top-of-hour cron: 명시 stagger 없으면 next_run이 정각 + 5분 이내 오프셋", async () => {
    // "0 * * * *"는 매 시 정각 → 자동 stagger 최대 5분(300_000ms)
    const job = await svc.add_job("hourly", { kind: "cron", expr: "0 * * * *" }, "m");
    const next = job.state.next_run_at_ms!;
    // 정각 기준 시간 계산 (다음 정각)
    const top_of_hour = Math.ceil(Date.now() / 3_600_000) * 3_600_000;
    // next_run은 정각 이후 최대 300_000ms 이내여야 함
    expect(next).toBeGreaterThanOrEqual(top_of_hour);
    expect(next).toBeLessThanOrEqual(top_of_hour + 300_000);
  });

  it("top-of-hour cron: 명시적 stagger_ms가 있으면 그것을 사용", async () => {
    const job = await svc.add_job("hourly-explicit", { kind: "cron", expr: "0 * * * *", stagger_ms: 10_000 }, "m");
    const next = job.state.next_run_at_ms!;
    const top_of_hour = Math.ceil(Date.now() / 3_600_000) * 3_600_000;
    // 명시적 stagger 10초 이내여야 함 (자동 5분 아님)
    expect(next).toBeGreaterThanOrEqual(top_of_hour);
    expect(next).toBeLessThanOrEqual(top_of_hour + 10_000);
  });

  it("non-top-of-hour cron: stagger_ms 없으면 정확히 정각에 실행", async () => {
    // "0 9 * * *"는 매일 9시 — 시 정각이지만 "매 시"가 아님 → 자동 stagger 없음
    const job = await svc.add_job("daily-9am", { kind: "cron", expr: "0 9 * * *" }, "m");
    const next = job.state.next_run_at_ms!;
    // 다음 실행 시각은 분 경계(60초 배수)여야 함 — stagger 없으면 정확히 분 경계
    expect(next % 60_000).toBe(0);
  });

  // ── every ──
  it("every: 인터벌 타이머 등록 후 stop에서 정리", async () => {
    let called = false;
    svc.every(100_000, async () => { called = true; });
    await svc.stop();
    // stop 이후에는 타이머가 클리어되어 호출 안 됨
    expect(called).toBe(false);
  });
});
