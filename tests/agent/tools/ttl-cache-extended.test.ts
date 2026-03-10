/**
 * TtlCacheTool — 미커버 경로 보충.
 * unsupported operation, evict_lru (500개 항목 초과 시 LRU 제거).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { CacheTool } from "../../../src/agent/tools/ttl-cache.js";

// ══════════════════════════════════════════
// unsupported operation
// ══════════════════════════════════════════

describe("TtlCacheTool — unsupported operation", () => {
  it("알 수 없는 operation → Error 반환", async () => {
    const t = new CacheTool();
    const r = await t.execute({ operation: "nonexistent_op", key: "k" }, {} as any);
    expect(r).toContain("unsupported operation");
  });
});

// ══════════════════════════════════════════
// evict_lru — MAX_ENTRIES(500) 초과 시 LRU 제거
// ══════════════════════════════════════════

describe("TtlCacheTool — evict_lru (MAX_ENTRIES 초과)", () => {
  it("501번째 새 키 set 시 가장 오래된 LRU 항목 제거", async () => {
    const t = new CacheTool();
    const store = (t as any).store as Map<string, { value: string; expires_at: number; created_at: number; hits: number }>;

    // 500개 항목을 직접 store에 삽입 (LRU 대상 = created_at 가장 오래된 것)
    const far_past = Date.now() - 10_000; // 10초 전
    store.set("lru-target", { value: "old", expires_at: Infinity, created_at: far_past, hits: 0 });
    for (let i = 1; i < 500; i++) {
      store.set(`fill-${i}`, { value: "x", expires_at: Infinity, created_at: Date.now(), hits: 0 });
    }
    expect(store.size).toBe(500);

    // 501번째 새 키 → evict_lru 호출 → lru-target 제거
    await t.execute({ operation: "set", key: "new-key-501", value: "new" }, {} as any);

    expect(store.size).toBe(500); // 여전히 500개
    expect(store.has("lru-target")).toBe(false); // 가장 오래된 항목 제거됨
    expect(store.has("new-key-501")).toBe(true); // 새 항목 추가됨
  });

  it("evict_lru: store 빈 경우에도 에러 없음", async () => {
    const t = new CacheTool();
    // 직접 evict_lru 호출 (store가 비어있어도 안전해야 함)
    expect(() => (t as any).evict_lru()).not.toThrow();
  });
});

// ══════════════════════════════════════════
// 미커버 분기 보충
// ══════════════════════════════════════════

describe("CacheTool — 미커버 분기", () => {
  it("set: value > MAX_VALUE_SIZE → Error (L43)", async () => {
    const t = new CacheTool();
    const big = "x".repeat(1024 * 256 + 1); // 256KB + 1
    const r = String(await t.execute({ operation: "set", key: "big", value: big }));
    expect(r).toContain("Error");
    expect(r).toContain("exceeds");
  });

  it("get: key 없음 → Error (L53)", async () => {
    const t = new CacheTool();
    const r = String(await t.execute({ operation: "get" }));
    expect(r).toContain("Error");
  });

  it("get: evict_expired 통과 후 만료 → L57 delete (Date.now mock)", async () => {
    const t = new CacheTool();
    const store = (t as any).store as Map<string, { value: string; expires_at: number; created_at: number; hits: number }>;
    const T = 1_000_000;
    // entry expires at T+50 (valid during evict_expired at T, expired during get at T+100)
    store.set("race-key", { value: "v", expires_at: T + 50, created_at: T - 100, hits: 0 });
    let call_n = 0;
    vi.spyOn(Date, "now").mockImplementation(() => call_n++ === 0 ? T : T + 100);
    const r = String(await t.execute({ operation: "get", key: "race-key" }));
    vi.restoreAllMocks();
    expect(r).toContain("Error");
    expect(store.has("race-key")).toBe(false); // L57: 삭제됨
  });

  it("invalidate: key 없음 → Error (L66)", async () => {
    const t = new CacheTool();
    const r = String(await t.execute({ operation: "invalidate" }));
    expect(r).toContain("Error");
  });

  it("has: key 없음 → Error (L71)", async () => {
    const t = new CacheTool();
    const r = String(await t.execute({ operation: "has" }));
    expect(r).toContain("Error");
  });

  it("stats: evict_expired 통과 후 만료 → expired 카운트 (L83, Date.now mock)", async () => {
    const t = new CacheTool();
    const store = (t as any).store as Map<string, { value: string; expires_at: number; created_at: number; hits: number }>;
    const T = 2_000_000;
    // entry expires at T+50 → valid during evict_expired(T), expired during stats loop(T+100)
    store.set("semi-expired", { value: "v", expires_at: T + 50, created_at: T - 100, hits: 0 });
    let call_n = 0;
    vi.spyOn(Date, "now").mockImplementation(() => call_n++ === 0 ? T : T + 100);
    const r = JSON.parse(String(await t.execute({ operation: "stats" })));
    vi.restoreAllMocks();
    expect(r.expired).toBe(1); // L83: expired++ 실행됨
  });

  it("evict_expired: 만료 항목 실제 삭제 (L112)", async () => {
    const t = new CacheTool();
    const store = (t as any).store as Map<string, { value: string; expires_at: number; created_at: number; hits: number }>;
    store.set("old", { value: "v", expires_at: Date.now() - 1000, created_at: Date.now() - 2000, hits: 0 });
    expect(store.has("old")).toBe(true);
    // run() 호출 시 evict_expired 실행 → old 삭제
    await t.execute({ operation: "keys" });
    expect(store.has("old")).toBe(false); // L112: 삭제됨
  });
});
