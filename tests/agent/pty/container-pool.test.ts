import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { ContainerPool } from "@src/agent/pty/container-pool.ts";
import { ClaudeCliAdapter } from "@src/agent/pty/cli-adapter.ts";
import { local_pty_factory } from "@src/agent/pty/local-pty.ts";
import { create_noop_logger } from "@helpers/harness.ts";
import type { Pty, Disposable } from "@src/agent/pty/types.js";

function create_pool(opts?: { max_idle_ms?: number }) {
  return new ContainerPool({
    pty_factory: local_pty_factory,
    adapter: new ClaudeCliAdapter(),
    default_env: {},
    cwd: process.cwd(),
    max_idle_ms: opts?.max_idle_ms ?? 0,
    logger: create_noop_logger(),
  });
}

describe("ContainerPool", () => {
  let pool: ContainerPool;
  afterEach(async () => { await pool?.shutdown(); });

  it("ensure_running으로 Pty를 생성한다", () => {
    pool = create_pool();
    // node -e "setTimeout(()=>{},5000)" — 5초간 유지
    const pty = pool.ensure_running("test-1");
    expect(pty).toBeDefined();
    expect(pty.pid).toBeDefined();
    expect(pool.size).toBe(1);
  });

  it("같은 세션 키는 기존 Pty를 재사용한다", () => {
    pool = create_pool();
    const a = pool.ensure_running("test-2");
    const b = pool.ensure_running("test-2");
    expect(a.pid).toBe(b.pid);
    expect(pool.size).toBe(1);
  });

  it("다른 세션 키는 별도 Pty를 생성한다", () => {
    pool = create_pool();
    pool.ensure_running("s1");
    pool.ensure_running("s2");
    expect(pool.size).toBe(2);
  });

  it("get으로 기존 Pty를 조회한다", () => {
    pool = create_pool();
    expect(pool.get("not-exist")).toBeNull();
    pool.ensure_running("s1");
    expect(pool.get("s1")).not.toBeNull();
  });

  it("remove로 Pty를 제거한다", async () => {
    pool = create_pool();
    pool.ensure_running("s1");
    await pool.remove("s1");
    expect(pool.get("s1")).toBeNull();
    expect(pool.size).toBe(0);
  });

  it("list_sessions로 활성 세션 목록을 반환한다", () => {
    pool = create_pool();
    pool.ensure_running("a");
    pool.ensure_running("b");
    expect(pool.list_sessions().sort()).toEqual(["a", "b"]);
  });

  it("프로세스 종료 시 자동으로 pool에서 제거된다", async () => {
    pool = create_pool();
    const pty = pool.ensure_running("auto-exit");
    pty.kill();
    // 종료 이벤트 처리 대기
    await new Promise((r) => setTimeout(r, 200));
    expect(pool.get("auto-exit")).toBeNull();
  });

  it("shutdown으로 모든 Pty를 종료한다", async () => {
    pool = create_pool();
    pool.ensure_running("x1");
    pool.ensure_running("x2");
    await pool.shutdown();
    expect(pool.size).toBe(0);
  });
});

// ── is_process_alive 분기 테스트용 헬퍼 ──────────────────────────────────────

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

function make_pool_with_mock_pty(pid: string) {
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
    const { pool } = make_pool_with_mock_pty("999999999");
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
    const { pool } = make_pool_with_mock_pty(String(process.pid));
    pool.ensure_running("s2");
    const result = await pool.reconcile();
    // 현재 프로세스가 살아있으므로 cleaned에 포함 안 됨
    expect(result.cleaned).not.toContain("s2");
    await pool.shutdown();
  });
});

// ══════════════════════════════════════════
// Mock-based extended coverage
// ══════════════════════════════════════════

function make_ext_pty(pid = "1234"): Pty & { exit_handlers: Array<(e: { exitCode: number }) => void> } {
  const exit_handlers: Array<(e: { exitCode: number }) => void> = [];
  return {
    pid,
    kill: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    onData: vi.fn().mockReturnValue({ dispose: vi.fn() } as Disposable),
    onExit: vi.fn().mockImplementation((fn) => {
      exit_handlers.push(fn);
      return { dispose: vi.fn() } as Disposable;
    }),
    exit_handlers,
  };
}

function make_ext_factory(ptys: ReturnType<typeof make_ext_pty>[] = []) {
  let idx = 0;
  return vi.fn().mockImplementation(() => {
    return ptys[idx++] ?? make_ext_pty(`pid-${idx}`);
  });
}

function make_ext_adapter() {
  return {
    cli_id: "claude",
    stdin_mode: "close" as const,
    build_args: vi.fn().mockReturnValue(["--arg"]),
    parse_output: vi.fn(),
    format_input: vi.fn().mockReturnValue("input"),
  };
}

function make_ext_logger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function make_ext_pool(overrides: Partial<ConstructorParameters<typeof ContainerPool>[0]> = {}) {
  const pty = make_ext_pty();
  const factory = make_ext_factory([pty]);
  const adapter = make_ext_adapter();
  const logger = make_ext_logger();
  const pool = new ContainerPool({
    pty_factory: factory,
    adapter,
    default_env: { BASE: "val" },
    cwd: "/tmp/ws",
    max_idle_ms: 0,
    logger,
    ...overrides,
  });
  return { pool, pty, factory, adapter, logger };
}

describe("ContainerPool — env 병합", () => {
  it("env 병합: default_env + 추가 env", () => {
    const { pool, factory } = make_ext_pool();
    pool.ensure_running("session-1", undefined, { EXTRA: "extra" });
    expect(factory).toHaveBeenCalledWith(
      "claude",
      expect.any(Array),
      expect.objectContaining({ env: expect.objectContaining({ BASE: "val", EXTRA: "extra" }) }),
    );
  });
});

describe("ContainerPool — touch", () => {
  it("touch: 존재하는 세션 → last_activity 갱신 (에러 없음)", () => {
    const { pool } = make_ext_pool();
    pool.ensure_running("s1");
    expect(() => pool.touch("s1")).not.toThrow();
  });

  it("touch: 없는 세션 → 에러 없음", () => {
    const { pool } = make_ext_pool();
    expect(() => pool.touch("nonexistent")).not.toThrow();
  });
});

describe("ContainerPool — cleanup mock-based", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("max_idle_ms=0 → cleanup() 아무것도 안 함", () => {
    const { pool, pty } = make_ext_pool({ max_idle_ms: 0 });
    pool.ensure_running("s1");
    pool.cleanup();
    expect(pty.kill).not.toHaveBeenCalled();
  });

  it("유휴 초과 → kill + 제거", async () => {
    vi.useFakeTimers();
    const { pool, pty } = make_ext_pool({ max_idle_ms: 100 });
    pool.ensure_running("s1");
    await vi.advanceTimersByTimeAsync(200);
    pool.cleanup();
    expect(pty.kill).toHaveBeenCalled();
    expect(pool.size).toBe(0);
  });

  it("유휴 미초과 → 제거 안 함", () => {
    const { pool, pty } = make_ext_pool({ max_idle_ms: 10000 });
    pool.ensure_running("s1");
    pool.cleanup();
    expect(pty.kill).not.toHaveBeenCalled();
    expect(pool.size).toBe(1);
  });
});

describe("ContainerPool — reconcile mock-based", () => {
  it("is_alive_fn → 죽은 프로세스 정리", async () => {
    const pty = make_ext_pty("container-abc");
    const factory = make_ext_factory([pty]);
    const is_alive = vi.fn().mockResolvedValue(false);
    const { pool } = make_ext_pool({ pty_factory: factory, is_alive });

    pool.ensure_running("s1");
    const result = await pool.reconcile();
    expect(result.cleaned).toContain("s1");
    expect(pool.size).toBe(0);
  });

  it("is_alive_fn → 살아있는 프로세스 유지", async () => {
    const pty = make_ext_pty("container-alive");
    const factory = make_ext_factory([pty]);
    const is_alive = vi.fn().mockResolvedValue(true);
    const { pool } = make_ext_pool({ pty_factory: factory, is_alive });

    pool.ensure_running("s1");
    const result = await pool.reconcile();
    expect(result.cleaned).toHaveLength(0);
    expect(pool.size).toBe(1);
  });

  it("is_alive_fn 없음 → pid가 숫자가 아닌 경우 false(정리)", async () => {
    const pty = make_ext_pty("not-a-number");
    const factory = make_ext_factory([pty]);
    const { pool } = make_ext_pool({ pty_factory: factory, is_alive: undefined });

    pool.ensure_running("s1");
    const result = await pool.reconcile();
    expect(result.cleaned).toContain("s1");
  });

  it("빈 pool → reconcile 결과 모두 빈 배열", async () => {
    const { pool } = make_ext_pool();
    const result = await pool.reconcile();
    expect(result.cleaned).toHaveLength(0);
    expect(result.reattached).toHaveLength(0);
    expect(result.orphaned).toHaveLength(0);
  });
});

describe("ContainerPool — max_idle_ms > 0 timer", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("cleanup_timer 설정 → shutdown으로 정리", async () => {
    const pty = make_ext_pty("p1");
    const factory = make_ext_factory([pty]);
    const logger = make_ext_logger();
    const pool = new ContainerPool({
      pty_factory: factory,
      adapter: make_ext_adapter(),
      default_env: {},
      cwd: "/tmp",
      max_idle_ms: 30000,
      logger,
    });
    pool.ensure_running("s1");
    expect(pool.size).toBe(1);
    await pool.shutdown();
    expect(pty.kill).toHaveBeenCalled();
    expect(pool.size).toBe(0);
  });

  it("유휴 시간 초과 → cleanup() 직접 호출 시 정리", async () => {
    vi.useFakeTimers();
    const pty = make_ext_pty("p1");
    const factory = make_ext_factory([pty]);
    const logger = make_ext_logger();
    const pool = new ContainerPool({
      pty_factory: factory,
      adapter: make_ext_adapter(),
      default_env: {},
      cwd: "/tmp",
      max_idle_ms: 100,
      logger,
    });
    pool.ensure_running("s1");
    vi.advanceTimersByTime(200);
    pool.cleanup();
    expect(pty.kill).toHaveBeenCalled();
    expect(pool.size).toBe(0);
    await pool.shutdown();
  });
});
