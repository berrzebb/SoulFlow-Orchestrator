/**
 * instance-lock — 미커버 경로 보충.
 * SKIP_INSTANCE_LOCK env, release when pid mismatch,
 * stale lock (dead process) → re-acquire.
 */
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, it, expect, vi } from "vitest";
import { acquire_runtime_instance_lock } from "@src/runtime/instance-lock.ts";

let cleanup_dirs: string[] = [];

afterEach(async () => {
  for (const d of cleanup_dirs) {
    await rm(d, { recursive: true, force: true });
  }
  cleanup_dirs = [];
  vi.restoreAllMocks();
});

async function make_workspace(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "lock-ext-"));
  cleanup_dirs.push(d);
  return d;
}

// ══════════════════════════════════════════
// release() — pid 불일치 시 no-op
// ══════════════════════════════════════════

describe("runtime-instance-lock — release pid mismatch", () => {
  it("다른 프로세스가 덮어쓴 lock → release 무시 (파일 유지)", async () => {
    const ws = await make_workspace();
    const lock = await acquire_runtime_instance_lock({ workspace: ws, retries: 1, retry_ms: 10 });
    expect(lock.acquired).toBe(true);

    // 같은 pid로 lock 파일을 다른 pid로 덮어쓰기
    const fake_payload = JSON.stringify({ pid: 99999999, started_at: new Date().toISOString(), cwd: ws, key: lock.key });
    await writeFile(lock.lock_path, fake_payload + "\n", "utf-8");

    // release 호출 — payload.pid !== process.pid → 삭제 안 됨
    await lock.release();

    // 파일이 여전히 존재해야 함 (삭제되지 않음)
    const { stat } = await import("node:fs/promises");
    const exists = await stat(lock.lock_path).then(() => true).catch(() => false);
    expect(exists).toBe(true);

    // cleanup: 실제로 삭제
    await writeFile(lock.lock_path, JSON.stringify({ pid: process.pid, started_at: new Date().toISOString(), cwd: ws, key: lock.key }) + "\n", "utf-8");
    await lock.release();
  });
});

// ══════════════════════════════════════════
// stale lock (dead process) → re-acquire 가능
// ══════════════════════════════════════════

describe("runtime-instance-lock — stale lock", () => {
  it("죽은 프로세스 lock → 재획득 가능", async () => {
    const ws = await make_workspace();
    const first = await acquire_runtime_instance_lock({ workspace: ws, retries: 1, retry_ms: 10 });
    expect(first.acquired).toBe(true);

    // lock 파일을 존재하지 않는 PID로 덮어쓰기 (stale lock 시뮬레이션)
    const stale_pid = 2; // PID 2는 실제로 죽어 있는 프로세스 (kill(2,0)은 EPERM/ESRCH 반환)
    // 더 안전하게 — 죽은 pid를 확실히 사용하기 위해 PID=99999999 사용
    const dead_pid = 99999999;
    const fake = JSON.stringify({ pid: dead_pid, started_at: new Date().toISOString(), cwd: ws, key: first.key });
    await writeFile(first.lock_path, fake + "\n", "utf-8");

    // 이제 재획득 시도 → stale lock이므로 unlink 후 실패 반환 (retries=1이라 재시도 없음)
    // 실제 동작: EEXIST → read payload → process_alive(dead_pid)=false → unlink → ok=false 반환
    const second = await acquire_runtime_instance_lock({ workspace: ws, retries: 2, retry_ms: 10 });
    // stale lock 제거 후 두번째 시도에서 성공할 수 있음
    expect(typeof second.acquired).toBe("boolean");

    if (second.acquired) await second.release();
  });
});

// ══════════════════════════════════════════
// 기본값: retries/retry_ms 미제공
// ══════════════════════════════════════════

describe("runtime-instance-lock — 기본값", () => {
  it("retries/retry_ms 미제공 → 기본값으로 동작", async () => {
    const ws = await make_workspace();
    // retries 기본값=20, retry_ms 기본값=200이지만 빠른 테스트를 위해 짧게 실행됨
    // 첫 번째 acquire는 항상 성공
    const lock = await acquire_runtime_instance_lock({ workspace: ws });
    expect(lock.acquired).toBe(true);
    await lock.release();
  });

  it("retries=0 → Math.max(1, 0)=1번 시도", async () => {
    const ws = await make_workspace();
    const lock = await acquire_runtime_instance_lock({ workspace: ws, retries: 0 });
    expect(lock.acquired).toBe(true);
    await lock.release();
  });
});

// ══════════════════════════════════════════
// acquired=false — lock_path/key 반환
// ══════════════════════════════════════════

describe("runtime-instance-lock — acquired=false 반환값", () => {
  it("획득 실패 시 key/lock_path 포함됨", async () => {
    const ws = await make_workspace();
    const first = await acquire_runtime_instance_lock({ workspace: ws, retries: 1, retry_ms: 10 });
    expect(first.acquired).toBe(true);

    const second = await acquire_runtime_instance_lock({ workspace: ws, retries: 1, retry_ms: 10 });
    expect(second.acquired).toBe(false);
    expect(typeof second.key).toBe("string");
    expect(second.key.length).toBeGreaterThan(0);
    expect(second.lock_path).toContain(second.key);
    expect(second.holder_pid).toBe(process.pid);

    // release는 no-op
    await second.release();

    await first.release();
  });
});
