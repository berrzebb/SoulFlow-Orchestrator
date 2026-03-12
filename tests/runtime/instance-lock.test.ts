/**
 * instance-lock — acquire_runtime_instance_lock 통합 테스트.
 * - 기본 획득/해제, 이중 획득, stale lock 처리
 * - process_alive: pid <= 0, 다른 hostname
 * - read_lock_payload: 빈 파일, 비정상 JSON
 * - release: pid 불일치 → no-op
 * - retries/retry_ms: sleep 경로
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
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

/** lock 경로를 알아내기 위한 헬퍼 */
async function get_lock_path(): Promise<string> {
  const h = await acquire_runtime_instance_lock({ workspace: test_dir });
  const { lock_path, key } = h;
  await h.release();
  return lock_path;
}

// ═══════════════════════════════════════════
// 기본 획득/해제
// ═══════════════════════════════════════════

describe("instance-lock — 기본 획득/해제", () => {
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
    expect(existsSync(lock_path)).toBe(false);
  });

  it("같은 workspace에서 두 번 호출 → 두 번째 acquired=false", async () => {
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

// ═══════════════════════════════════════════
// stale lock 처리
// ═══════════════════════════════════════════

describe("instance-lock — stale lock", () => {
  it("존재하지 않는 PID → unlink 후 재획득", async () => {
    const lock_path = await get_lock_path();
    const stale = JSON.stringify({ pid: 999999999, started_at: "old", cwd: "/" });
    await writeFile(lock_path, stale, "utf-8");

    const h = await acquire_runtime_instance_lock({ workspace: test_dir, retries: 3 });
    expect(h.acquired).toBe(true);
    await h.release();
  });

  it("pid=-1 (음수) → process_alive false → stale → 재획득", async () => {
    const lock_path = await get_lock_path();
    await writeFile(lock_path, JSON.stringify({ pid: -1, started_at: "old", cwd: "/" }), "utf-8");

    const h = await acquire_runtime_instance_lock({ workspace: test_dir, retries: 3 });
    expect(h.acquired).toBe(true);
    await h.release();
  });

  it("pid=0 → holder_pid=null → stale → 재획득", async () => {
    const lock_path = await get_lock_path();
    await writeFile(lock_path, JSON.stringify({ pid: 0, started_at: "old", cwd: "/" }), "utf-8");

    const h = await acquire_runtime_instance_lock({ workspace: test_dir, retries: 2 });
    expect(h.acquired).toBe(true);
    await h.release();
  });

  it("다른 hostname → stale → 재획득", async () => {
    const lock_path = await get_lock_path();
    const stale = JSON.stringify({
      pid: process.pid, started_at: "2024-01-01T00:00:00.000Z",
      cwd: "/other", hostname: "completely-different-host-xyz",
    });
    await writeFile(lock_path, stale, "utf-8");

    const h = await acquire_runtime_instance_lock({ workspace: test_dir, retries: 3 });
    expect(h.acquired).toBe(true);
    await h.release();
  });
});

// ═══════════════════════════════════════════
// read_lock_payload 비정상 데이터
// ═══════════════════════════════════════════

describe("instance-lock — read_lock_payload 비정상", () => {
  it("빈 파일 → null → stale → 재획득", async () => {
    const lock_path = await get_lock_path();
    await writeFile(lock_path, "", "utf-8");
    const h = await acquire_runtime_instance_lock({ workspace: test_dir, retries: 3 });
    expect(h.acquired).toBe(true);
    await h.release();
  });

  it("공백만 있는 파일 → null → stale → 재획득", async () => {
    const lock_path = await get_lock_path();
    await writeFile(lock_path, "   \n  ", "utf-8");
    const h = await acquire_runtime_instance_lock({ workspace: test_dir, retries: 3 });
    expect(h.acquired).toBe(true);
    await h.release();
  });

  it("배열 JSON → null → stale → 재획득", async () => {
    const lock_path = await get_lock_path();
    await writeFile(lock_path, JSON.stringify([1, 2, 3]), "utf-8");
    const h = await acquire_runtime_instance_lock({ workspace: test_dir, retries: 2 });
    expect(h.acquired).toBe(true);
    await h.release();
  });

  it("숫자 JSON → null → stale → 재획득", async () => {
    const lock_path = await get_lock_path();
    await writeFile(lock_path, "42", "utf-8");
    const h = await acquire_runtime_instance_lock({ workspace: test_dir, retries: 2 });
    expect(h.acquired).toBe(true);
    await h.release();
  });

  it("잘못된 JSON → catch → null → stale → 재획득", async () => {
    const lock_path = await get_lock_path();
    await writeFile(lock_path, "{invalid: json syntax}", "utf-8");
    const h = await acquire_runtime_instance_lock({ workspace: test_dir, retries: 2 });
    expect(h.acquired).toBe(true);
    await h.release();
  });
});

// ═══════════════════════════════════════════
// release: pid 불일치 → no-op
// ═══════════════════════════════════════════

describe("instance-lock — release pid 불일치", () => {
  it("다른 pid로 덮어쓴 후 release → 파일 유지 (no-op)", async () => {
    const h = await acquire_runtime_instance_lock({ workspace: test_dir });
    const other = JSON.stringify({ pid: 99999999, started_at: new Date().toISOString(), cwd: process.cwd(), key: h.key });
    await writeFile(h.lock_path, other, "utf-8");
    await h.release();
    const exists = await stat(h.lock_path).then(() => true).catch(() => false);
    expect(exists).toBe(true);
    await rm(h.lock_path, { force: true }).catch(() => {});
  });
});

// ═══════════════════════════════════════════
// retries/retry_ms
// ═══════════════════════════════════════════

describe("instance-lock — retries/retry_ms", () => {
  it("retries=1 → 1회 시도 후 즉시 포기", async () => {
    const h1 = await acquire_runtime_instance_lock({ workspace: test_dir });
    const start = Date.now();
    const h2 = await acquire_runtime_instance_lock({ workspace: test_dir, retries: 1, retry_ms: 50 });
    expect(h2.acquired).toBe(false);
    expect(Date.now() - start).toBeLessThan(200);
    await h1.release();
  });

  it("retries=2 → sleep 분기 커버 (1차 실패 → sleep → 2차 실패)", async () => {
    const h1 = await acquire_runtime_instance_lock({ workspace: test_dir });
    const h2 = await acquire_runtime_instance_lock({ workspace: test_dir, retries: 2, retry_ms: 10 });
    expect(h2.acquired).toBe(false);
    await h1.release();
  });
});
