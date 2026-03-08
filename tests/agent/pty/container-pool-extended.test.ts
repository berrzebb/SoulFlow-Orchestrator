/**
 * ContainerPool — ensure_running / touch / get / remove / cleanup / shutdown / reconcile 커버리지.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ContainerPool } from "@src/agent/pty/container-pool.js";
import type { Pty, Disposable } from "@src/agent/pty/types.js";

// ── 헬퍼 ────────────────────────────────────────

function make_pty(pid = "1234"): Pty & { exit_handlers: Array<(e: { exitCode: number }) => void> } {
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

function make_factory(ptys: ReturnType<typeof make_pty>[] = []) {
  let idx = 0;
  return vi.fn().mockImplementation(() => {
    return ptys[idx++] ?? make_pty(`pid-${idx}`);
  });
}

function make_adapter() {
  return {
    cli_id: "claude",
    stdin_mode: "close" as const,
    build_args: vi.fn().mockReturnValue(["--arg"]),
    parse_output: vi.fn(),
    format_input: vi.fn().mockReturnValue("input"),
  };
}

function make_logger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function make_pool(overrides: Partial<ConstructorParameters<typeof ContainerPool>[0]> = {}) {
  const pty = make_pty();
  const factory = make_factory([pty]);
  const adapter = make_adapter();
  const logger = make_logger();
  const pool = new ContainerPool({
    pty_factory: factory,
    adapter,
    default_env: { BASE: "val" },
    cwd: "/tmp/ws",
    max_idle_ms: 0, // 기본: 정리 타이머 없음
    logger,
    ...overrides,
  });
  return { pool, pty, factory, adapter, logger };
}

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.useRealTimers(); });

// ══════════════════════════════════════════
// ensure_running
// ══════════════════════════════════════════

describe("ContainerPool — ensure_running", () => {
  it("첫 요청 → factory 호출 + pty 반환", () => {
    const { pool, pty, factory } = make_pool();
    const result = pool.ensure_running("session-1");
    expect(factory).toHaveBeenCalledOnce();
    expect(result).toBe(pty);
  });

  it("같은 세션 → factory 재호출 없음", () => {
    const { pool, pty, factory } = make_pool();
    pool.ensure_running("session-1");
    const second = pool.ensure_running("session-1");
    expect(factory).toHaveBeenCalledOnce();
    expect(second).toBe(pty);
  });

  it("다른 세션 → 각각 factory 호출", () => {
    const pty1 = make_pty("pid-1");
    const pty2 = make_pty("pid-2");
    const factory = make_factory([pty1, pty2]);
    const { pool } = make_pool({ pty_factory: factory });
    const r1 = pool.ensure_running("session-a");
    const r2 = pool.ensure_running("session-b");
    expect(factory).toHaveBeenCalledTimes(2);
    expect(r1).toBe(pty1);
    expect(r2).toBe(pty2);
  });

  it("env 병합: default_env + 추가 env", () => {
    const { pool, factory } = make_pool();
    pool.ensure_running("session-1", undefined, { EXTRA: "extra" });
    expect(factory).toHaveBeenCalledWith(
      "claude",
      expect.any(Array),
      expect.objectContaining({ env: expect.objectContaining({ BASE: "val", EXTRA: "extra" }) }),
    );
  });

  it("pty.onExit 발생 → pool에서 자동 제거", () => {
    const { pool, pty } = make_pool();
    pool.ensure_running("session-1");
    expect(pool.size).toBe(1);
    pty.exit_handlers[0]({ exitCode: 0 });
    expect(pool.size).toBe(0);
  });
});

// ══════════════════════════════════════════
// touch / get
// ══════════════════════════════════════════

describe("ContainerPool — touch / get", () => {
  it("touch: 존재하는 세션 → last_activity 갱신 (에러 없음)", () => {
    const { pool } = make_pool();
    pool.ensure_running("s1");
    expect(() => pool.touch("s1")).not.toThrow();
  });

  it("touch: 없는 세션 → 에러 없음", () => {
    const { pool } = make_pool();
    expect(() => pool.touch("nonexistent")).not.toThrow();
  });

  it("get: 존재 → pty 반환", () => {
    const { pool, pty } = make_pool();
    pool.ensure_running("s1");
    expect(pool.get("s1")).toBe(pty);
  });

  it("get: 없음 → null", () => {
    const { pool } = make_pool();
    expect(pool.get("s1")).toBeNull();
  });
});

// ══════════════════════════════════════════
// remove
// ══════════════════════════════════════════

describe("ContainerPool — remove", () => {
  it("remove: pty.kill() + pool에서 제거", async () => {
    const { pool, pty } = make_pool();
    pool.ensure_running("s1");
    await pool.remove("s1");
    expect(pty.kill).toHaveBeenCalledOnce();
    expect(pool.size).toBe(0);
  });

  it("remove: 없는 세션 → 에러 없음", async () => {
    const { pool } = make_pool();
    await expect(pool.remove("nonexistent")).resolves.not.toThrow();
  });
});

// ══════════════════════════════════════════
// list_sessions / size
// ══════════════════════════════════════════

describe("ContainerPool — list_sessions / size", () => {
  it("size: 초기 0", () => {
    const { pool } = make_pool();
    expect(pool.size).toBe(0);
  });

  it("list_sessions: 등록된 세션 포함", () => {
    const { pool } = make_pool();
    pool.ensure_running("s-alpha");
    expect(pool.list_sessions()).toContain("s-alpha");
    expect(pool.size).toBe(1);
  });
});

// ══════════════════════════════════════════
// cleanup
// ══════════════════════════════════════════

describe("ContainerPool — cleanup", () => {
  it("max_idle_ms=0 → cleanup() 아무것도 안 함", () => {
    const { pool, pty } = make_pool({ max_idle_ms: 0 });
    pool.ensure_running("s1");
    pool.cleanup();
    expect(pty.kill).not.toHaveBeenCalled();
  });

  it("유휴 초과 → kill + 제거", async () => {
    vi.useFakeTimers();
    const { pool, pty } = make_pool({ max_idle_ms: 100 });
    pool.ensure_running("s1");
    await vi.advanceTimersByTimeAsync(200);
    pool.cleanup();
    expect(pty.kill).toHaveBeenCalled();
    expect(pool.size).toBe(0);
  });

  it("유휴 미초과 → 제거 안 함", () => {
    const { pool, pty } = make_pool({ max_idle_ms: 10000 });
    pool.ensure_running("s1");
    pool.cleanup();
    expect(pty.kill).not.toHaveBeenCalled();
    expect(pool.size).toBe(1);
  });
});

// ══════════════════════════════════════════
// shutdown
// ══════════════════════════════════════════

describe("ContainerPool — shutdown", () => {
  it("모든 pty kill + pool 비움", async () => {
    const pty1 = make_pty("p1");
    const pty2 = make_pty("p2");
    const factory = make_factory([pty1, pty2]);
    const { pool } = make_pool({ pty_factory: factory });
    pool.ensure_running("s1");
    pool.ensure_running("s2");
    await pool.shutdown();
    expect(pty1.kill).toHaveBeenCalledOnce();
    expect(pty2.kill).toHaveBeenCalledOnce();
    expect(pool.size).toBe(0);
  });
});

// ══════════════════════════════════════════
// reconcile
// ══════════════════════════════════════════

describe("ContainerPool — reconcile", () => {
  it("is_alive_fn → 죽은 프로세스 정리", async () => {
    const pty = make_pty("container-abc");
    const factory = make_factory([pty]);
    const is_alive = vi.fn().mockResolvedValue(false);
    const { pool } = make_pool({ pty_factory: factory, is_alive });

    pool.ensure_running("s1");
    const result = await pool.reconcile();
    expect(result.cleaned).toContain("s1");
    expect(pool.size).toBe(0);
  });

  it("is_alive_fn → 살아있는 프로세스 유지", async () => {
    const pty = make_pty("container-alive");
    const factory = make_factory([pty]);
    const is_alive = vi.fn().mockResolvedValue(true);
    const { pool } = make_pool({ pty_factory: factory, is_alive });

    pool.ensure_running("s1");
    const result = await pool.reconcile();
    expect(result.cleaned).toHaveLength(0);
    expect(pool.size).toBe(1);
  });

  it("is_alive_fn 없음 → pid가 숫자가 아닌 경우 false(정리)", async () => {
    const pty = make_pty("not-a-number"); // 컨테이너 ID 형태
    const factory = make_factory([pty]);
    const { pool } = make_pool({ pty_factory: factory, is_alive: undefined });

    pool.ensure_running("s1");
    const result = await pool.reconcile();
    // pid가 숫자 아닌 경우 is_process_alive → false → cleaned
    expect(result.cleaned).toContain("s1");
  });

  it("빈 pool → reconcile 결과 모두 빈 배열", async () => {
    const { pool } = make_pool();
    const result = await pool.reconcile();
    expect(result.cleaned).toHaveLength(0);
    expect(result.reattached).toHaveLength(0);
    expect(result.orphaned).toHaveLength(0);
  });
});

// ══════════════════════════════════════════
// max_idle_ms > 0 → cleanup_timer 설정
// ══════════════════════════════════════════

describe("ContainerPool — max_idle_ms > 0", () => {
  it("cleanup_timer 설정 → shutdown으로 정리", async () => {
    const pty = make_pty("p1");
    const factory = make_factory([pty]);
    const logger = make_logger();
    const pool = new ContainerPool({
      pty_factory: factory,
      adapter: make_adapter(),
      default_env: {},
      cwd: "/tmp",
      max_idle_ms: 30000, // 긴 시간 (자동 발동 안 됨)
      logger,
    });
    pool.ensure_running("s1");
    expect(pool.size).toBe(1);
    // shutdown이 타이머를 정리하고 pool을 비움
    await pool.shutdown();
    expect(pty.kill).toHaveBeenCalled();
    expect(pool.size).toBe(0);
  });

  it("유휴 시간 초과 → cleanup() 직접 호출 시 정리", async () => {
    vi.useFakeTimers();
    const pty = make_pty("p1");
    const factory = make_factory([pty]);
    const logger = make_logger();
    const pool = new ContainerPool({
      pty_factory: factory,
      adapter: make_adapter(),
      default_env: {},
      cwd: "/tmp",
      max_idle_ms: 100,
      logger,
    });
    pool.ensure_running("s1");
    // 시간을 200ms 진행시켜 idle 기준 초과
    vi.advanceTimersByTime(200);
    pool.cleanup();
    expect(pty.kill).toHaveBeenCalled();
    expect(pool.size).toBe(0);
    await pool.shutdown();
  });
});
