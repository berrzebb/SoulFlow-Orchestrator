/**
 * ContainerPool — 미커버 분기 (cov):
 * - L178-180: is_process_alive try — process.kill 성공 → true
 * - L181-182: is_process_alive catch — process.kill 실패 (ESRCH) → false
 */
import { describe, it, expect, vi } from "vitest";
import { ContainerPool } from "@src/agent/pty/container-pool.js";
import type { Pty, Disposable } from "@src/agent/pty/types.js";

function make_pty(pid: string): Pty {
  return {
    pid,
    kill: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    onData: vi.fn().mockReturnValue({ dispose: vi.fn() } as Disposable),
    onExit: vi.fn().mockReturnValue({ dispose: vi.fn() } as Disposable),
  };
}

function make_pool(pid: string) {
  const pty = make_pty(pid);
  const factory = vi.fn().mockReturnValue(pty);
  const adapter = {
    cli_id: "claude",
    stdin_mode: "close" as const,
    build_args: vi.fn().mockReturnValue(["--arg"]),
    parse_output: vi.fn(),
    format_input: vi.fn().mockReturnValue("input"),
  };
  const pool = new ContainerPool({
    pty_factory: factory,
    adapter,
    workspace: "/tmp",
    max_pool_size: 5,
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
    // is_alive_fn 미설정 → is_process_alive() 사용
  });
  return { pool };
}

// ── L181-182: process.kill(pid, 0) → ESRCH → catch → false ────────────────

describe("ContainerPool.is_process_alive — L181-182: 존재하지 않는 PID → catch", () => {
  it("존재하지 않는 숫자 PID → process.kill ESRCH → catch → false → reconcile cleaned", async () => {
    // 매우 큰 PID (존재하지 않을 것으로 예상)
    const { pool } = make_pool("999999999");
    pool.ensure_running("s1");
    const result = await pool.reconcile();
    // process.kill(999999999, 0) → ESRCH → catch → false → cleaned
    expect(result.cleaned).toContain("s1");
    await pool.shutdown();
  });
});

// ── L178-180: process.kill(pid, 0) 성공 → alive=true → 정리 안 됨 ──────────

describe("ContainerPool.is_process_alive — L178-180: 현재 프로세스 PID → 살아있음", () => {
  it("현재 프로세스 PID → process.kill 성공 → alive=true → cleaned 없음", async () => {
    // 현재 Node.js 프로세스의 PID는 항상 살아있음
    const { pool } = make_pool(String(process.pid));
    pool.ensure_running("s2");
    const result = await pool.reconcile();
    // 현재 프로세스가 살아있으므로 cleaned에 포함 안 됨
    expect(result.cleaned).not.toContain("s2");
    await pool.shutdown();
  });
});
