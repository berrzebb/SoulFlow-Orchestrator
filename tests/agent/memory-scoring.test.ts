import { describe, it, expect } from "vitest";
import { rrf_merge, apply_temporal_decay, mmr_rerank, type ScoredChunk } from "@src/agent/memory-scoring.js";

describe("rrf_merge", () => {
  it("두 랭킹 리스트를 RRF로 병합", () => {
    const fts = ["a", "b", "c"];
    const vec = ["b", "d", "a"];
    const result = rrf_merge(fts, vec);

    expect(result.length).toBe(4); // a, b, c, d
    const ids = result.map(r => r.chunk_id);
    // b는 양쪽 상위 → 최상위
    expect(ids[0]).toBe("b");
    // a도 양쪽 → 2위
    expect(ids[1]).toBe("a");
  });

  it("빈 리스트 → 빈 결과", () => {
    expect(rrf_merge([], [])).toHaveLength(0);
  });

  it("한쪽만 있어도 동작", () => {
    const result = rrf_merge(["x", "y"], []);
    expect(result).toHaveLength(2);
    expect(result[0].chunk_id).toBe("x");
  });

  it("점수가 양수", () => {
    const result = rrf_merge(["a"], ["a"]);
    expect(result[0].score).toBeGreaterThan(0);
  });

  it("양쪽에 동시 등장 시 점수가 한쪽보다 높음", () => {
    const both = rrf_merge(["a"], ["a"]);
    const one = rrf_merge(["a"], []);
    expect(both[0].score).toBeGreaterThan(one[0].score);
  });
});

describe("apply_temporal_decay", () => {
  const scored: ScoredChunk[] = [
    { chunk_id: "old", score: 1.0 },
    { chunk_id: "new", score: 1.0 },
    { chunk_id: "evergreen", score: 1.0 },
  ];

  it("오래된 항목의 점수가 감쇠", () => {
    const result = apply_temporal_decay(scored, (id) => {
      if (id === "old") return 30;      // 30일 전
      if (id === "new") return 1;       // 1일 전
      return null;                       // evergreen (longterm)
    });

    const map = new Map(result.map(r => [r.chunk_id, r.score]));
    expect(map.get("new")!).toBeGreaterThan(map.get("old")!);
    expect(map.get("evergreen")).toBe(1.0); // 감쇠 면제
  });

  it("age=0이면 감쇠 없음", () => {
    const result = apply_temporal_decay(
      [{ chunk_id: "a", score: 1.0 }],
      () => 0,
    );
    expect(result[0].score).toBeCloseTo(1.0);
  });

  it("결과는 점수 내림차순 정렬", () => {
    const input: ScoredChunk[] = [
      { chunk_id: "low", score: 1.0 },
      { chunk_id: "high", score: 1.0 },
    ];
    const result = apply_temporal_decay(input, (id) =>
      id === "low" ? 100 : 0,
    );
    expect(result[0].chunk_id).toBe("high");
  });
});

describe("mmr_rerank", () => {
  const scored: ScoredChunk[] = [
    { chunk_id: "a", score: 1.0 },
    { chunk_id: "b", score: 0.9 },
    { chunk_id: "c", score: 0.8 },
    { chunk_id: "d", score: 0.7 },
  ];

  const content_map: Record<string, string> = {
    a: "고양이는 귀엽다 고양이 사료",
    b: "고양이는 귀엽다 고양이 장난감",   // a와 유사
    c: "날씨가 좋다 산책 가자",            // a와 상이
    d: "프로그래밍 언어 타입스크립트",      // 완전 다름
  };

  it("limit 적용", () => {
    const result = mmr_rerank(scored, (id) => content_map[id] ?? "", 2);
    expect(result).toHaveLength(2);
  });

  it("lambda=1.0 → 순수 관련도 순서 유지", () => {
    const result = mmr_rerank(scored, (id) => content_map[id] ?? "", 4, 1.0);
    expect(result.map(r => r.chunk_id)).toEqual(["a", "b", "c", "d"]);
  });

  it("lambda<1.0 → 다양성 반영으로 유사 항목 순위 하락", () => {
    const result = mmr_rerank(scored, (id) => content_map[id] ?? "", 4, 0.5);
    const ids = result.map(r => r.chunk_id);
    // a 다음으로 a와 유사한 b보다 다른 c 또는 d가 올라올 수 있음
    expect(ids[0]).toBe("a"); // 최상위는 유지
    // b가 2위가 아닐 가능성 높음 (다양성 패널티)
    expect(ids.indexOf("c")).toBeLessThan(ids.indexOf("b"));
  });

  it("빈 입력 → 빈 결과", () => {
    const result = mmr_rerank([], () => "", 5);
    expect(result).toHaveLength(0);
  });

  it("단일 항목 → 그대로 반환", () => {
    const result = mmr_rerank([scored[0]], () => "text", 5);
    expect(result).toHaveLength(1);
    expect(result[0].chunk_id).toBe("a");
  });
});
