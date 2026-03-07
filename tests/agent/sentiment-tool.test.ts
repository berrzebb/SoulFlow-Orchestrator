import { describe, it, expect } from "vitest";
import { SentimentTool } from "../../src/agent/tools/sentiment.js";

function make_tool() {
  return new SentimentTool({ secret_vault: undefined as never });
}

describe("SentimentTool", () => {
  describe("analyze", () => {
    it("긍정 텍스트 → positive", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "analyze", text: "I love this amazing wonderful product" }));
      expect(r.label).toBe("positive");
      expect(r.score).toBeGreaterThan(0);
      expect(r.scored_words).toBeGreaterThan(0);
    });

    it("부정 텍스트 → negative", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "analyze", text: "terrible horrible awful experience" }));
      expect(r.label).toBe("negative");
      expect(r.score).toBeLessThan(0);
    });

    it("중립 텍스트 → neutral", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "analyze", text: "table chair desk" }));
      expect(r.label).toBe("neutral");
      expect(r.score).toBe(0);
    });
  });

  describe("batch", () => {
    it("여러 텍스트 일괄 분석", async () => {
      const texts = JSON.stringify(["I love it", "I hate it", "table"]);
      const r = JSON.parse(await make_tool().execute({ action: "batch", texts }));
      expect(r.count).toBe(3);
      expect(r.results[0].label).toBe("positive");
      expect(r.results[1].label).toBe("negative");
      expect(r.results[2].label).toBe("neutral");
    });
  });

  describe("compare", () => {
    it("가장 긍정/부정 인덱스 반환", async () => {
      const texts = JSON.stringify(["I hate it", "neutral text", "I love this amazing thing"]);
      const r = JSON.parse(await make_tool().execute({ action: "compare", texts }));
      expect(r.most_positive).toBe(2);
      expect(r.most_negative).toBe(0);
    });

    it("텍스트 2개 미만 → 에러", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "compare", texts: JSON.stringify(["only one"]) }));
      expect(r.error).toContain("2 texts");
    });
  });

  describe("keywords", () => {
    it("긍정/부정 키워드 분류", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "keywords", text: "I love the amazing product but hate the terrible service" }));
      const pos_words = r.positive.map((p: { word: string }) => p.word);
      const neg_words = r.negative.map((n: { word: string }) => n.word);
      expect(pos_words).toContain("love");
      expect(pos_words).toContain("amazing");
      expect(neg_words).toContain("hate");
      expect(neg_words).toContain("terrible");
    });
  });

  describe("score_text", () => {
    it("개별 단어 점수 반환", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "score_text", text: "good bad" }));
      expect(r.word_scores.length).toBe(2);
      expect(r.total).toBe(0); // good(3) + bad(-3) = 0
    });
  });

  it("알 수 없는 액션 → 에러", async () => {
    const r = JSON.parse(await make_tool().execute({ action: "unknown" as never }));
    expect(r.error).toContain("unknown action");
  });
});
