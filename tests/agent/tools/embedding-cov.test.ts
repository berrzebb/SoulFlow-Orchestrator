/**
 * EmbeddingTool — 미커버 분기 보충.
 * L52: batch_embed — call_api 에러 string 반환
 * L66: similarity — call_api 에러 string 반환
 * L69: similarity — !emb_a || !emb_b → 'failed to get embeddings'
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { EmbeddingTool } from "@src/agent/tools/embedding.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function make_tool(): EmbeddingTool {
  return new EmbeddingTool();
}

// ══════════════════════════════════════════
// L52: batch_embed — call_api가 에러 string 반환
// ══════════════════════════════════════════

describe("EmbeddingTool — batch_embed L52", () => {
  it("api_key 없음 → call_api 에러 string → L52 반환 (L52)", async () => {
    const original = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const r = await make_tool().execute({ action: "batch_embed", text: '["hello", "world"]' });
    if (original !== undefined) process.env.OPENAI_API_KEY = original;
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("api_key");
  });
});

// ══════════════════════════════════════════
// L66: similarity — call_api가 에러 string 반환
// ══════════════════════════════════════════

describe("EmbeddingTool — similarity L66", () => {
  it("api_key 없음 → call_api 에러 string → L66 반환 (L66)", async () => {
    const original = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const r = await make_tool().execute({ action: "similarity", text_a: "hello", text_b: "world" });
    if (original !== undefined) process.env.OPENAI_API_KEY = original;
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("api_key");
  });
});

// ══════════════════════════════════════════
// L69: similarity — !emb_a || !emb_b
// ══════════════════════════════════════════

describe("EmbeddingTool — similarity L69", () => {
  it("API data에 embedding 없음 → L69 'failed to get embeddings'", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ model: "test-model", data: [{}, {}] }),
    }));
    const r = await make_tool().execute({
      action: "similarity",
      text_a: "alpha",
      text_b: "beta",
      api_key: "test-key-for-coverage",
    });
    expect(String(r)).toContain("Error");
    expect(String(r)).toContain("failed to get embeddings");
  });
});
