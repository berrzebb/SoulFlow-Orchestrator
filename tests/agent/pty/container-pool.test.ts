import { describe, it, expect, afterEach } from "vitest";
import { ContainerPool } from "@src/agent/pty/container-pool.ts";
import { ClaudeCliAdapter } from "@src/agent/pty/cli-adapter.ts";
import { local_pty_factory } from "@src/agent/pty/local-pty.ts";
import { create_noop_logger } from "@helpers/harness.ts";

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
