/**
 * CronService — 미커버 분기 보충 (cov6).
 * - _acquire_job_lock: stale lock → unlink → retry (L630-637)
 * - _is_job_lock_stale: stat 실패 → true (L647)
 * - every(): callback 예외 catch (L807)
 */
import { mkdtemp, rm, mkdir, writeFile, utimes } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CronService } from "@src/cron/service.js";

let store_path: string;

beforeEach(async () => {
  store_path = await mkdtemp(join(tmpdir(), "cron-cov6-"));
});

afterEach(async () => {
  await rm(store_path, { recursive: true, force: true }).catch(() => {});
});

function make_svc(on_job?: (...args: any[]) => Promise<void>) {
  return new CronService(store_path, on_job ?? null, {});
}

// ══════════════════════════════════════════════════════════
// _acquire_job_lock: stale lock → unlink → retry (L630-637)
// ══════════════════════════════════════════════════════════

describe("CronService — stale lock cleanup and retry (L630-637)", () => {
  it("stale lock 파일 존재 → unlink 후 새 lock 획득", async () => {
    const svc = make_svc();
    const lock_dir = join(store_path, ".locks");
    await mkdir(lock_dir, { recursive: true });

    // lock 파일 생성 후 mtime을 5분 전으로 설정 (running_lease_ms=120000 초과)
    const lock_file = join(lock_dir, "stale-job.lock");
    await writeFile(lock_file, "stale_content");
    const old_time = new Date(Date.now() - 10 * 60 * 1000); // 10분 전
    await utimes(lock_file, old_time, old_time);

    // _acquire_job_lock 직접 호출 → stale이므로 unlink 후 새 lock 반환
    const lock_path = await (svc as any)._acquire_job_lock("stale-job");
    expect(lock_path).toBeTruthy(); // lock 경로 반환 (null이 아님)
    expect(typeof lock_path).toBe("string");
    await svc.stop();
  });
});

// ══════════════════════════════════════════════════════════
// _is_job_lock_stale: stat 실패 → true (L647)
// ══════════════════════════════════════════════════════════

describe("CronService — _is_job_lock_stale stat 실패 (L647)", () => {
  it("존재하지 않는 경로 → stat 예외 → true 반환", async () => {
    const svc = make_svc();
    // 존재하지 않는 파일 경로에 stat → ENOENT 예외 → catch → return true
    const result = await (svc as any)._is_job_lock_stale("/nonexistent/path/ghost.lock");
    expect(result).toBe(true);
    await svc.stop();
  });
});

// ══════════════════════════════════════════════════════════
// every(): callback 예외 catch (L807)
// ══════════════════════════════════════════════════════════

describe("CronService — every() callback 예외 (L807)", () => {
  it("callback이 Promise.reject → catch 핸들러 호출 (에러 없이 처리)", async () => {
    vi.useFakeTimers();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any;
    const svc = new CronService(store_path, null, { logger });

    const failing_fn = vi.fn().mockRejectedValue(new Error("callback error"));
    svc.every(1000, failing_fn);

    // setInterval 발동
    await vi.advanceTimersByTimeAsync(1100);

    // callback 에러가 logger.error로 기록됨
    expect(logger.error).toHaveBeenCalledWith(
      "interval callback failed",
      expect.objectContaining({ error: expect.stringContaining("callback error") }),
    );

    vi.useRealTimers();
    await svc.stop();
  });
});
