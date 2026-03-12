/**
 * CronService — 미커버 분기 (cov8):
 * - L169/L173: _get_tz_parts 잘못된 tz → catch → null 반환
 * - L211/L212: _compute_next_run — on_warn 호출 후 return null
 * - L512: _recompute_next_runs — invalid tz 잡의 next_run 계산
 * - L634: _is_running_fresh — running_started_at_ms=0 → false
 * - L808: run_job — job.id !== job_id → continue
 */
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CronService } from "@src/cron/service.js";

let store_path: string;

beforeEach(async () => {
  store_path = await mkdtemp(join(tmpdir(), "cron-cov8-"));
});

afterEach(async () => {
  await rm(store_path, { recursive: true, force: true }).catch(() => {});
});

// ── L169/L173 + L211/L212 + L512: 잘못된 timezone으로 next_run 계산 ─────────

describe("CronService — L169/L173/L211/L512: invalid tz → _get_tz_parts catch", () => {
  it("_store에 invalid tz 잡 주입 후 _recompute_next_runs → on_warn 호출", async () => {
    const warn_calls: string[] = [];
    const logger = {
      debug: vi.fn(), info: vi.fn(), error: vi.fn(),
      warn: (msg: string) => { warn_calls.push(msg); },
    };
    const svc = new CronService(store_path, null, { logger: logger as any });

    // store 초기화 후 직접 잡 주입
    const store = await (svc as any)._load_store();
    store.jobs.push({
      id: "bad-tz-job",
      name: "bad tz",
      enabled: true,
      schedule: { kind: "cron", expr: "0 * * * *", tz: "Not/A/Timezone", at_ms: null, every_ms: null },
      payload: { kind: "agent_turn", message: "test", deliver: false, channel: null, to: null },
      state: {
        next_run_at_ms: null,
        last_run_at_ms: null,
        last_status: null,
        last_error: null,
        running: false,
        running_started_at_ms: null,
      },
      created_at_ms: Date.now(),
      updated_at_ms: Date.now(),
      delete_after_run: false,
    });

    // _recompute_next_runs — invalid tz → _get_tz_parts throw → L173 catch → null → L211 on_warn 호출
    await (svc as any)._recompute_next_runs();

    // on_warn이 호출되어야 함
    expect(warn_calls.length).toBeGreaterThan(0);
    // next_run은 null (timezone 실패)
    const job = store.jobs.find((j: any) => j.id === "bad-tz-job");
    expect(job?.state?.next_run_at_ms).toBeNull();

    await svc.stop();
  });
});

// ── L634: _is_running_fresh — running_started_at_ms=0 → false ───────────────

describe("CronService — L634: running_started_at_ms=0 → _is_running_fresh false", () => {
  // _is_running_fresh는 순수 동기 메서드 — CronService 인스턴스 생성 시
  // lazy SQLite init이 afterEach의 temp dir 삭제와 충돌하므로 prototype에서 직접 호출
  const call_is_running_fresh = (job: unknown) =>
    (CronService.prototype as any)._is_running_fresh.call({}, job);

  it("running=true + started=0 → !isFinite(started) 또는 started<=0 → false", () => {
    const job = {
      state: {
        running: true,
        running_started_at_ms: 0, // started=0 → L634: started <= 0 → return false
      },
    };
    expect(call_is_running_fresh(job)).toBe(false);
  });

  it("running=true + started=null → !isFinite(0) false, started=0 → L634", () => {
    const job = {
      state: {
        running: true,
        running_started_at_ms: null,
      },
    };
    // Number(null || 0) = 0 → started=0 → started <= 0 → return false
    expect(call_is_running_fresh(job)).toBe(false);
  });
});

// ── L808: run_job — job.id !== job_id → continue ────────────────────────────

describe("CronService — L808: run_job — id 불일치 → continue", () => {
  it("두 잡 등록 후 두 번째 job_id로 run_job → 첫 번째 job continue → 두 번째 실행", async () => {
    const on_job = vi.fn().mockResolvedValue(undefined);
    const svc = new CronService(store_path, on_job, {});

    // 두 개의 잡 등록
    const job1 = await svc.add_job("job1", { kind: "every", every_ms: 60_000 }, "msg1");
    const job2 = await svc.add_job("job2", { kind: "every", every_ms: 60_000 }, "msg2");

    // job2의 id로 run_job → loop에서 job1.id !== job2.id → L808 continue
    const result = await svc.run_job(job2.id, true);
    expect(result).toBe(true);
    expect(on_job).toHaveBeenCalledTimes(1); // job2만 실행됨

    await svc.stop();
  });

});
