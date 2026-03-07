import { describe, it, expect } from "vitest";
import { SimilarityTool } from "../../src/agent/tools/similarity.js";

function make_tool() {
  return new SimilarityTool({ secret_vault: undefined as never });
}

describe("SimilarityTool", () => {
  describe("cosine (벡터)", () => {
    it("동일 벡터 → 유사도 1", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "cosine", a: "[1,2,3]", b: "[1,2,3]" }));
      expect(r.similarity).toBe(1);
      expect(r.metric).toBe("cosine");
    });

    it("직교 벡터 → 유사도 0", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "cosine", a: "[1,0]", b: "[0,1]" }));
      expect(r.similarity).toBe(0);
    });

    it("길이 불일치 → 에러", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "cosine", a: "[1,2]", b: "[1,2,3]" }));
      expect(r.error).toBeDefined();
    });
  });

  describe("cosine (텍스트)", () => {
    it("동일 텍스트 → 유사도 1", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "cosine", a: "hello world", b: "hello world" }));
      expect(r.similarity).toBe(1);
      expect(r.metric).toBe("cosine_text");
    });

    it("다른 텍스트 → 0 < 유사도 < 1", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "cosine", a: "hello world foo", b: "hello bar baz" }));
      expect(r.similarity).toBeGreaterThan(0);
      expect(r.similarity).toBeLessThan(1);
    });
  });

  describe("jaccard", () => {
    it("동일 집합 → 유사도 1", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "jaccard", a: "cat dog", b: "dog cat" }));
      expect(r.similarity).toBe(1);
    });

    it("겹침 없음 → 유사도 0", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "jaccard", a: "cat", b: "dog" }));
      expect(r.similarity).toBe(0);
      expect(r.intersection).toBe(0);
    });

    it("부분 겹침", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "jaccard", a: "a b c", b: "b c d" }));
      // intersection=2(b,c), union=4(a,b,c,d) → 0.5
      expect(r.similarity).toBe(0.5);
      expect(r.intersection).toBe(2);
      expect(r.union).toBe(4);
    });
  });

  describe("levenshtein", () => {
    it("동일 문자열 → 거리 0, 유사도 1", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "levenshtein", a: "abc", b: "abc" }));
      expect(r.distance).toBe(0);
      expect(r.similarity).toBe(1);
    });

    it("한 글자 차이", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "levenshtein", a: "kitten", b: "sitten" }));
      expect(r.distance).toBe(1);
    });

    it("kitten → sitting 거리 3", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "levenshtein", a: "kitten", b: "sitting" }));
      expect(r.distance).toBe(3);
    });
  });

  describe("hamming", () => {
    it("동일 문자열 → 거리 0", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "hamming", a: "abc", b: "abc" }));
      expect(r.distance).toBe(0);
      expect(r.similarity).toBe(1);
    });

    it("길이 불일치 → 에러", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "hamming", a: "ab", b: "abc" }));
      expect(r.error).toBeDefined();
    });

    it("2자리 차이", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "hamming", a: "karolin", b: "kathrin" }));
      // k-a-r-o-l-i-n vs k-a-t-h-r-i-n → 3 differences (r/t, o/h, l/r)
      expect(r.distance).toBe(3);
    });
  });

  describe("dice", () => {
    it("동일 문자열 → 유사도 1", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "dice", a: "night", b: "night" }));
      expect(r.similarity).toBe(1);
    });

    it("완전히 다른 문자열 → 유사도 0", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "dice", a: "ab", b: "cd" }));
      expect(r.similarity).toBe(0);
    });
  });

  describe("jaro_winkler", () => {
    it("동일 문자열 → 유사도 1", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "jaro_winkler", a: "abc", b: "abc" }));
      expect(r.similarity).toBe(1);
    });

    it("공통 접두사 보너스 적용", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "jaro_winkler", a: "martha", b: "marhta" }));
      expect(r.similarity).toBeGreaterThan(r.jaro);
      expect(r.common_prefix).toBeGreaterThan(0);
    });
  });

  describe("euclidean", () => {
    it("동일 벡터 → 거리 0, 유사도 1", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "euclidean", a: "[1,2,3]", b: "[1,2,3]" }));
      expect(r.distance).toBe(0);
      expect(r.similarity).toBe(1);
    });

    it("거리 계산", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "euclidean", a: "[0,0]", b: "[3,4]" }));
      expect(r.distance).toBe(5);
    });

    it("비벡터 입력 → 에러", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "euclidean", a: "hello", b: "world" }));
      expect(r.error).toBeDefined();
    });
  });

  it("알 수 없는 액션 → 에러", async () => {
    const r = JSON.parse(await make_tool().execute({ action: "unknown_metric" as never, a: "a", b: "b" }));
    expect(r.error).toContain("unknown action");
  });
});
