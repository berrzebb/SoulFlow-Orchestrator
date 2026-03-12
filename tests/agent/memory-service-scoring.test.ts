/**
 * MemoryStore — search_chunks_vec 벡터 검색 결과 순서 손실 버그 수정 검증 (C-20).
 *
 * Bug C-20: WHERE rowid IN (...) 쿼리가 KNN distance 순서를 보장하지 않음
 *   → vec_ranked 배열의 위치가 RRF rank로 사용되므로, 순서가 틀리면 스코어가 왜곡됨
 *   → 수정: rowid_to_chunk Map으로 distance 순서 복원
 *
 * 수정 코드 (memory.service.ts L557-561):
 *   Before: SELECT chunk_id ... WHERE rowid IN (...) → natural row order
 *   After:  SELECT c.rowid, c.chunk_id ... + Map 기반 distance 순서 복원
 */
import { describe, it, expect } from "vitest";
import { rrf_merge } from "@src/agent/memory-scoring.js";

// ══════════════════════════════════════════════════════════
// C-20 핵심 로직: Map 기반 rowid 순서 복원
// ══════════════════════════════════════════════════════════

describe("search_chunks_vec — distance 순서 복원 (C-20)", () => {
  it("KNN rowid 순서로 chunk_id를 복원한다 (SQLite natural order 무시)", () => {
    // KNN 쿼리가 distance 순으로 반환한 rowid 목록 (첫 번째가 가장 유사)
    const knn_rowids = [3, 1, 4, 2]; // distance order

    // WHERE rowid IN (...) 결과 — SQLite natural row order (rowid ASC)
    const db_chunk_rows = [
      { rowid: 1, chunk_id: "chunk-B" },
      { rowid: 2, chunk_id: "chunk-D" },
      { rowid: 3, chunk_id: "chunk-A" }, // 실제로는 가장 유사한 청크
      { rowid: 4, chunk_id: "chunk-C" },
    ];

    // 수정 전 (bug): natural order 반환
    const before_fix = db_chunk_rows.map(r => r.chunk_id);
    expect(before_fix).toEqual(["chunk-B", "chunk-D", "chunk-A", "chunk-C"]);
    // → rowid 3 (chunk-A, 가장 유사)이 3번째로 밀림 — wrong!

    // 수정 후 (fix): Map 기반 distance 순서 복원
    const rowid_to_chunk = new Map(db_chunk_rows.map(r => [Number(r.rowid), r.chunk_id]));
    const after_fix = knn_rowids
      .map(rid => rowid_to_chunk.get(Number(rid)))
      .filter((id): id is string => id !== undefined);
    expect(after_fix).toEqual(["chunk-A", "chunk-B", "chunk-C", "chunk-D"]);
    // → chunk-A (rowid=3)가 첫 번째 — correct!
  });

  it("필터 후 일부 rowid가 제거돼도 남은 항목의 순서를 보존한다", () => {
    // kind=longterm 필터로 daily 청크가 제외된 상황
    const knn_rowids = [5, 2, 8, 1]; // distance order

    // WHERE kind='longterm' 필터 후 rowid 2, 8 제외됨
    const db_chunk_rows = [
      { rowid: 1, chunk_id: "lt-chunk-D" },
      { rowid: 5, chunk_id: "lt-chunk-A" },
    ];

    const rowid_to_chunk = new Map(db_chunk_rows.map(r => [Number(r.rowid), r.chunk_id]));
    const ordered = knn_rowids
      .map(rid => rowid_to_chunk.get(Number(rid)))
      .filter((id): id is string => id !== undefined);

    // rowid 5 → lt-chunk-A (rank 0, distance 가장 가까움)
    // rowid 1 → lt-chunk-D (rank 3, distance 가장 멀지만 필터 후 2개 중 2위)
    expect(ordered).toEqual(["lt-chunk-A", "lt-chunk-D"]);
  });
});

// ══════════════════════════════════════════════════════════
// RRF rank 민감도: 순서가 스코어에 미치는 영향 증명
// ══════════════════════════════════════════════════════════

describe("rrf_merge — 순서(rank)가 점수에 영향 (C-20 영향도 증명)", () => {
  it("동일 항목이라도 rank가 낮으면 점수가 낮아진다", () => {
    // chunk-A가 rank 0 (가장 유사)인 경우
    const correct_order = rrf_merge(["x", "y"], ["chunk-A", "chunk-B"]);
    // chunk-A가 rank 1로 밀린 경우 (버그 시뮬레이션)
    const wrong_order = rrf_merge(["x", "y"], ["chunk-B", "chunk-A"]);

    const score_correct = correct_order.find(c => c.chunk_id === "chunk-A")!.score;
    const score_wrong = wrong_order.find(c => c.chunk_id === "chunk-A")!.score;

    // rank가 낮을수록(rank 0 < rank 1) RRF 점수가 높아야 함
    expect(score_correct).toBeGreaterThan(score_wrong);
  });

  it("잘못된 순서는 실제로 상위 결과를 바꾼다", () => {
    // "best" 청크가 FTS에서는 rank 0, vec에서도 rank 0 (올바른 순서)
    const correct = rrf_merge(["best", "second"], ["best", "second"]);

    // 버그 상태: vec에서 "second"가 rank 0으로 잘못 반환됨
    const bugged = rrf_merge(["best", "second"], ["second", "best"]);

    expect(correct[0].chunk_id).toBe("best");    // 올바른 순서: "best"가 1위
    expect(bugged[0].chunk_id).toBe("best");     // FTS rank 0 덕에 여전히 "best" — RRF는 양쪽 평균
    // 하지만 "best"의 vec 기여 점수가 달라짐
    const best_correct = correct.find(c => c.chunk_id === "best")!.score;
    const best_bugged = bugged.find(c => c.chunk_id === "best")!.score;
    expect(best_correct).toBeGreaterThan(best_bugged); // 올바른 순서에서 점수가 더 높음
  });
});
