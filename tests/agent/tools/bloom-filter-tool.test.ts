/**
 * BloomFilterTool — 확률적 집합 소속 테스트 및 관련 operations.
 */
import { describe, it, expect } from "vitest";
import { BloomFilterTool } from "../../../src/agent/tools/bloom-filter.js";

const tool = new BloomFilterTool();

async function exec(params: Record<string, unknown>): Promise<unknown> {
  const result = await tool.execute(params);
  try { return JSON.parse(String(result)); } catch { return result; }
}

describe("BloomFilterTool — create", () => {
  it("기본 필터 생성", async () => {
    const r = await exec({ action: "create" }) as Record<string, unknown>;
    expect(r.size).toBe(1024);
    expect(r.hash_count).toBe(3);
    expect(r.bit_count).toBe(0);
    expect(typeof r.filter).toBe("string");
  });

  it("크기 지정", async () => {
    const r = await exec({ action: "create", size: 512, hash_count: 5 }) as Record<string, unknown>;
    expect(r.size).toBe(512);
    expect(r.hash_count).toBe(5);
  });
});

describe("BloomFilterTool — add & test", () => {
  it("아이템 추가 후 존재 확인", async () => {
    // 1. 필터 생성
    const created = await exec({ action: "create", size: 256 }) as Record<string, unknown>;
    const filter = String(created.filter);

    // 2. 아이템 추가
    const added = await exec({
      action: "add",
      filter,
      size: 256,
      items: JSON.stringify(["apple", "banana"]),
    }) as Record<string, unknown>;
    const new_filter = String(added.filter);
    expect(Number(added.added)).toBeGreaterThan(0);

    // 3. 존재 확인 (false positive 가능하지만 added item은 반드시 존재)
    const tested = await exec({
      action: "test",
      filter: new_filter,
      size: 256,
      items: JSON.stringify(["apple", "banana"]),
    }) as Record<string, unknown>;
    const results = tested.results as { item: string; possibly_exists: boolean }[];
    expect(results.every((r) => r.possibly_exists)).toBe(true);
  });

  it("추가하지 않은 아이템 → possibly_exists: false (확률적이지만 빈 필터에서는 false)", async () => {
    const created = await exec({ action: "create", size: 1024 }) as Record<string, unknown>;
    const r = await exec({
      action: "test",
      filter: String(created.filter),
      size: 1024,
      items: JSON.stringify(["not_added"]),
    }) as Record<string, unknown>;
    const results = r.results as { possibly_exists: boolean }[];
    expect(results[0]?.possibly_exists).toBe(false);
  });

  it("단일 item 파라미터", async () => {
    const created = await exec({ action: "create" }) as Record<string, unknown>;
    const added = await exec({
      action: "add",
      filter: String(created.filter),
      item: "single_item",
    }) as Record<string, unknown>;
    expect(Number(added.added)).toBe(1);
  });
});

describe("BloomFilterTool — stats", () => {
  it("통계 정보 반환", async () => {
    const created = await exec({ action: "create", size: 256 }) as Record<string, unknown>;
    const added = await exec({
      action: "add",
      filter: String(created.filter),
      size: 256,
      items: JSON.stringify(["a", "b", "c"]),
    }) as Record<string, unknown>;
    const r = await exec({
      action: "stats",
      filter: String(added.filter),
      size: 256,
    }) as Record<string, unknown>;
    expect(r.size).toBe(256);
    expect(Number(r.set_bits)).toBeGreaterThan(0);
    expect(Number(r.fill_ratio)).toBeGreaterThan(0);
  });
});

describe("BloomFilterTool — merge", () => {
  it("두 필터 병합 (OR)", async () => {
    const size = 256;
    const f1 = await exec({ action: "create", size }) as Record<string, unknown>;
    const f2 = await exec({ action: "create", size }) as Record<string, unknown>;

    const a1 = await exec({ action: "add", filter: String(f1.filter), size, items: JSON.stringify(["x"]) }) as Record<string, unknown>;
    const a2 = await exec({ action: "add", filter: String(f2.filter), size, items: JSON.stringify(["y"]) }) as Record<string, unknown>;

    const merged = await exec({
      action: "merge",
      filter: String(a1.filter),
      filter2: String(a2.filter),
      size,
    }) as Record<string, unknown>;

    // 병합된 필터에서 두 아이템 모두 존재해야 함
    const t = await exec({
      action: "test",
      filter: String(merged.filter),
      size,
      items: JSON.stringify(["x", "y"]),
    }) as Record<string, unknown>;
    const results = t.results as { possibly_exists: boolean }[];
    expect(results.every((r) => r.possibly_exists)).toBe(true);
  });
});

describe("BloomFilterTool — estimate_size", () => {
  it("크기 추정", async () => {
    const r = await exec({ action: "estimate_size", expected_items: 1000, false_positive_rate: 0.01 }) as Record<string, unknown>;
    expect(Number(r.recommended_size)).toBeGreaterThan(0);
    expect(Number(r.recommended_hash_count)).toBeGreaterThan(0);
    expect(Number(r.memory_bytes)).toBeGreaterThan(0);
  });
});

describe("BloomFilterTool — serialize", () => {
  it("직렬화 정보", async () => {
    const created = await exec({ action: "create", size: 256 }) as Record<string, unknown>;
    const r = await exec({
      action: "serialize",
      filter: String(created.filter),
      size: 256,
    }) as Record<string, unknown>;
    expect(r.hex).toBeDefined();
    expect(r.size).toBe(256);
    expect(Number(r.byte_length)).toBe(32); // 256 / 8 = 32
  });
});
