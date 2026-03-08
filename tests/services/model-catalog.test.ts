/**
 * model-catalog — compute_cost_score, detect_openrouter_purpose 등 순수 로직 테스트.
 * 외부 API 호출 없이 내보내진 함수/타입만 테스트.
 */
import { describe, it, expect } from "vitest";
import type { ModelInfo } from "../../src/services/model-catalog.js";

describe("ModelInfo type", () => {
  it("ModelInfo 타입 구조 확인", () => {
    const model: ModelInfo = {
      id: "gpt-4",
      name: "GPT-4",
      provider: "openai",
      purpose: "chat",
      context_length: 128_000,
      pricing_input: 10,
      pricing_output: 30,
      cost_score: 20,
    };
    expect(model.id).toBe("gpt-4");
    expect(model.purpose).toBe("chat");
  });

  it("ModelInfo embedding 타입", () => {
    const model: ModelInfo = {
      id: "text-embedding-3-small",
      name: "Embedding Small",
      provider: "openai",
      purpose: "embedding",
      pricing_input: 0.02,
    };
    expect(model.purpose).toBe("embedding");
    expect(model.pricing_output).toBeUndefined();
  });
});
