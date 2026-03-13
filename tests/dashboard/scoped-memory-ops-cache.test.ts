/**
 * ScopedMemoryOpsCache — per-user MemoryStore 캐싱 + DashboardMemoryOps 생성 테스트.
 */
import { describe, it, expect, vi } from "vitest";
import { ScopedMemoryOpsCache } from "@src/dashboard/ops/memory.ts";
import type { MemoryStoreLike } from "@src/agent/memory.types.ts";

function make_mock_store(): MemoryStoreLike {
  return {
    list_daily: vi.fn(async () => ["2026-03-13"]),
    read_longterm: vi.fn(async () => "longterm content"),
    write_longterm: vi.fn(async () => {}),
    append_longterm: vi.fn(async () => {}),
    read_daily: vi.fn(async () => "daily content"),
    write_daily: vi.fn(async () => {}),
    append_daily: vi.fn(async () => {}),
    search: vi.fn(async () => []),
  };
}

describe("ScopedMemoryOpsCache", () => {
  it("동일 경로에 대해 동일 ops 인스턴스 반환 (캐시)", () => {
    const factory = vi.fn(make_mock_store);
    const cache = new ScopedMemoryOpsCache(factory);

    const ops1 = cache.get("/users/u1");
    const ops2 = cache.get("/users/u1");
    expect(ops1).toBe(ops2);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("다른 경로에 대해 다른 ops 인스턴스 생성", () => {
    const factory = vi.fn(make_mock_store);
    const cache = new ScopedMemoryOpsCache(factory);

    const ops1 = cache.get("/users/u1");
    const ops2 = cache.get("/users/u2");
    expect(ops1).not.toBe(ops2);
    expect(factory).toHaveBeenCalledTimes(2);
    expect(factory).toHaveBeenCalledWith("/users/u1");
    expect(factory).toHaveBeenCalledWith("/users/u2");
  });

  it("생성된 ops가 store 메서드를 위임", async () => {
    const store = make_mock_store();
    const cache = new ScopedMemoryOpsCache(() => store);
    const ops = cache.get("/users/u1");

    const longterm = await ops.read_longterm();
    expect(longterm).toBe("longterm content");
    expect(store.read_longterm).toHaveBeenCalled();

    await ops.write_longterm("new content");
    expect(store.write_longterm).toHaveBeenCalledWith("new content");

    const days = await ops.list_daily();
    expect(days).toEqual(["2026-03-13"]);

    const daily = await ops.read_daily("2026-03-13");
    expect(daily).toBe("daily content");

    await ops.write_daily("new daily", "2026-03-13");
    expect(store.write_daily).toHaveBeenCalledWith("new daily", "2026-03-13");
  });

  it("clear() → 캐시 초기화, 이후 새 인스턴스 생성", () => {
    const factory = vi.fn(make_mock_store);
    const cache = new ScopedMemoryOpsCache(factory);

    const ops1 = cache.get("/users/u1");
    cache.clear();
    const ops2 = cache.get("/users/u1");
    expect(ops1).not.toBe(ops2);
    expect(factory).toHaveBeenCalledTimes(2);
  });
});
