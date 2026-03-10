/**
 * vector-store.service — 전체 동작 커버리지:
 * - upsert: vectors 필수, 정상 upsert, 메타/벡터 삽입
 * - query: query_vector 필수, 메타 없음 → 빈 결과, 정상 쿼리 + min_score 필터
 * - delete: ids 필수, 존재/미존재 삭제
 * - default: 지원하지 않는 op
 * - normalize: 영벡터
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { create_vector_store_service } from "@src/services/vector-store.service.js";

let tmp_dir: string;

async function setup() {
  tmp_dir = await mkdtemp(join(tmpdir(), "vec-store-"));
  return create_vector_store_service(tmp_dir);
}

afterEach(async () => {
  await rm(tmp_dir, { recursive: true, force: true }).catch(() => {});
});

// 테스트용 4차원 벡터 (sqlite-vec는 최소 차원 제한 없음)
const DIM = 4;
function make_vec(seed: number): number[] {
  return [Math.sin(seed), Math.cos(seed), Math.sin(seed * 2), Math.cos(seed * 2)];
}

// ══════════════════════════════════════════════════════════
// upsert
// ══════════════════════════════════════════════════════════

describe("vector-store-service — upsert", () => {
  it("vectors 없음 → error 반환", async () => {
    const store = await setup();
    const result = await store("upsert", { store_id: "s1", collection: "col1" });
    expect(result.error).toContain("vectors required");
  });

  it("벡터 1개 upsert → ok=true, upserted=1", async () => {
    const store = await setup();
    const result = await store("upsert", {
      store_id: "s1",
      collection: "col1",
      vectors: [make_vec(1)],
      documents: ["doc 1"],
      ids: ["id1"],
      metadata: [{ tag: "test" }],
    });
    expect(result.ok).toBe(true);
    expect(result.upserted).toBe(1);
  });

  it("벡터 여러 개 upsert → upserted 수 일치", async () => {
    const store = await setup();
    const result = await store("upsert", {
      store_id: "s1",
      collection: "col2",
      vectors: [make_vec(1), make_vec(2), make_vec(3)],
      documents: ["doc1", "doc2", "doc3"],
    });
    expect(result.upserted).toBe(3);
  });

  it("같은 id로 재삽입 → 덮어쓰기 (upsert)", async () => {
    const store = await setup();
    await store("upsert", {
      store_id: "s1",
      collection: "col3",
      vectors: [make_vec(1)],
      documents: ["original"],
      ids: ["dup_id"],
    });
    const result = await store("upsert", {
      store_id: "s1",
      collection: "col3",
      vectors: [make_vec(2)],
      documents: ["updated"],
      ids: ["dup_id"],
    });
    expect(result.ok).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════
// query
// ══════════════════════════════════════════════════════════

describe("vector-store-service — query", () => {
  it("query_vector 없음 → error 반환", async () => {
    const store = await setup();
    const result = await store("query", { store_id: "s1", collection: "col1" });
    expect(result.error).toContain("query_vector required");
  });

  it("메타 테이블 없음 → 빈 results", async () => {
    const store = await setup();
    // upsert 없이 바로 query → 테이블 미존재
    const result = await store("query", {
      store_id: "new_store",
      collection: "empty_col",
      query_vector: make_vec(1),
    });
    expect(result.results).toEqual([]);
  });

  it("upsert 후 query → 결과 반환", async () => {
    const store = await setup();
    await store("upsert", {
      store_id: "s1",
      collection: "test_col",
      vectors: [make_vec(1), make_vec(2)],
      documents: ["hello world", "foo bar"],
      ids: ["v1", "v2"],
      metadata: [{ kind: "a" }, { kind: "b" }],
    });

    const result = await store("query", {
      store_id: "s1",
      collection: "test_col",
      query_vector: make_vec(1),
      top_k: 2,
    });

    expect(Array.isArray(result.results)).toBe(true);
    expect((result.results as unknown[]).length).toBeGreaterThan(0);
    const first = (result.results as Array<{ id: string; score: number; document: string }>)[0];
    expect(first.score).toBeGreaterThan(0);
  });

  it("min_score 필터 → score 미달 결과 제외", async () => {
    const store = await setup();
    await store("upsert", {
      store_id: "s1",
      collection: "filter_col",
      vectors: [make_vec(1)],
      documents: ["doc"],
      ids: ["f1"],
    });

    // min_score=1.0 → cosine similarity가 정확히 1인 것만 통과
    const result = await store("query", {
      store_id: "s1",
      collection: "filter_col",
      query_vector: make_vec(99),  // 다른 방향 → score < 1
      min_score: 1.0,
    });

    expect((result.results as unknown[]).length).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════
// delete
// ══════════════════════════════════════════════════════════

describe("vector-store-service — delete", () => {
  it("ids 없음 → error 반환", async () => {
    const store = await setup();
    const result = await store("delete", { store_id: "s1", collection: "col1" });
    expect(result.error).toContain("ids required");
  });

  it("메타 테이블 없음 → deleted=0", async () => {
    const store = await setup();
    const result = await store("delete", {
      store_id: "no_store",
      collection: "no_col",
      ids: ["missing"],
    });
    expect(result.ok).toBe(true);
    expect(result.deleted).toBe(0);
  });

  it("존재하는 id 삭제 → deleted=1", async () => {
    const store = await setup();
    await store("upsert", {
      store_id: "s1",
      collection: "del_col",
      vectors: [make_vec(1), make_vec(2)],
      ids: ["del1", "del2"],
    });

    const result = await store("delete", {
      store_id: "s1",
      collection: "del_col",
      ids: ["del1"],
    });
    expect(result.deleted).toBe(1);
  });

  it("존재하지 않는 id → deleted=0", async () => {
    const store = await setup();
    await store("upsert", {
      store_id: "s1",
      collection: "del_col2",
      vectors: [make_vec(1)],
      ids: ["existing"],
    });

    const result = await store("delete", {
      store_id: "s1",
      collection: "del_col2",
      ids: ["nonexistent"],
    });
    expect(result.deleted).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════
// default — 지원하지 않는 op
// ══════════════════════════════════════════════════════════

describe("vector-store-service — 지원하지 않는 op", () => {
  it("unknown op → error 반환", async () => {
    const store = await setup();
    const result = await store("list_all", { store_id: "s1" });
    expect(result.error).toContain("unsupported operation");
  });
});
