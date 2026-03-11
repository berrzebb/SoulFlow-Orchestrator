/**
 * CronService — 미커버 분기 (cov9):
 * - L190: _compute_next_run — "at" schedule, at_ms=null → return null
 * - L196: _compute_next_run — "every" schedule, every_ms=null → return null
 * - L204: _compute_next_run — cron expr with < 5 fields → _parse_cron null → return null
 * - L242: _compute_next_run — kind="cron" but expr="" (falsy) → falls through → return null
 * - L468-473: persist_store_to_sqlite — ROLLBACK on duplicate PRIMARY KEY
 * - L560: _on_timer — _tick_running=true → early return
 * - L575-576: _on_timer — _execute_job throws → catch sets last_status/last_error
 */
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CronService } from "@src/cron/service.js";
import type { CronJob } from "@src/cron/types.js";

let store_path: string;

beforeEach(async () => {
  store_path = await mkdtemp(join(tmpdir(), "cron-cov9-"));
});

afterEach(async () => {
  await rm(store_path, { recursive: true, force: true }).catch(() => {});
});

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

// ── L190: "at" schedule, at_ms=null → _compute_next_run return null ──────────

describe("CronService — L190: at schedule, at_ms=null → null", () => {
  it("at_ms=null 주입 → _recompute_next_runs → next_run_at_ms=null", async () => {
    const svc = new CronService(store_path, null, {});
    const store = await (svc as any)._load_store();
    store.jobs.push(make_job("j-at", {
      schedule: { kind: "at", at_ms: null, every_ms: null, expr: null, tz: null },
    }));

    await (svc as any)._recompute_next_runs();

    const job = store.jobs.find((j: CronJob) => j.id === "j-at");
    expect(job?.state?.next_run_at_ms).toBeNull();
    await svc.stop();
  });
});

// ── L196: "every" schedule, every_ms=null → _compute_next_run return null ────

describe("CronService — L196: every schedule, every_ms=null → null", () => {
  it("every_ms=null 주입 → _recompute_next_runs → next_run_at_ms=null", async () => {
    const svc = new CronService(store_path, null, {});
    const store = await (svc as any)._load_store();
    store.jobs.push(make_job("j-ev", {
      schedule: { kind: "every", every_ms: null, at_ms: null, expr: null, tz: null },
    }));

    await (svc as any)._recompute_next_runs();

    const job = store.jobs.find((j: CronJob) => j.id === "j-ev");
    expect(job?.state?.next_run_at_ms).toBeNull();
    await svc.stop();
  });
});

// ── L204: cron expr → _parse_cron returns null → return null ─────────────────

describe("CronService — L204: cron expr with 4 fields → _parse_cron null", () => {
  it("5필드 미충족 cron expr → _parse_cron null → L204 return null", async () => {
    const svc = new CronService(store_path, null, {});
    const store = await (svc as any)._load_store();
    store.jobs.push(make_job("j-bad-cron", {
      // 4 fields only → _parse_cron returns null → L204
      schedule: { kind: "cron", expr: "0 * * *", at_ms: null, every_ms: null, tz: null },
    }));

    await (svc as any)._recompute_next_runs();

    const job = store.jobs.find((j: CronJob) => j.id === "j-bad-cron");
    expect(job?.state?.next_run_at_ms).toBeNull();
    await svc.stop();
  });
});

// ── L242: kind="cron" but expr="" (falsy) → falls through → return null ──────

describe("CronService — L242: cron schedule, expr='' → falls through → null", () => {
  it("expr='' → schedule.kind=cron && schedule.expr 조건 false → L242 return null", async () => {
    const svc = new CronService(store_path, null, {});
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

// ── L468-473: persist_store_to_sqlite — ROLLBACK on duplicate PK ─────────────
// with_sqlite는 에러를 삼키고 null 반환 — _save_store 자체는 throw 안 함.
// ROLLBACK이 실행되면 DB 상태가 원래대로 복구됨을 확인.

describe("CronService — L468-473: persist_store — duplicate id → ROLLBACK → DB 복구", () => {
  it("같은 id의 잡 두 개 → INSERT PRIMARY KEY 충돌 → ROLLBACK → DB는 이전 상태 유지", async () => {
    const svc = new CronService(store_path, null, {});
    const store = await (svc as any)._load_store();

    // 정상 잡 하나 먼저 저장
    const good = make_job("good-id");
    store.jobs.push(good);
    await (svc as any)._save_store(); // 성공 → DB에 good-id 저장

    // 같은 id로 두 잡 추가 → DELETE 후 INSERT 중복 → ROLLBACK
    const dup = make_job("dup-id");
    store.jobs.push(dup, { ...dup }); // L468 catch → ROLLBACK (DELETE도 롤백됨)

    // with_sqlite가 에러를 삼키므로 _save_store는 resolve됨
    await expect((svc as any)._save_store()).resolves.toBeUndefined();

    // ROLLBACK 후 DB에 good-id가 남아있음 (DELETE도 롤백됨)
    (svc as any)._store = null;
    const recovered = await (svc as any)._load_store();
    expect(recovered.jobs.some((j: CronJob) => j.id === "good-id")).toBe(true);

    await svc.stop();
  });
});

// ── L560: _on_timer — _tick_running=true → 조기 반환 ─────────────────────────

describe("CronService — L560: _on_timer with _tick_running=true → early return", () => {
  it("_tick_running=true 상태에서 _on_timer 호출 → L560 즉시 반환", async () => {
    const svc = new CronService(store_path, null, {});
    await (svc as any)._load_store();

    (svc as any)._running = true;
    (svc as any)._paused = false;
    (svc as any)._tick_running = true; // L560 guard 활성화

    // _on_timer가 early return 해야 함 (예외 없음, _tick_running 유지)
    await (svc as any)._on_timer();

    // early return 이후 _tick_running은 변경되지 않아야 함
    expect((svc as any)._tick_running).toBe(true);
    await svc.stop();
  });
});

// ── L575-576: _on_timer — _execute_job throw → catch → last_status/error ─────

describe("CronService — L575-576: _execute_job throw → catch sets last_status/error", () => {
  it("_execute_job 예외 → catch L575-576: job.state.last_status='error'", async () => {
    const svc = new CronService(store_path, null, {});
    await (svc as any)._load_store();

    const job = make_job("j-exec-fail", {
      state: {
        next_run_at_ms: Date.now() - 1000, // 기한 초과
        last_run_at_ms: null,
        last_status: null,
        last_error: null,
        running: false,
        running_started_at_ms: null,
      },
    });
    (svc as any)._store.jobs.push(job);

    // _execute_job을 throw하도록 mock
    vi.spyOn(svc as any, "_execute_job").mockRejectedValue(new Error("exec-fail"));

    (svc as any)._running = true;
    (svc as any)._paused = false;
    (svc as any)._tick_running = false;

    await (svc as any)._on_timer();

    // L575-576: catch 블록에서 상태 설정
    expect(job.state.last_status).toBe("error");
    expect(job.state.last_error).toBe("exec-fail");
    await svc.stop();
  });
});
