/**
 * string-match.ts — 미커버 분기 보충:
 * - L6: levenshtein — b가 빈 문자열일 때 조기 반환
 */
import { describe, it, expect } from "vitest";
import { levenshtein } from "@src/utils/string-match.js";

describe("levenshtein — L6: a 빈 문자열 → b.length 반환", () => {
  it("a='' → b.length 반환 (L6 early return)", () => {
    expect(levenshtein("", "world")).toBe(5);
    expect(levenshtein("", "ab")).toBe(2);
  });
});

describe("levenshtein — L7: b 빈 문자열 → a.length 반환", () => {
  it("b='' → a.length 반환 (L7 early return)", () => {
    expect(levenshtein("hello", "")).toBe(5);
    expect(levenshtein("abc", "")).toBe(3);
  });
});
