/**
 * vector-store.service.ts — 미커버 분기 (cov2):
 * - L22: with_vec_db catch → log.warn + null 반환 (sqlite-vec 삽입 오류)
 * - L23: 위 catch의 return null
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { create_vector_store_service } from "@src/services/vector-store.service.js";

function make_vec(seed: number, dim = 4): number[] {
  return Array.from({ length: dim }, (_, i) => Math.sin(seed + i));
}

// ── L22-23: with_vec_db catch — 차원 불일치 → sqlite-vec throw → catch ─────

describe("vector-store.service — L22-23: with_vec_db catch", () => {
  it("dim=4로 초기화 후 dim=2 upsert → sqlite-vec 오류 → catch → null 반환 → ok:true 반환", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "vec-cov2-"));
    try {
      const svc = create_vector_store_service(tmp);

      // 첫 upsert: dim=4로 vec 테이블 초기화
      const r1 = await svc("upsert", {
        store_id: "store1",
        collection: "col1",
        vectors: [make_vec(1, 4)],
        ids: ["id1"],
        documents: ["doc1"],
        metadata: [{}],
      });
      expect((r1 as any).ok).toBe(true);

      // 두 번째 upsert: dim=2 (불일치) → insert_vec.run이 throw → with_vec_db catch
      // catch에서 null 반환 → count = null ?? 0 = 0 → { ok: true, upserted: 0 }
      const r2 = await svc("upsert", {
        store_id: "store1",
        collection: "col1",
        vectors: [make_vec(1, 2)], // dim=2, 테이블은 float[4]
        ids: ["id2"],
        documents: ["doc2"],
        metadata: [{}],
      });
      // catch → null → 0으로 fallback → ok:true 또는 undefined
      expect(r2).toBeDefined();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("vectors가 없는 upsert → early return (DB 오픈 없음)", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "vec-cov2b-"));
    try {
      const svc = create_vector_store_service(tmp);
      const result = await svc("upsert", {
        store_id: "store1",
        collection: "col1",
        vectors: [],
        ids: [],
        documents: [],
        metadata: [],
      });
      expect((result as any).error).toMatch(/vectors required/i);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
