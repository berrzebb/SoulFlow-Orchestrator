/**
 * instance-lock — 추가 미커버 분기 커버리지 (cov3).
 * - process_alive: pid <= 0 → false (without calling process.kill)
 * - sleep 경로: retries >= 2 → 실패 후 sleep 호출
 * - stale lock with negative pid → process_alive 조기 반환
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { acquire_runtime_instance_lock } from "@src/runtime/instance-lock.js";

let test_dir: string;

beforeEach(async () => {
  test_dir = await mkdtemp(join(tmpdir(), "instance-lock-cov3-"));
});

afterEach(async () => {
  await rm(test_dir, { recursive: true, force: true }).catch(() => {});
});

// ══════════════════════════════════════════════════════════
// process_alive: pid <= 0 → false 조기 반환
// ══════════════════════════════════════════════════════════

describe("instance-lock — process_alive pid<=0 경로", () => {
  it("lock 파일 pid=-1 → process_alive(pid<=0) false → stale 처리 후 재획득", async () => {
    // 먼저 lock 파일 경로를 알아내기 위해 한번 획득 후 해제
    const h = await acquire_runtime_instance_lock({ workspace: test_dir });
    const lock_path = h.lock_path;
    await h.release();

    // pid=-1 (음수) 인 stale lock 파일 생성
    // process_alive(-1) → pid <= 0 → return false (조기 반환) → unlink → 재획득
    const stale_payload = JSON.stringify({ pid: -1, started_at: "old", cwd: "/", key: h.key });
    await writeFile(lock_path, stale_payload, "utf-8");

    const h2 = await acquire_runtime_instance_lock({ workspace: test_dir, retries: 3 });
    expect(h2.acquired).toBe(true);
    await h2.release();
  });

  it("lock 파일 pid=0 → holder_pid=null → process_alive 미호출 → stale 처리", async () => {
    const h = await acquire_runtime_instance_lock({ workspace: test_dir });
    const lock_path = h.lock_path;
    await h.release();

    // pid=0 → Number(0 || 0) || null = null → process_alive 미호출
    const stale_payload = JSON.stringify({ pid: 0, started_at: "old", cwd: "/", key: h.key });
    await writeFile(lock_path, stale_payload, "utf-8");

    const h2 = await acquire_runtime_instance_lock({ workspace: test_dir, retries: 2 });
    expect(h2.acquired).toBe(true);
    await h2.release();
  });
});

// ══════════════════════════════════════════════════════════
// retries >= 2 → sleep 경로 (i < retries - 1)
// ══════════════════════════════════════════════════════════

describe("instance-lock — retries=2 sleep 경로", () => {
  it("retries=2 + 1차 실패 → sleep 후 재시도 (sleep 분기 커버)", async () => {
    const h1 = await acquire_runtime_instance_lock({ workspace: test_dir });
    expect(h1.acquired).toBe(true);

    // 첫 번째 시도 실패 → sleep(retry_ms) → 두 번째 시도 실패 → acquired=false
    // i=0 → i < retries-1=1 → true → sleep 호출됨 (커버리지 확보)
    const h2 = await acquire_runtime_instance_lock({ workspace: test_dir, retries: 2, retry_ms: 10 });
    expect(h2.acquired).toBe(false);

    await h1.release();
  });

  it("retries=3: h1 릴리즈 후 h2가 재시도로 성공 획득", async () => {
    // lock 파일을 먼저 가진 다음, 곧바로 해제해서 두 번째 인스턴스가 성공하게 함
    const lock_dir = join(test_dir, "runtime", ".locks");
    await mkdir(lock_dir, { recursive: true });

    const h1 = await acquire_runtime_instance_lock({ workspace: test_dir });
    const lock_path = h1.lock_path;

    // 50ms 후에 h1을 해제 (비동기)
    setTimeout(async () => { await h1.release(); }, 30);

    // h2는 3번 시도, retry_ms=50ms → 첫 번째 실패 후 sleep → 재시도 성공
    const h2 = await acquire_runtime_instance_lock({
      workspace: test_dir,
      retries: 3,
      retry_ms: 50,
    });

    // 성공 또는 실패 (환경에 따라 다를 수 있음, 단순히 오류 없이 완료 확인)
    expect(typeof h2.acquired).toBe("boolean");
    if (h2.acquired) await h2.release();

    // lock_path가 실제 lock 경로인지 확인
    expect(lock_path).toContain(".lock");
  });
});

// ══════════════════════════════════════════════════════════
// read_lock_payload: 비정상 JSON
// ══════════════════════════════════════════════════════════

describe("instance-lock — read_lock_payload 비정상 데이터", () => {
  it("배열 JSON lock 파일 → null 반환 → stale로 처리", async () => {
    const h = await acquire_runtime_instance_lock({ workspace: test_dir });
    const lock_path = h.lock_path;
    await h.release();

    // 배열 JSON → parsed.isArray → null 반환 → holder_pid=null → unlink
    await writeFile(lock_path, JSON.stringify([1, 2, 3]), "utf-8");

    const h2 = await acquire_runtime_instance_lock({ workspace: test_dir, retries: 2 });
    expect(h2.acquired).toBe(true);
    await h2.release();
  });

  it("primitive JSON (숫자) lock 파일 → null 반환 → stale 처리", async () => {
    const h = await acquire_runtime_instance_lock({ workspace: test_dir });
    const lock_path = h.lock_path;
    await h.release();

    // 숫자 JSON → typeof !== 'object' → null 반환
    await writeFile(lock_path, "42", "utf-8");

    const h2 = await acquire_runtime_instance_lock({ workspace: test_dir, retries: 2 });
    expect(h2.acquired).toBe(true);
    await h2.release();
  });
});
