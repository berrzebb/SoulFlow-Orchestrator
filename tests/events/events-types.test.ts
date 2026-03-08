/**
 * events/types — normalize_phase 함수 테스트.
 */
import { describe, it, expect } from "vitest";
import { normalize_phase } from "../../src/events/types.js";

describe("normalize_phase", () => {
  it.each([
    ["assign", "assign"],
    ["progress", "progress"],
    ["blocked", "blocked"],
    ["done", "done"],
    ["approval", "approval"],
  ])("유효한 phase '%s' → '%s'", (input, expected) => {
    expect(normalize_phase(input)).toBe(expected);
  });

  it("대소문자 무시", () => {
    expect(normalize_phase("DONE")).toBe("done");
    expect(normalize_phase("Progress")).toBe("progress");
  });

  it("앞뒤 공백 무시", () => {
    expect(normalize_phase("  assign  ")).toBe("assign");
  });

  it("유효하지 않은 값 → 'progress' 폴백", () => {
    expect(normalize_phase("unknown")).toBe("progress");
    expect(normalize_phase("")).toBe("progress");
    expect(normalize_phase(null)).toBe("progress");
    expect(normalize_phase(undefined)).toBe("progress");
    expect(normalize_phase(123)).toBe("progress");
  });
});
