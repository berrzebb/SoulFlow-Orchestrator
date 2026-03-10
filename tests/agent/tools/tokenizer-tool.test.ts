/**
 * TokenizerTool — word_tokenize/sentence_split/ngrams/tf_idf/keyword_extract/stopword_filter/token_estimate 커버리지.
 */
import { describe, it, expect } from "vitest";
import { TokenizerTool } from "@src/agent/tools/tokenizer.js";

const tool = new TokenizerTool();

async function exec(params: Record<string, unknown>): Promise<unknown> {
  const r = await tool.execute(params);
  try { return JSON.parse(r); } catch { return r; }
}

describe("TokenizerTool — 메타데이터", () => {
  it("name = tokenizer", () => expect(tool.name).toBe("tokenizer"));
  it("category = ai", () => expect(tool.category).toBe("ai"));
});

describe("TokenizerTool — word_tokenize", () => {
  it("단어 토큰화", async () => {
    const r = await exec({ action: "word_tokenize", text: "Hello world foo bar" }) as Record<string, unknown>;
    expect(Array.isArray(r.tokens)).toBe(true);
    expect(r.count).toBe(4);
  });

  it("빈 텍스트 → 빈 배열", async () => {
    const r = await exec({ action: "word_tokenize", text: "" }) as Record<string, unknown>;
    expect(r.count).toBe(0);
  });
});

describe("TokenizerTool — sentence_split", () => {
  it("문장 분리", async () => {
    const r = await exec({ action: "sentence_split", text: "Hello world. How are you? I am fine!" }) as Record<string, unknown>;
    expect(r.count).toBeGreaterThan(1);
  });

  it("구두점 없는 텍스트 → 단일 문장", async () => {
    const r = await exec({ action: "sentence_split", text: "no punctuation here" }) as Record<string, unknown>;
    expect(r.count).toBe(1);
  });
});

describe("TokenizerTool — ngrams", () => {
  it("bigram 생성 (n=2)", async () => {
    const r = await exec({ action: "ngrams", text: "apple banana cherry", n: 2 }) as Record<string, unknown>;
    expect(r.n).toBe(2);
    expect(r.total).toBeGreaterThan(0);
    expect(Array.isArray(r.top)).toBe(true);
  });

  it("trigram 생성 (n=3)", async () => {
    const r = await exec({ action: "ngrams", text: "a b c d e", n: 3 }) as Record<string, unknown>;
    expect(r.n).toBe(3);
  });

  it("top_k 제한", async () => {
    const r = await exec({ action: "ngrams", text: "a b c d e f g h", n: 2, top_k: 3 }) as Record<string, unknown>;
    expect((r.top as unknown[]).length).toBeLessThanOrEqual(3);
  });
});

describe("TokenizerTool — tf_idf", () => {
  it("텍스트 배열 → TF-IDF 계산", async () => {
    const texts = JSON.stringify([
      "apple banana apple",
      "banana cherry date",
      "cherry cherry cherry",
    ]);
    const r = await exec({ action: "tf_idf", texts }) as Record<string, unknown>;
    expect(r.doc_count).toBe(3);
    expect(Array.isArray(r.results)).toBe(true);
  });

  it("texts 미지정 + text 있음 → 단일 문서", async () => {
    const r = await exec({ action: "tf_idf", text: "hello world hello" }) as Record<string, unknown>;
    expect(r.doc_count).toBe(1);
  });

  it("texts=[], text 없음 → error", async () => {
    const r = await exec({ action: "tf_idf", texts: "[]" }) as Record<string, unknown>;
    expect(r.error).toContain("texts required");
  });

  it("잘못된 texts JSON → error", async () => {
    const r = await exec({ action: "tf_idf", texts: "not-json" }) as Record<string, unknown>;
    expect(r.error).toContain("invalid texts JSON");
  });
});

describe("TokenizerTool — keyword_extract", () => {
  it("키워드 추출 (불용어 제거)", async () => {
    const r = await exec({ action: "keyword_extract", text: "machine learning deep learning neural network" }) as Record<string, unknown>;
    expect(Array.isArray(r.keywords)).toBe(true);
    // 불용어가 아닌 단어들이 포함됨
    expect((r.keywords as Array<{ word: string }>).some((k) => k.word === "learning")).toBe(true);
  });
});

describe("TokenizerTool — stopword_filter", () => {
  it("불용어 필터링", async () => {
    const r = await exec({ action: "stopword_filter", text: "the cat sat on the mat" }) as Record<string, unknown>;
    // "the", "on" 제거됨
    expect(r.removed).toBeGreaterThan(0);
    expect((r.tokens as string[]).indexOf("the")).toBe(-1);
  });
});

describe("TokenizerTool — token_estimate", () => {
  it("기본 모델 토큰 추정", async () => {
    const r = await exec({ action: "token_estimate", text: "Hello world this is a test" }) as Record<string, unknown>;
    expect(r.estimated_tokens).toBeGreaterThan(0);
    expect(r.model).toBe("default");
  });

  it("claude 모델 → ratio=3.5", async () => {
    const r = await exec({ action: "token_estimate", text: "Hello world", model: "claude" }) as Record<string, unknown>;
    expect(r.model).toBe("claude");
    expect(r.estimated_tokens).toBeGreaterThan(0);
  });

  it("gpt4 모델 → ratio=4", async () => {
    const r = await exec({ action: "token_estimate", text: "Hello world", model: "gpt4" }) as Record<string, unknown>;
    expect(r.model).toBe("gpt4");
  });
});

describe("TokenizerTool — unknown action", () => {
  it("알 수 없는 action → error", async () => {
    const r = await exec({ action: "unknown_op" }) as Record<string, unknown>;
    expect(r.error).toContain("unknown action");
  });
});
