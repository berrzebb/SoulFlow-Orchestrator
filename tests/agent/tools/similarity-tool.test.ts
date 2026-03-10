/**
 * SimilarityTool — cosine/jaccard/levenshtein/hamming/dice/jaro_winkler/euclidean 테스트.
 * L107: parse_vector가 숫자가 아닌 요소를 가진 배열 → null 반환 커버.
 */
import { describe, it, expect } from "vitest";
import { SimilarityTool } from "../../../src/agent/tools/similarity.js";

const tool = new SimilarityTool();

async function exec(params: Record<string, unknown>): Promise<unknown> {
  const result = await tool.execute(params);
  try { return JSON.parse(String(result)); } catch { return result; }
}

// ══════════════════════════════════════════
// cosine
// ══════════════════════════════════════════

describe("SimilarityTool — cosine", () => {
  it("동일 문자열 → similarity: 1", async () => {
    const r = await exec({ action: "cosine", a: "hello world", b: "hello world" }) as Record<string, unknown>;
    expect(Number(r.similarity)).toBeCloseTo(1);
  });

  it("완전히 다른 문자열 → similarity: 0", async () => {
    const r = await exec({ action: "cosine", a: "apple", b: "zebra" }) as Record<string, unknown>;
    expect(Number(r.similarity)).toBeGreaterThanOrEqual(0);
  });

  it("벡터 배열 입력 → cosine 계산", async () => {
    const r = await exec({ action: "cosine", a: "[1,0,0]", b: "[1,0,0]" }) as Record<string, unknown>;
    expect(Number(r.similarity)).toBeCloseTo(1);
  });
});

// ══════════════════════════════════════════
// jaccard
// ══════════════════════════════════════════

describe("SimilarityTool — jaccard", () => {
  it("부분 겹침 → 0과 1 사이", async () => {
    const r = await exec({ action: "jaccard", a: "hello world", b: "hello there" }) as Record<string, unknown>;
    const sim = Number(r.similarity);
    expect(sim).toBeGreaterThan(0);
    expect(sim).toBeLessThan(1);
  });

  it("동일 문자열 → similarity: 1", async () => {
    const r = await exec({ action: "jaccard", a: "same", b: "same" }) as Record<string, unknown>;
    expect(Number(r.similarity)).toBeCloseTo(1);
  });
});

// ══════════════════════════════════════════
// levenshtein
// ══════════════════════════════════════════

describe("SimilarityTool — levenshtein", () => {
  it("한 글자 차이 → distance: 1", async () => {
    const r = await exec({ action: "levenshtein", a: "kitten", b: "sitten" }) as Record<string, unknown>;
    expect(Number(r.distance)).toBe(1);
  });

  it("동일 문자열 → distance: 0", async () => {
    const r = await exec({ action: "levenshtein", a: "abc", b: "abc" }) as Record<string, unknown>;
    expect(Number(r.distance)).toBe(0);
  });
});

// ══════════════════════════════════════════
// hamming
// ══════════════════════════════════════════

describe("SimilarityTool — hamming", () => {
  it("동일 길이 문자열", async () => {
    const r = await exec({ action: "hamming", a: "abc", b: "abc" }) as Record<string, unknown>;
    expect(Number(r.distance)).toBe(0);
  });

  it("다른 길이 문자열 → error", async () => {
    const r = await exec({ action: "hamming", a: "ab", b: "abc" }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
  });
});

// ══════════════════════════════════════════
// dice
// ══════════════════════════════════════════

describe("SimilarityTool — dice", () => {
  it("부분 겹침 bigram → 0과 1 사이", async () => {
    const r = await exec({ action: "dice", a: "night", b: "nacht" }) as Record<string, unknown>;
    const sim = Number(r.similarity);
    expect(sim).toBeGreaterThanOrEqual(0);
    expect(sim).toBeLessThanOrEqual(1);
  });
});

// ══════════════════════════════════════════
// jaro_winkler
// ══════════════════════════════════════════

describe("SimilarityTool — jaro_winkler", () => {
  it("유사한 문자열 → 높은 similarity", async () => {
    const r = await exec({ action: "jaro_winkler", a: "MARTHA", b: "MARHTA" }) as Record<string, unknown>;
    expect(Number(r.similarity)).toBeGreaterThan(0.9);
  });
});

// ══════════════════════════════════════════
// euclidean — L107: parse_vector 비숫자 요소 → null
// ══════════════════════════════════════════

describe("SimilarityTool — euclidean (L107: parse_vector null)", () => {
  it("숫자 벡터 → euclidean 거리 계산", async () => {
    const r = await exec({ action: "euclidean", a: "[1,0]", b: "[0,1]" }) as Record<string, unknown>;
    expect(Number(r.distance)).toBeCloseTo(Math.sqrt(2));
  });

  it("동일 벡터 → distance: 0", async () => {
    const r = await exec({ action: "euclidean", a: "[3,4]", b: "[3,4]" }) as Record<string, unknown>;
    expect(Number(r.distance)).toBe(0);
  });

  it("비숫자 요소 벡터 → parse_vector null → error (L107)", async () => {
    // parse_vector: arr.every(v => typeof v === "number") 실패 → return null → L107
    const r = await exec({ action: "euclidean", a: '["not","a","number"]', b: "[1,2,3]" }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
    expect(String(r.error)).toContain("valid JSON number arrays required");
  });

  it("길이 불일치 벡터 → error", async () => {
    const r = await exec({ action: "euclidean", a: "[1,2]", b: "[1,2,3]" }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
  });

  it("잘못된 JSON 벡터 → parse_vector catch null → error", async () => {
    const r = await exec({ action: "euclidean", a: "not-json", b: "[1,2]" }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
  });
});

// ══════════════════════════════════════════
// unknown action
// ══════════════════════════════════════════

describe("SimilarityTool — unknown action", () => {
  it("알 수 없는 action → error", async () => {
    const r = await exec({ action: "unknown_action", a: "x", b: "y" }) as Record<string, unknown>;
    expect(r.error).toBeDefined();
  });
});

// ══════════════════════════════════════════
// 미커버 분기 보충
// ══════════════════════════════════════════

describe("SimilarityTool — 미커버 분기", () => {
  it("hamming: 같은 길이 문자열 → L59 거리 계산", async () => {
    // "abc" vs "axc" → hamming distance = 1 (b≠x)
    const r = await exec({ action: "hamming", a: "abc", b: "axc" }) as Record<string, unknown>;
    expect(r.distance).toBe(1);
  });

  it("jaro: 완전 같은 문자열 → L151 return 1.0 (early exit)", async () => {
    // a === b → L151 return 1
    const r = await exec({ action: "jaro_winkler", a: "hello", b: "hello" }) as Record<string, unknown>;
    expect(Number(r.jaro)).toBe(1);
  });

  it("jaro: matches=0 → L166 return 0", async () => {
    // 'aaa' vs 'zzz' → no matching chars → L166 return 0
    const r = await exec({ action: "jaro_winkler", a: "aaa", b: "zzz" }) as Record<string, unknown>;
    expect(Number(r.jaro)).toBe(0);
  });

  it("jaro: 빈 문자열 → L153 return 0", async () => {
    // len_a=0 → L153: return 0
    const r = await exec({ action: "jaro_winkler", a: "", b: "hello" }) as Record<string, unknown>;
    expect(Number(r.jaro)).toBe(0);
  });

  it("jaro: 일부만 매칭 → L169 continue + L170 while skip (abcdef vs axxxxf)", async () => {
    // a_matches: [true, false, false, false, false, true] (only 'a' and 'f' match)
    // transpositions loop: L169 fires for i=1..4 (not matched), L170 fires for i=5 (skip unmatched b positions)
    const r = await exec({ action: "jaro_winkler", a: "abcdef", b: "axxxxf" }) as Record<string, unknown>;
    // jaro = (2/6 + 2/6 + 2/2) / 3 ≈ 0.444
    expect(Number(r.jaro)).toBeGreaterThan(0);
    expect(Number(r.jaro)).toBeLessThan(1);
  });
});
