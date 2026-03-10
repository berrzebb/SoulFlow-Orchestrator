import { describe, it, expect } from "vitest";
import { TextSplitterTool } from "@src/agent/tools/text-splitter.js";

function make_tool(): TextSplitterTool {
  return new TextSplitterTool();
}

describe("TextSplitterTool", () => {
  describe("fixed", () => {
    it("고정 크기로 분할 (overlap 기본값 200 → chunk_overlap 명시)", async () => {
      const text = "a".repeat(500);
      // chunk_overlap=0은 falsy → 기본값 200이 됨. 1을 전달해야 최소 overlap.
      const result = JSON.parse(await make_tool().execute({ action: "fixed", text, chunk_size: 250, chunk_overlap: 1 }));
      expect(result.chunk_count).toBe(3); // 250, step=249 → 3 chunks
      expect(result.chunks[0]).toHaveLength(250);
      expect(result.total_chars).toBe(500);
    });

    it("짧은 텍스트 → 1 청크", async () => {
      const text = "abcdefghij"; // 10 chars, chunk_size 최소 50
      const result = JSON.parse(await make_tool().execute({ action: "fixed", text, chunk_size: 100, chunk_overlap: 1 }));
      expect(result.chunk_count).toBe(1);
      expect(result.chunks[0]).toBe("abcdefghij");
    });

    it("빈 텍스트", async () => {
      const result = JSON.parse(await make_tool().execute({ action: "fixed", text: "" }));
      expect(result.chunk_count).toBe(0);
    });
  });

  describe("separator", () => {
    it("기본 구분자(\\n\\n)로 분할", async () => {
      const text = "Paragraph one.\n\nParagraph two.\n\nParagraph three.";
      const result = JSON.parse(await make_tool().execute({
        action: "separator", text, chunk_size: 1000, chunk_overlap: 0,
      }));
      expect(result.chunk_count).toBe(1); // 전체 크기 < chunk_size
    });

    it("커스텀 구분자", async () => {
      // 각 파트가 충분히 길어야 merge_parts에서 분할됨
      const text = "aaaa---bbbb---cccc";
      const result = JSON.parse(await make_tool().execute({
        action: "separator", text, separator: "---", chunk_size: 50, chunk_overlap: 1,
      }));
      // 전체가 50 미만이므로 1개 청크로 합쳐짐
      expect(result.chunk_count).toBe(1);
      expect(result.chunks[0]).toContain("aaaa");
      expect(result.chunks[0]).toContain("bbbb");
    });
  });

  describe("paragraph", () => {
    it("문단 단위 분할", async () => {
      const parts = Array.from({ length: 5 }, (_, i) => "x".repeat(100) + ` para${i}`);
      const text = parts.join("\n\n");
      const result = JSON.parse(await make_tool().execute({
        action: "paragraph", text, chunk_size: 250, chunk_overlap: 0,
      }));
      expect(result.chunk_count).toBeGreaterThan(1);
    });
  });

  describe("regex", () => {
    it("정규식 구분자", async () => {
      const text = "word1. word2! word3? word4.";
      const result = JSON.parse(await make_tool().execute({
        action: "regex", text, separator: "[.!?]\\s+", chunk_size: 1000, chunk_overlap: 0,
      }));
      expect(result.chunk_count).toBe(1); // 전체가 하나의 청크
    });
  });

  it("chunk_size 최소 50 강제", async () => {
    const text = "a".repeat(100);
    const result = JSON.parse(await make_tool().execute({ action: "fixed", text, chunk_size: 10, chunk_overlap: 0 }));
    // chunk_size가 50으로 클램핑됨
    expect(result.chunks[0]).toHaveLength(50);
  });

  describe("sentence", () => {
    it("문장 단위 분할 (L37-38)", async () => {
      const text = "First sentence. Second sentence! Third sentence? Fourth sentence.";
      const result = JSON.parse(await make_tool().execute({
        action: "sentence", text, chunk_size: 1000, chunk_overlap: 0,
      }));
      expect(result.chunk_count).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(result.chunks)).toBe(true);
    });
  });

  describe("regex invalid pattern", () => {
    it("잘못된 정규식 → catch → split_fixed fallback (L77)", async () => {
      const text = "a".repeat(200);
      // "[" is invalid regex
      const result = JSON.parse(await make_tool().execute({
        action: "regex", text, separator: "[", chunk_size: 100, chunk_overlap: 0,
      }));
      // catch block → split_fixed fallback → chunk_count >= 1
      expect(result.chunk_count).toBeGreaterThanOrEqual(1);
    });
  });
});
