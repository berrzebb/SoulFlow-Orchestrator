/**
 * CronService — 미커버 경로 보충.
 * add_job 선택 파라미터, run_job force=true, health_check,
 * _execute_job 경로 (on_job 콜백, delete_after_run, at 스케줄 disable).
 */
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CronService } from "@src/cron/service.js";

describe("CronService — Extended Coverage", () => {
  let store_path: string;
  let svc: CronService;

  beforeEach(async () => {
    store_path = await mkdtemp(join(tmpdir(), "cron-ext-"));
    svc = new CronService(store_path, null);
  });

  afterEach(async () => {
    await svc.stop().catch(() => {});
    await rm(store_path, { recursive: true, force: true }).catch(() => {});
  });

  // ══════════════════════════════════════════
  // add_job — 선택 파라미터
  // ══════════════════════════════════════════

  describe("add_job 선택 파라미터", () => {
    it("deliver=true, channel, to 파라미터 전달", async () => {
      const job = await svc.add_job(
        "deliver-job",
        { kind: "every", every_ms: 60_000 },
        "deliver this message",
        true,          // deliver
        "ch-123",      // channel
        "user-456",    // to
      );
      expect(job.payload.deliver).toBe(true);
      expect(job.payload.channel).toBe("ch-123");
      expect(job.payload.to).toBe("user-456");
    });

    it("delete_after_run=false 명시 → every 스케줄도 유지", async () => {
      const job = await svc.add_job(
        "keep-every",
        { kind: "every", every_ms: 60_000 },
        "repeating",
        false, null, null,
        false,  // delete_after_run 명시 false
      );
      expect(job.delete_after_run).toBe(false);
    });

    it("delete_after_run=true 명시 → every 스케줄에서도 삭제 설정", async () => {
      const job = await svc.add_job(
        "delete-every",
        { kind: "every", every_ms: 60_000 },
        "once then delete",
        false, null, null,
        true,  // delete_after_run 명시 true
      );
      expect(job.delete_after_run).toBe(true);
    });
  });

  // ══════════════════════════════════════════
  // run_job — force=true
  // ══════════════════════════════════════════

  describe("run_job force 옵션", () => {
    it("disabled 잡 + force=true → 실행됨 (true 반환)", async () => {
      let executed = false;
      const svc_with_on_job = new CronService(store_path, async (_job) => { executed = true; });
      const job = await svc_with_on_job.add_job("forced-job", { kind: "every", every_ms: 60_000 }, "force");
      await svc_with_on_job.enable_job(job.id, false); // 비활성화
      const result = await svc_with_on_job.run_job(job.id, true); // force
      expect(result).toBe(true);
      expect(executed).toBe(true);
      await svc_with_on_job.stop().catch(() => {});
    });

    it("enabled 잡 + force=false → 실행됨 (true 반환)", async () => {
      let executed = false;
      const svc_with_on_job = new CronService(store_path, async (_job) => { executed = true; });
      const job = await svc_with_on_job.add_job("normal-job", { kind: "every", every_ms: 60_000 }, "run");
      const result = await svc_with_on_job.run_job(job.id); // force=false (기본)
      expect(result).toBe(true);
      expect(executed).toBe(true);
      await svc_with_on_job.stop().catch(() => {});
    });
  });

  // ══════════════════════════════════════════
  // health_check
  // ══════════════════════════════════════════

  describe("health_check", () => {
    it("시작 전 → ok=false", () => {
      const h = svc.health_check();
      expect(h.ok).toBe(false);
      expect(h.details).toHaveProperty("paused");
    });
  });

  // ══════════════════════════════════════════
  // _execute_job 경로
  // ══════════════════════════════════════════

  describe("_execute_job 경로", () => {
    it("on_job 콜백 에러 → last_status=error, 잡은 유지", async () => {
      const svc_with_error = new CronService(store_path, async (_job) => { throw new Error("job error"); });
      const job = await svc_with_error.add_job("error-job", { kind: "every", every_ms: 60_000 }, "fail");
      await svc_with_error.run_job(job.id, true);
      const jobs = await svc_with_error.list_jobs(true);
      const updated = jobs.find(j => j.id === job.id);
      expect(updated?.state.last_status).toBe("error");
      expect(updated?.state.last_error).toContain("job error");
      await svc_with_error.stop().catch(() => {});
    });

    it("delete_after_run=true → 실행 후 잡 삭제", async () => {
      let executed = false;
      const svc_delete = new CronService(store_path, async (_job) => { executed = true; });
      const job = await svc_delete.add_job("delete-job", { kind: "at", at_ms: Date.now() + 60_000 }, "once");
      // at 스케줄은 기본 delete_after_run=true
      expect(job.delete_after_run).toBe(true);
      await svc_delete.run_job(job.id, true);
      const jobs = await svc_delete.list_jobs(true);
      expect(jobs.some(j => j.id === job.id)).toBe(false); // 삭제됨
      expect(executed).toBe(true);
      await svc_delete.stop().catch(() => {});
    });

    it("at 스케줄 + delete_after_run=false → 실행 후 disabled", async () => {
      const svc_at = new CronService(store_path, async (_job) => {});
      const job = await svc_at.add_job(
        "at-no-delete",
        { kind: "at", at_ms: Date.now() + 60_000 },
        "at job",
        false, null, null,
        false,  // delete_after_run=false
      );
      await svc_at.run_job(job.id, true);
      const jobs = await svc_at.list_jobs(true);
      const updated = jobs.find(j => j.id === job.id);
      expect(updated).toBeDefined();
      // delete_after_run=false + at 스케줄 → enabled=false 로 설정됨
      expect(updated!.enabled).toBe(false);
      await svc_at.stop().catch(() => {});
    });

    it("every 스케줄 + delete_after_run=false → next_run_at_ms 재계산", async () => {
      const svc_every = new CronService(store_path, async (_job) => {});
      const job = await svc_every.add_job(
        "every-persist",
        { kind: "every", every_ms: 60_000 },
        "repeating",
        false, null, null,
        false,
      );
      const before_run = job.state.next_run_at_ms;
      await svc_every.run_job(job.id, true);
      const jobs = await svc_every.list_jobs(true);
      const updated = jobs.find(j => j.id === job.id);
      // 실행 후 next_run_at_ms 재계산됨
      expect(updated?.state.next_run_at_ms).not.toBeNull();
      expect(updated?.state.last_run_at_ms).not.toBeNull();
      await svc_every.stop().catch(() => {});
    });
  });

  // ══════════════════════════════════════════
  // _compute_next_run — cron + tz
  // ══════════════════════════════════════════

  describe("cron + timezone 다음 실행 시간", () => {
    it("Asia/Seoul tz cron → next_run_at_ms > now", async () => {
      const job = await svc.add_job("tz-test", { kind: "cron", expr: "0 9 * * 1-5", tz: "Asia/Seoul" }, "morning");
      expect(job.state.next_run_at_ms).toBeGreaterThan(Date.now());
    });

    it("UTC tz cron → next_run_at_ms > now", async () => {
      const job = await svc.add_job("utc-test", { kind: "cron", expr: "30 12 * * *", tz: "UTC" }, "noon");
      expect(job.state.next_run_at_ms).toBeGreaterThan(Date.now());
    });
  });

  // ══════════════════════════════════════════
  // status 상세
  // ══════════════════════════════════════════

  describe("status 상세", () => {
    it("start 후 status.enabled=true", async () => {
      await svc.start();
      const st = await svc.status();
      expect(st.enabled).toBe(true);
      expect(st.paused).toBe(false);
      await svc.stop();
    });

    it("jobs count 반영", async () => {
      await svc.add_job("job1", { kind: "every", every_ms: 60_000 }, "m1");
      await svc.add_job("job2", { kind: "every", every_ms: 60_000 }, "m2");
      const st = await svc.status();
      expect(st.jobs).toBe(2);
    });
  });
});
