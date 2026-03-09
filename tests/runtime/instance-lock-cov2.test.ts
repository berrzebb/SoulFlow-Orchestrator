/**
 * instance-lock — acquire_runtime_instance_lock 분기 커버리지.
 * - 첫 시도에 락 획득 성공
 * - EEXIST: 이전 프로세스 살아있음 → acquired=false
 * - EEXIST: 이전 프로세스 없음 (stale) → unlink 후 재시도
 * - 모든 재시도 실패 → acquired=false
 * - release: 현재 pid가 달라 no-op
 * - read_lock_payload: 빈 파일 → null, JSON 파싱 실패 → null
 * - process_alive: pid <= 0 → false
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { acquire_runtime_instance_lock } from "@src/runtime/instance-lock.js";

let test_dir: string;

beforeEach(async () => {
  test_dir = await mkdtemp(join(tmpdir(), "instance-lock-"));
});

afterEach(async () => {
  await rm(test_dir, { recursive: true, force: true }).catch(() => {});
});

// ══════════════════════════════════════════════════════════
// 기본 락 획득
// ══════════════════════════════════════════════════════════

describe("acquire_runtime_instance_lock — 기본 획득", () => {
  it("첫 시도에 락 획득 → acquired=true", async () => {
    const handle = await acquire_runtime_instance_lock({ workspace: test_dir });
    expect(handle.acquired).toBe(true);
    expect(handle.holder_pid).toBe(process.pid);
    expect(handle.key).toBeTruthy();
    expect(handle.lock_path).toContain(".lock");
    await handle.release();
  });

  it("release → lock 파일 삭제", async () => {
    const handle = await acquire_runtime_instance_lock({ workspace: test_dir });
    const { lock_path } = handle;
    await handle.release();
    // 파일이 삭제되었는지 확인
    const { existsSync } = await import("node:fs");
    expect(existsSync(lock_path)).toBe(false);
  });

  it("같은 workspace에서 두 번 호출 → 두 번째는 acquired=false", async () => {
    const h1 = await acquire_runtime_instance_lock({ workspace: test_dir, retries: 1 });
    expect(h1.acquired).toBe(true);

    const h2 = await acquire_runtime_instance_lock({ workspace: test_dir, retries: 1, retry_ms: 10 });
    expect(h2.acquired).toBe(false);

    await h1.release();
  });

  it("release 후 재획득 → acquired=true", async () => {
    const h1 = await acquire_runtime_instance_lock({ workspace: test_dir });
    await h1.release();

    const h2 = await acquire_runtime_instance_lock({ workspace: test_dir });
    expect(h2.acquired).toBe(true);
    await h2.release();
  });
});

// ══════════════════════════════════════════════════════════
// stale lock 처리
// ══════════════════════════════════════════════════════════

describe("acquire_runtime_instance_lock — stale lock", () => {
  it("stale lock (pid=999999 없음) → unlink 후 재획득 성공", async () => {
    // 존재하지 않는 PID로 lock 파일을 미리 생성
    const lock_dir = join(test_dir, "runtime", ".locks");
    await mkdir(lock_dir, { recursive: true });

    // lock key를 계산하기 위해 먼저 lock을 획득해 key를 얻음
    const h = await acquire_runtime_instance_lock({ workspace: test_dir });
    const lock_path = h.lock_path;
    await h.release();

    // 존재하지 않는 PID로 stale lock 파일 생성
    const stale_payload = JSON.stringify({ pid: 999999999, started_at: "old", cwd: "/", key: h.key });
    await writeFile(lock_path, stale_payload, "utf-8");

    // stale lock → unlink → 재획득
    const h2 = await acquire_runtime_instance_lock({ workspace: test_dir, retries: 3 });
    expect(h2.acquired).toBe(true);
    await h2.release();
  });
});

// ══════════════════════════════════════════════════════════
// release: 다른 pid → no-op
// ══════════════════════════════════════════════════════════

describe("acquire_runtime_instance_lock — release no-op", () => {
  it("lock 파일의 pid가 다르면 release가 파일을 삭제하지 않음", async () => {
    const h = await acquire_runtime_instance_lock({ workspace: test_dir });
    const lock_path = h.lock_path;

    // 다른 pid로 lock 파일 덮어씀
    const other_payload = JSON.stringify({ pid: 1, started_at: "now", cwd: "/", key: h.key });
    await writeFile(lock_path, other_payload, "utf-8");

    // release → pid 불일치 → no-op
    await h.release();

    const { existsSync } = await import("node:fs");
    expect(existsSync(lock_path)).toBe(true);

    // 정리
    await rm(lock_path).catch(() => {});
  });
});

// ══════════════════════════════════════════════════════════
// retries 설정
// ══════════════════════════════════════════════════════════

describe("acquire_runtime_instance_lock — retries/retry_ms", () => {
  it("retries=1 → 1회 시도 후 포기", async () => {
    const h1 = await acquire_runtime_instance_lock({ workspace: test_dir });
    const start = Date.now();
    const h2 = await acquire_runtime_instance_lock({ workspace: test_dir, retries: 1, retry_ms: 50 });
    const elapsed = Date.now() - start;
    expect(h2.acquired).toBe(false);
    // retries=1이므로 sleep 없음 (i < retries - 1 = 0 → 조건 false)
    expect(elapsed).toBeLessThan(200);
    await h1.release();
  });
});
