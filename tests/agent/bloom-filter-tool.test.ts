import { describe, it, expect } from "vitest";
import { BloomFilterTool } from "../../src/agent/tools/bloom-filter.js";

function make_tool() {
  return new BloomFilterTool({ secret_vault: undefined as never });
}

describe("BloomFilterTool", () => {
  describe("create", () => {
    it("빈 필터 생성", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "create", size: 256, hash_count: 3 }));
      expect(r.size).toBe(256);
      expect(r.hash_count).toBe(3);
      expect(r.bit_count).toBe(0);
      expect(r.filter).toBeDefined();
    });
  });

  describe("add + test", () => {
    it("추가한 항목은 possibly_exists=true", async () => {
      const tool = make_tool();
      const create = JSON.parse(await tool.execute({ action: "create", size: 1024, hash_count: 3 }));
      const added = JSON.parse(await tool.execute({
        action: "add", filter: create.filter, size: 1024, hash_count: 3,
        items: JSON.stringify(["apple", "banana"]),
      }));
      expect(added.added).toBeGreaterThan(0);

      const tested = JSON.parse(await tool.execute({
        action: "test", filter: added.filter, size: 1024, hash_count: 3,
        items: JSON.stringify(["apple", "banana"]),
      }));
      expect(tested.results[0].possibly_exists).toBe(true);
      expect(tested.results[1].possibly_exists).toBe(true);
    });

    it("추가하지 않은 항목은 일반적으로 false", async () => {
      const tool = make_tool();
      const create = JSON.parse(await tool.execute({ action: "create", size: 1024, hash_count: 3 }));
      const added = JSON.parse(await tool.execute({
        action: "add", filter: create.filter, size: 1024, hash_count: 3,
        items: JSON.stringify(["apple"]),
      }));
      const tested = JSON.parse(await tool.execute({
        action: "test", filter: added.filter, size: 1024, hash_count: 3,
        item: "zzz_not_added_xyz",
      }));
      // 확률적 자료구조이므로 false positive 가능하지만 큰 필터에서는 거의 false
      expect(tested.results[0].possibly_exists).toBe(false);
    });
  });

  describe("stats", () => {
    it("추가 후 통계 반환", async () => {
      const tool = make_tool();
      const create = JSON.parse(await tool.execute({ action: "create", size: 1024, hash_count: 3 }));
      const added = JSON.parse(await tool.execute({
        action: "add", filter: create.filter, size: 1024, hash_count: 3,
        items: JSON.stringify(["a", "b", "c"]),
      }));
      const stats = JSON.parse(await tool.execute({
        action: "stats", filter: added.filter, size: 1024, hash_count: 3,
      }));
      expect(stats.set_bits).toBeGreaterThan(0);
      expect(stats.fill_ratio).toBeGreaterThan(0);
      expect(stats.estimated_items).toBeGreaterThan(0);
    });
  });

  describe("merge", () => {
    it("두 필터 병합", async () => {
      const tool = make_tool();
      const create = JSON.parse(await tool.execute({ action: "create", size: 256, hash_count: 3 }));
      const f1 = JSON.parse(await tool.execute({
        action: "add", filter: create.filter, size: 256, hash_count: 3, item: "apple",
      }));
      const f2 = JSON.parse(await tool.execute({
        action: "add", filter: create.filter, size: 256, hash_count: 3, item: "banana",
      }));
      const merged = JSON.parse(await tool.execute({
        action: "merge", filter: f1.filter, filter2: f2.filter, size: 256,
      }));
      // 병합 후 두 항목 모두 possibly_exists=true
      const tested = JSON.parse(await tool.execute({
        action: "test", filter: merged.filter, size: 256, hash_count: 3,
        items: JSON.stringify(["apple", "banana"]),
      }));
      expect(tested.results[0].possibly_exists).toBe(true);
      expect(tested.results[1].possibly_exists).toBe(true);
    });
  });

  describe("estimate_size", () => {
    it("예상 아이템 수로 필터 크기 추정", async () => {
      const r = JSON.parse(await make_tool().execute({
        action: "estimate_size", expected_items: 10000, false_positive_rate: 0.01,
      }));
      expect(r.recommended_size).toBeGreaterThan(0);
      expect(r.recommended_hash_count).toBeGreaterThan(0);
      expect(r.memory_bytes).toBeGreaterThan(0);
    });
  });

  describe("serialize", () => {
    it("필터 직렬화 정보", async () => {
      const tool = make_tool();
      const create = JSON.parse(await tool.execute({ action: "create", size: 512, hash_count: 5 }));
      const r = JSON.parse(await tool.execute({
        action: "serialize", filter: create.filter, size: 512, hash_count: 5,
      }));
      expect(r.hex).toBe(create.filter);
      expect(r.size).toBe(512);
      expect(r.hash_count).toBe(5);
    });
  });
});
