/**
 * instance-lock — 추가 미커버 분기 커버리지 (cov4):
 * - L31: 다른 hostname → stale lock 처리 후 재획득
 * - L61-62: 빈 lock 파일 → read_lock_payload null 반환
 * - L137: release() 시 pid 불일치 → early return
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { acquire_runtime_instance_lock } from "@src/runtime/instance-lock.js";

let test_dir: string;

beforeEach(async () => {
  test_dir = await mkdtemp(join(tmpdir(), "instance-lock-cov4-"));
});

afterEach(async () => {
  await rm(test_dir, { recursive: true, force: true }).catch(() => {});
});

// ══════════════════════════════════════════════════════════
// L31: 다른 hostname → stale lock → 재획득
// ══════════════════════════════════════════════════════════

describe("instance-lock — 다른 hostname stale lock (L31)", () => {
  it("lock 파일 hostname이 다름 → stale → 재획득 성공", async () => {
    // 먼저 lock 경로 알아내기
    const h = await acquire_runtime_instance_lock({ workspace: test_dir });
    const lock_path = h.lock_path;
    await h.release();

    // 다른 hostname의 lock 파일 생성 (hostname !== PROCESS_HOSTNAME)
    const stale_payload = JSON.stringify({
      pid: process.pid,       // 현재 PID (살아있는 프로세스)
      started_at: "2024-01-01T00:00:00.000Z",
      cwd: "/other/path",
      key: h.key,
      hostname: "completely-different-host-xyz",  // 다른 hostname → L31 실행
    });
    await writeFile(lock_path, stale_payload, "utf-8");

    // 다른 hostname → is_stale_lock returns true → 재획득
    const h2 = await acquire_runtime_instance_lock({ workspace: test_dir, retries: 3 });
    expect(h2.acquired).toBe(true);
    await h2.release();
  });
});

// ══════════════════════════════════════════════════════════
// L61-62: 빈 lock 파일 → read_lock_payload null 반환
// ══════════════════════════════════════════════════════════

describe("instance-lock — 빈 lock 파일 (L61-62)", () => {
  it("lock 파일 내용이 빈 문자열 → null 반환 → stale 처리 → 재획득", async () => {
    // lock 파일 경로 알아내기
    const h = await acquire_runtime_instance_lock({ workspace: test_dir });
    const lock_path = h.lock_path;
    await h.release();

    // 빈 파일 작성 (raw.trim() === "" → return null at L62)
    await writeFile(lock_path, "", "utf-8");

    // 빈 파일 → read_lock_payload null → stale → 재획득
    const h2 = await acquire_runtime_instance_lock({ workspace: test_dir, retries: 3 });
    expect(h2.acquired).toBe(true);
    await h2.release();
  });

  it("lock 파일 내용이 공백만 있음 → trim() 후 빈 → null 반환 → 재획득", async () => {
    const h = await acquire_runtime_instance_lock({ workspace: test_dir });
    const lock_path = h.lock_path;
    await h.release();

    // 공백만 있는 파일
    await writeFile(lock_path, "   \n  ", "utf-8");

    const h2 = await acquire_runtime_instance_lock({ workspace: test_dir, retries: 3 });
    expect(h2.acquired).toBe(true);
    await h2.release();
  });
});

// ══════════════════════════════════════════════════════════
// L137: release() 시 payload.pid !== process.pid → early return
// ══════════════════════════════════════════════════════════

describe("instance-lock — release() pid 불일치 (L137)", () => {
  it("release() 시 lock 파일 pid가 현재 PID와 다름 → early return (파일 유지)", async () => {
    const h = await acquire_runtime_instance_lock({ workspace: test_dir });
    expect(h.acquired).toBe(true);

    // lock 파일을 다른 PID로 덮어씀 (release가 pid 불일치로 삭제 안 함)
    const different_pid_payload = JSON.stringify({
      pid: 99999999,   // 현재 PID와 다른 값 (process.pid != 99999999)
      started_at: new Date().toISOString(),
      cwd: process.cwd(),
      key: h.key,
    });
    await writeFile(h.lock_path, different_pid_payload, "utf-8");

    // release() → payload.pid(99999999) !== process.pid → early return (L137)
    await h.release();

    // 파일이 여전히 존재함 (삭제되지 않음)
    const { stat } = await import("node:fs/promises");
    const exists = await stat(h.lock_path).then(() => true).catch(() => false);
    expect(exists).toBe(true);

    // 정리
    await rm(h.lock_path, { force: true }).catch(() => {});
  });
});
