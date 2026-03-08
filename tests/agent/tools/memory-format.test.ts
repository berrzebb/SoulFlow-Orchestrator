/**
 * memory-format — strip_memory_uri 유틸리티 함수 테스트.
 */
import { describe, it, expect } from "vitest";
import { strip_memory_uri } from "../../../src/agent/tools/memory-format.js";

describe("strip_memory_uri", () => {
  it("sqlite://memory/ 접두사 제거", () => {
    expect(strip_memory_uri("sqlite://memory/daily/2026-03-04")).toBe("daily/2026-03-04");
    expect(strip_memory_uri("sqlite://memory/longterm")).toBe("longterm");
  });

  it("sqlite:// (비memory) 접두사 → sqlite:// 제거", () => {
    expect(strip_memory_uri("sqlite://other/path")).toBe("other/path");
  });

  it("일반 문자열 → 그대로 반환", () => {
    expect(strip_memory_uri("just-a-key")).toBe("just-a-key");
    expect(strip_memory_uri("")).toBe("");
  });

  it("undefined/null → 빈 문자열", () => {
    expect(strip_memory_uri(undefined as any)).toBe("");
    expect(strip_memory_uri(null as any)).toBe("");
  });
});
