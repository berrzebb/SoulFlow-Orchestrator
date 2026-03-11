import { describe, it, expect } from "vitest";
import { chunk_markdown } from "@src/agent/memory-chunker.js";

describe("chunk_markdown — L102: 빈 단락 → continue", () => {
  describe("섹션", () => {
    it("MAX_CHUNK_SIZE + 빈 단락 포함 → L102 continue, 청크 정상 생성", () => {
      // MAX_CHUNK_SIZE(1500)를 초과하는 섹션에 빈 단락(\n\n)을 삽입해 L102 continue 분기 히트
      const para = "가".repeat(800);
      const text = [
        "## 큰 섹션",
        para,
        "",        // 빈 단락 → split 후 para.trim() === "" → L102 continue
        "",
        para,
      ].join("\n");

      const chunks = chunk_markdown(text, "test-source");
      expect(chunks.length).toBeGreaterThanOrEqual(1);
      // chunk_id 는 순수 SHA-256 hex (source_key를 포함하지 않음)
      expect(chunks[0].chunk_id).toMatch(/^[0-9a-f]{16}$/);
      expect(chunks[0].heading).toBe("큰 섹션");
    });
  });
});
