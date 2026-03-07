import { describe, it, expect } from "vitest";
import { chunk_markdown, type MemoryChunk } from "@src/agent/memory-chunker.js";

describe("chunk_markdown", () => {
  const KEY = "test-doc";

  describe("기본 헤딩 분할", () => {
    it("헤딩 없는 텍스트 → 단일 청크", () => {
      const chunks = chunk_markdown("hello world\n두번째 줄", KEY);
      expect(chunks).toHaveLength(1);
      expect(chunks[0].content).toContain("hello world");
      expect(chunks[0].heading).toBe("");
      expect(chunks[0].heading_level).toBe(0);
    });

    it("두 개의 ## 헤딩 → 2 청크", () => {
      const text = [
        "## 섹션 A",
        "내용 A",
        "",
        "## 섹션 B",
        "내용 B",
      ].join("\n");
      const chunks = chunk_markdown(text, KEY);
      expect(chunks).toHaveLength(2);
      expect(chunks[0].heading).toBe("섹션 A");
      expect(chunks[0].heading_level).toBe(2);
      expect(chunks[0].content).toContain("내용 A");
      expect(chunks[1].heading).toBe("섹션 B");
      expect(chunks[1].content).toContain("내용 B");
    });

    it("다단계 헤딩(#, ##, ###) 모두 경계로 분할", () => {
      const text = [
        "# H1",
        "내용1",
        "## H2",
        "내용2",
        "### H3",
        "내용3",
      ].join("\n");
      const chunks = chunk_markdown(text, KEY);
      expect(chunks).toHaveLength(3);
      expect(chunks[0].heading_level).toBe(1);
      expect(chunks[1].heading_level).toBe(2);
      expect(chunks[2].heading_level).toBe(3);
    });

    it("빈 텍스트 → 빈 배열", () => {
      expect(chunk_markdown("", KEY)).toHaveLength(0);
    });
  });

  describe("대형 섹션 재분할", () => {
    it("1500자 초과 섹션은 단락 경계에서 분할", () => {
      const para = "가".repeat(800);
      const text = [
        "## 큰 섹션",
        para,
        "",
        para,
        "",
        para,
      ].join("\n");
      const chunks = chunk_markdown(text, KEY);
      expect(chunks.length).toBeGreaterThanOrEqual(2);
      for (const c of chunks) {
        expect(c.heading).toBe("큰 섹션");
      }
    });

    it("1500자 이내 섹션은 분할하지 않음", () => {
      const text = [
        "## 작은 섹션",
        "짧은 내용",
      ].join("\n");
      const chunks = chunk_markdown(text, KEY);
      expect(chunks).toHaveLength(1);
    });
  });

  describe("SHA-256 해시", () => {
    it("chunk_id와 content_hash는 16자 hex", () => {
      const chunks = chunk_markdown("## Test\ncontent", KEY);
      expect(chunks[0].chunk_id).toMatch(/^[0-9a-f]{16}$/);
      expect(chunks[0].content_hash).toMatch(/^[0-9a-f]{16}$/);
    });

    it("동일 내용 → 동일 content_hash", () => {
      const a = chunk_markdown("## Test\ncontent", KEY);
      const b = chunk_markdown("## Test\ncontent", KEY);
      expect(a[0].content_hash).toBe(b[0].content_hash);
    });

    it("다른 내용 → 다른 content_hash", () => {
      const a = chunk_markdown("## Test\ncontent A", KEY);
      const b = chunk_markdown("## Test\ncontent B", KEY);
      expect(a[0].content_hash).not.toBe(b[0].content_hash);
    });

    it("다른 source_key → 다른 chunk_id (같은 content_hash)", () => {
      const a = chunk_markdown("## Test\ncontent", "key-a");
      const b = chunk_markdown("## Test\ncontent", "key-b");
      expect(a[0].content_hash).toBe(b[0].content_hash);
      expect(a[0].chunk_id).not.toBe(b[0].chunk_id);
    });
  });

  describe("라인 번호 추적", () => {
    it("start_line과 end_line이 1-indexed", () => {
      const text = [
        "## A",    // line 1
        "내용 A",   // line 2
        "## B",    // line 3
        "내용 B",   // line 4
      ].join("\n");
      const chunks = chunk_markdown(text, KEY);
      expect(chunks[0].start_line).toBeGreaterThanOrEqual(1);
      expect(chunks[1].start_line).toBeGreaterThan(chunks[0].start_line);
    });
  });
});
