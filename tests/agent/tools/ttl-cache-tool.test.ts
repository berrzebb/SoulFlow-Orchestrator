/**
 * CacheTool (TTL Cache) — set/get/invalidate/has/keys/stats/clear 테스트.
 */
import { describe, it, expect } from "vitest";
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
