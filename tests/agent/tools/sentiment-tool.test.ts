/**
 * SentimentTool — AFINN 감성 분석 전 액션 커버리지.
 * analyze / batch / compare / keywords / score_text + 미커버 분기.
 */
import { describe, it, expect } from "vitest";
import { SentimentTool } from "@src/agent/tools/sentiment.js";

const tool = new SentimentTool();

async function exec(params: Record<string, unknown>): Promise<unknown> {
  const r = await tool.execute(params);
  try { return JSON.parse(r); } catch { return r; }
}

// ══════════════════════════════════════════
// 메타데이터
// ══════════════════════════════════════════

describe("SentimentTool — 메타데이터", () => {
  it("name = sentiment", () => expect(tool.name).toBe("sentiment"));
  it("category = ai", () => expect(tool.category).toBe("ai"));
  it("to_schema type = function", () => expect(tool.to_schema().type).toBe("function"));
});

// ══════════════════════════════════════════
// analyze (L93–96, L140–151)
// ══════════════════════════════════════════

describe("SentimentTool — analyze", () => {
  it("긍정 텍스트 → score>0, label=positive", async () => {
    const r = await exec({ action: "analyze", text: "I love this amazing wonderful product" }) as Record<string, unknown>;
    expect(r.score).toBeGreaterThan(0);
    expect(r.label).toBe("positive");
    expect(typeof r.word_count).toBe("number");
    expect(typeof r.comparative).toBe("number");
  });

  it("부정 텍스트 → score<0, label=negative", async () => {
    const r = await exec({ action: "analyze", text: "terrible horrible awful disaster" }) as Record<string, unknown>;
    expect(r.score).toBeLessThan(0);
    expect(r.label).toBe("negative");
  });

  it("중립 텍스트(AFINN 없는 단어) → score=0, label=neutral", async () => {
    const r = await exec({ action: "analyze", text: "the quick brown fox jumps" }) as Record<string, unknown>;
    expect(r.score).toBe(0);
    expect(r.label).toBe("neutral");
    expect(r.comparative).toBe(0);
  });

  it("빈 텍스트 → score=0, comparative=0", async () => {
    const r = await exec({ action: "analyze", text: "" }) as Record<string, unknown>;
    expect(r.score).toBe(0);
    expect(r.comparative).toBe(0);
  });

  it("text 미지정 → 빈 텍스트 처리", async () => {
    const r = await exec({ action: "analyze" }) as Record<string, unknown>;
    expect(r.score).toBe(0);
  });
});

// ══════════════════════════════════════════
// batch (L97–102)
// ══════════════════════════════════════════

describe("SentimentTool — batch", () => {
  it("복수 텍스트 배열 → count/average_score/results", async () => {
    const texts = JSON.stringify(["I love this", "I hate this", "ok"]);
    const r = await exec({ action: "batch", texts }) as Record<string, unknown>;
    expect(r.count).toBe(3);
    expect(typeof r.average_score).toBe("number");
    expect(Array.isArray(r.results)).toBe(true);
  });

  it("빈 배열 → count=0, average_score=0", async () => {
    const r = await exec({ action: "batch", texts: "[]" }) as Record<string, unknown>;
    expect(r.count).toBe(0);
    expect(r.average_score).toBe(0);
  });

  it("잘못된 JSON → error", async () => {
    const r = await exec({ action: "batch", texts: "not-json" }) as Record<string, unknown>;
    expect(r.error).toContain("invalid");
  });
});

// ══════════════════════════════════════════
// compare (L104–111)
// ══════════════════════════════════════════

describe("SentimentTool — compare", () => {
  it("2개 텍스트 비교 → most_positive/most_negative 인덱스", async () => {
    const texts = JSON.stringify(["amazing wonderful fantastic", "terrible awful horrible"]);
    const r = await exec({ action: "compare", texts }) as Record<string, unknown>;
    expect(r.most_positive).toBe(0);
    expect(r.most_negative).toBe(1);
    expect(Array.isArray(r.scores)).toBe(true);
  });

  it("1개 텍스트 → error (need at least 2)", async () => {
    const r = await exec({ action: "compare", texts: JSON.stringify(["only one"]) }) as Record<string, unknown>;
    expect(r.error).toContain("2");
  });

  it("잘못된 JSON → error", async () => {
    const r = await exec({ action: "compare", texts: "bad-json" }) as Record<string, unknown>;
    expect(r.error).toContain("invalid");
  });
});

// ══════════════════════════════════════════
// keywords (L113–127)
// ══════════════════════════════════════════

describe("SentimentTool — keywords", () => {
  it("감성어 포함 텍스트 → positive/negative 배열", async () => {
    const r = await exec({ action: "keywords", text: "love great happy but terrible sad" }) as Record<string, unknown>;
    const pos = r.positive as Array<{ word: string; score: number }>;
    const neg = r.negative as Array<{ word: string; score: number }>;
    expect(pos.length).toBeGreaterThan(0);
    expect(neg.length).toBeGreaterThan(0);
    // 점수 내림차순 정렬 확인
    if (pos.length >= 2) expect(pos[0].score).toBeGreaterThanOrEqual(pos[1].score);
  });

  it("감성어 없는 텍스트 → empty positive/negative", async () => {
    const r = await exec({ action: "keywords", text: "the cat sat on the mat" }) as Record<string, unknown>;
    expect((r.positive as unknown[]).length).toBe(0);
    expect((r.negative as unknown[]).length).toBe(0);
  });
});

// ══════════════════════════════════════════
// score_text (L129–133)
// ══════════════════════════════════════════

describe("SentimentTool — score_text", () => {
  it("AFINN 단어 포함 → word_scores/total", async () => {
    const r = await exec({ action: "score_text", text: "love happy terrible" }) as Record<string, unknown>;
    const ws = r.word_scores as Array<{ word: string; score: number }>;
    expect(ws.length).toBeGreaterThan(0);
    expect(typeof r.total).toBe("number");
  });

  it("AFINN 없는 단어만 → word_scores=[]", async () => {
    const r = await exec({ action: "score_text", text: "cat sat mat" }) as Record<string, unknown>;
    expect((r.word_scores as unknown[]).length).toBe(0);
    expect(r.total).toBe(0);
  });
});

// ══════════════════════════════════════════
// default (L135–136)
// ══════════════════════════════════════════

describe("SentimentTool — unknown action", () => {
  it("알 수 없는 action → error", async () => {
    const r = await exec({ action: "unknown_op" }) as Record<string, unknown>;
    expect(r.error).toContain("unknown action");
  });
});
