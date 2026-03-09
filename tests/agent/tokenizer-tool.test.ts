import { describe, it, expect } from "vitest";
import { TokenizerTool } from "../../src/agent/tools/tokenizer.js";

function make_tool() {
  return new TokenizerTool({ secret_vault: undefined as never });
}

describe("TokenizerTool", () => {
  describe("word_tokenize", () => {
    it("단어 토큰화", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "word_tokenize", text: "Hello world foo" }));
      expect(r.tokens).toEqual(["Hello", "world", "foo"]);
      expect(r.count).toBe(3);
    });

    it("빈 텍스트 → 빈 배열", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "word_tokenize", text: "" }));
      expect(r.tokens).toEqual([]);
      expect(r.count).toBe(0);
    });
  });

  describe("sentence_split", () => {
    it("문장 분리", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "sentence_split", text: "Hello world. How are you? Fine!" }));
      expect(r.count).toBe(3);
    });
  });

  describe("ngrams", () => {
    it("2-gram 생성", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "ngrams", text: "a b c d", n: 2 }));
      expect(r.n).toBe(2);
      expect(r.total).toBe(3); // "a b", "b c", "c d"
    });

    it("3-gram 생성", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "ngrams", text: "a b c d", n: 3 }));
      expect(r.n).toBe(3);
      expect(r.total).toBe(2); // "a b c", "b c d"
    });
  });

  describe("tf_idf", () => {
    it("다중 문서 TF-IDF 계산", async () => {
      const texts = JSON.stringify(["the cat sat on mat", "the dog played in park"]);
      const r = JSON.parse(await make_tool().execute({ action: "tf_idf", texts }));
      expect(r.doc_count).toBe(2);
      expect(r.results).toHaveLength(2);
      expect(r.results[0].top_terms.length).toBeGreaterThan(0);
    });

    it("단일 text 폴백", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "tf_idf", text: "hello world" }));
      expect(r.doc_count).toBe(1);
    });
  });

  describe("keyword_extract", () => {
    it("불용어 제거 후 키워드 추출", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "keyword_extract", text: "the amazing machine learning algorithm works very well" }));
      const words = r.keywords.map((k: { word: string }) => k.word);
      // "the", "very", "well" 등은 불용어로 제거
      expect(words).not.toContain("the");
      expect(words).toContain("amazing");
      expect(words).toContain("machine");
    });
  });

  describe("stopword_filter", () => {
    it("불용어 필터링", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "stopword_filter", text: "the cat is on the mat" }));
      expect(r.removed).toBeGreaterThan(0);
      expect(r.filtered_count).toBeLessThan(r.original_count);
      // "cat", "mat"은 불용어 아님
      expect(r.tokens).toContain("cat");
      expect(r.tokens).toContain("mat");
    });
  });

  describe("token_estimate", () => {
    it("기본 모델 토큰 추정", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "token_estimate", text: "Hello world" }));
      expect(r.char_count).toBe(11);
      expect(r.word_count).toBe(2);
      expect(r.estimated_tokens).toBeGreaterThan(0);
      expect(r.model).toBe("default");
    });

    it("claude 모델 추정", async () => {
      const r = JSON.parse(await make_tool().execute({ action: "token_estimate", text: "Hello world test", model: "claude" }));
      expect(r.model).toBe("claude");
      // claude는 ratio=3.5이므로 기본(4)보다 토큰 수 많음
      expect(r.estimated_tokens).toBeGreaterThan(0);
    });

    it("gpt4 모델 추정 (L100 else-if 브랜치)", async () => {
      // model="gpt4" → else if (model === "gpt4") ratio = 4 (L100)
      const r = JSON.parse(await make_tool().execute({ action: "token_estimate", text: "Hello world test", model: "gpt4" }));
      expect(r.model).toBe("gpt4");
      expect(r.estimated_tokens).toBeGreaterThan(0);
    });
  });

  it("알 수 없는 액션 → 에러", async () => {
    const r = JSON.parse(await make_tool().execute({ action: "unknown" as never }));
    expect(r.error).toContain("unknown action");
  });
});
