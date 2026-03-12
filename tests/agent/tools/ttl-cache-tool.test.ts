/**
 * CacheTool (TTL Cache) — set/get/invalidate/has/keys/stats/clear 테스트.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { CacheTool } from "../../../src/agent/tools/ttl-cache.js";

// 각 테스트가 독립적인 캐시 인스턴스 사용
function make_tool() { return new CacheTool(); }

describe("CacheTool — set & get", () => {
  it("값 저장 후 조회", async () => {
    const tool = make_tool();
    await tool.execute({ operation: "set", key: "foo", value: "bar", ttl_ms: 60000 });
    const r = String(await tool.execute({ operation: "get", key: "foo" }));
    expect(r).toBe("bar");
  });

  it("key 없음 → Error", async () => {
    const tool = make_tool();
    expect(String(await tool.execute({ operation: "set", value: "bar" }))).toContain("Error");
  });

  it("없는 키 get → Error (cache miss)", async () => {
    const tool = make_tool();
    expect(String(await tool.execute({ operation: "get", key: "nonexistent" }))).toContain("Error");
  });

  it("ttl 0 → 영구 캐시", async () => {
    const tool = make_tool();
    const r = String(await tool.execute({ operation: "set", key: "perm", value: "yes", ttl_ms: 0 }));
    expect(r).toContain("permanent");
  });
});

describe("CacheTool — has", () => {
  it("존재하는 키 → exists: true", async () => {
    const tool = make_tool();
    await tool.execute({ operation: "set", key: "x", value: "1", ttl_ms: 60000 });
    const r = JSON.parse(String(await tool.execute({ operation: "has", key: "x" })));
    expect(r.exists).toBe(true);
  });

  it("없는 키 → exists: false", async () => {
    const tool = make_tool();
    const r = JSON.parse(String(await tool.execute({ operation: "has", key: "missing" })));
    expect(r.exists).toBe(false);
  });
});

describe("CacheTool — invalidate", () => {
  it("키 삭제 후 get → miss", async () => {
    const tool = make_tool();
    await tool.execute({ operation: "set", key: "del_me", value: "v", ttl_ms: 60000 });
    const del_r = String(await tool.execute({ operation: "invalidate", key: "del_me" }));
    expect(del_r).toContain("del_me");
    const get_r = String(await tool.execute({ operation: "get", key: "del_me" }));
    expect(get_r).toContain("Error");
  });

  it("없는 키 삭제 → not found 메시지", async () => {
    const tool = make_tool();
    const r = String(await tool.execute({ operation: "invalidate", key: "ghost" }));
    expect(r).toContain("not found");
  });
});

describe("CacheTool — keys", () => {
  it("저장된 키 목록 반환", async () => {
    const tool = make_tool();
    await tool.execute({ operation: "set", key: "a", value: "1", ttl_ms: 60000 });
    await tool.execute({ operation: "set", key: "b", value: "2", ttl_ms: 60000 });
    const r = JSON.parse(String(await tool.execute({ operation: "keys" }))) as string[];
    expect(r).toContain("a");
    expect(r).toContain("b");
  });
});

describe("CacheTool — stats", () => {
  it("통계 정보 반환", async () => {
    const tool = make_tool();
    await tool.execute({ operation: "set", key: "s1", value: "v", ttl_ms: 60000 });
    await tool.execute({ operation: "get", key: "s1" }); // hit
    await tool.execute({ operation: "get", key: "missing" }); // miss
    const r = JSON.parse(String(await tool.execute({ operation: "stats" })));
    expect(r.total_hits).toBe(1);
    expect(r.total_misses).toBe(1);
    expect(r.hit_rate).toContain("%");
  });
});

describe("CacheTool — clear", () => {
  it("모든 캐시 삭제", async () => {
    const tool = make_tool();
    await tool.execute({ operation: "set", key: "c1", value: "1", ttl_ms: 60000 });
    await tool.execute({ operation: "set", key: "c2", value: "2", ttl_ms: 60000 });
    const clear_r = String(await tool.execute({ operation: "clear" }));
    expect(clear_r).toContain("Cleared");
    expect(clear_r).toContain("2");
    const keys = JSON.parse(String(await tool.execute({ operation: "keys" }))) as string[];
    expect(keys.length).toBe(0);
  });
});

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

    const far_past = Date.now() - 10_000;
    store.set("lru-target", { value: "old", expires_at: Infinity, created_at: far_past, hits: 0 });
    for (let i = 1; i < 500; i++) {
      store.set(`fill-${i}`, { value: "x", expires_at: Infinity, created_at: Date.now(), hits: 0 });
    }
    expect(store.size).toBe(500);

    await t.execute({ operation: "set", key: "new-key-501", value: "new" }, {} as any);

    expect(store.size).toBe(500);
    expect(store.has("lru-target")).toBe(false);
    expect(store.has("new-key-501")).toBe(true);
  });

  it("evict_lru: store 빈 경우에도 에러 없음", async () => {
    const t = new CacheTool();
    expect(() => (t as any).evict_lru()).not.toThrow();
  });
});

// ══════════════════════════════════════════
// 미커버 분기 보충
// ══════════════════════════════════════════

describe("CacheTool — 미커버 분기", () => {
  it("set: value > MAX_VALUE_SIZE → Error", async () => {
    const t = new CacheTool();
    const big = "x".repeat(1024 * 256 + 1);
    const r = String(await t.execute({ operation: "set", key: "big", value: big }));
    expect(r).toContain("Error");
    expect(r).toContain("exceeds");
  });

  it("get: key 없음 → Error", async () => {
    const t = new CacheTool();
    const r = String(await t.execute({ operation: "get" }));
    expect(r).toContain("Error");
  });

  it("get: evict_expired 통과 후 만료 → delete (Date.now mock)", async () => {
    const t = new CacheTool();
    const store = (t as any).store as Map<string, { value: string; expires_at: number; created_at: number; hits: number }>;
    const T = 1_000_000;
    store.set("race-key", { value: "v", expires_at: T + 50, created_at: T - 100, hits: 0 });
    let call_n = 0;
    vi.spyOn(Date, "now").mockImplementation(() => call_n++ === 0 ? T : T + 100);
    const r = String(await t.execute({ operation: "get", key: "race-key" }));
    vi.restoreAllMocks();
    expect(r).toContain("Error");
    expect(store.has("race-key")).toBe(false);
  });

  it("invalidate: key 없음 → Error", async () => {
    const t = new CacheTool();
    const r = String(await t.execute({ operation: "invalidate" }));
    expect(r).toContain("Error");
  });

  it("has: key 없음 → Error", async () => {
    const t = new CacheTool();
    const r = String(await t.execute({ operation: "has" }));
    expect(r).toContain("Error");
  });

  it("stats: evict_expired 통과 후 만료 → expired 카운트 (Date.now mock)", async () => {
    const t = new CacheTool();
    const store = (t as any).store as Map<string, { value: string; expires_at: number; created_at: number; hits: number }>;
    const T = 2_000_000;
    store.set("semi-expired", { value: "v", expires_at: T + 50, created_at: T - 100, hits: 0 });
    let call_n = 0;
    vi.spyOn(Date, "now").mockImplementation(() => call_n++ === 0 ? T : T + 100);
    const r = JSON.parse(String(await t.execute({ operation: "stats" })));
    vi.restoreAllMocks();
    expect(r.expired).toBe(1);
  });

  it("evict_expired: 만료 항목 실제 삭제", async () => {
    const t = new CacheTool();
    const store = (t as any).store as Map<string, { value: string; expires_at: number; created_at: number; hits: number }>;
    store.set("old", { value: "v", expires_at: Date.now() - 1000, created_at: Date.now() - 2000, hits: 0 });
    expect(store.has("old")).toBe(true);
    await t.execute({ operation: "keys" });
    expect(store.has("old")).toBe(false);
  });
});
