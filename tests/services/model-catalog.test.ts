/**
 * model-catalog — 정적 카탈로그 + 캐시 관리 + fetch mock 테스트.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import type { ModelInfo } from "../../src/services/model-catalog.js";
import {
  fetch_anthropic_models,
  fetch_gemini_models,
  fetch_openrouter_models,
  fetch_openai_models,
  fetch_ollama_models,
  get_static_openai_models,
  invalidate_model_cache,
} from "../../src/services/model-catalog.js";

describe("ModelInfo 타입 구조", () => {
  it("chat 모델", () => {
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
    expect(model.purpose).toBe("chat");
  });

  it("embedding 모델 — pricing_output 선택적", () => {
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

describe("model-catalog — 정적 카탈로그", () => {
  beforeEach(() => {
    invalidate_model_cache();
  });

  it("fetch_anthropic_models: API 키 없음 → 정적 목록 반환", async () => {
    const models = await fetch_anthropic_models();
    expect(models.length).toBeGreaterThan(0);
    expect(models.every((m) => m.provider === "anthropic")).toBe(true);
    expect(models.every((m) => m.purpose === "chat")).toBe(true);
  });

  it("fetch_anthropic_models: cost_score 계산됨 (input+output)/2", async () => {
    const models = await fetch_anthropic_models();
    const opus = models.find((m) => m.id === "claude-opus-4-6");
    expect(opus).toBeDefined();
    expect(opus!.cost_score).toBeCloseTo((5 + 25) / 2, 3);
  });

  it("fetch_gemini_models: API 키 없음 → 정적 목록 반환", async () => {
    const models = await fetch_gemini_models();
    expect(models.length).toBeGreaterThan(0);
    expect(models.every((m) => m.provider === "gemini")).toBe(true);
  });

  it("fetch_gemini_models: embedding 모델 포함", async () => {
    const models = await fetch_gemini_models();
    const embed = models.find((m) => m.purpose === "embedding");
    expect(embed).toBeDefined();
    expect(embed!.id).toContain("embedding");
  });

  it("get_static_openai_models: OpenAI 정적 카탈로그 반환", () => {
    const models = get_static_openai_models();
    expect(models.length).toBeGreaterThan(0);
    expect(models.every((m) => m.provider === "openai")).toBe(true);
  });

  it("get_static_openai_models: chat + embedding 모두 포함", () => {
    const models = get_static_openai_models();
    expect(models.some((m) => m.purpose === "chat")).toBe(true);
    expect(models.some((m) => m.purpose === "embedding")).toBe(true);
  });
});

describe("model-catalog — 캐시 관리", () => {
  beforeEach(() => {
    invalidate_model_cache();
  });

  afterEach(() => {
    invalidate_model_cache();
  });

  it("invalidate_model_cache: 특정 provider만 무효화 후 재호출 가능", async () => {
    await fetch_anthropic_models();
    await fetch_gemini_models();
    invalidate_model_cache("anthropic");
    const models = await fetch_anthropic_models();
    expect(models.length).toBeGreaterThan(0);
  });

  it("invalidate_model_cache: 전체 무효화 — 에러 없음", () => {
    expect(() => invalidate_model_cache()).not.toThrow();
  });

  it("두 번 호출 → 캐시 히트 (동일 결과)", async () => {
    const first = await fetch_anthropic_models();
    const second = await fetch_anthropic_models();
    expect(second).toEqual(first);
  });
});

describe("model-catalog — fetch mock (네트워크)", () => {
  beforeEach(() => {
    invalidate_model_cache();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    invalidate_model_cache();
  });

  it("fetch_openrouter_models: 성공 응답 파싱", async () => {
    const mock_data = [
      { id: "openai/gpt-4o", name: "GPT-4o", context_length: 128000, pricing: { prompt: "0.000005", completion: "0.000015" }, architecture: { modality: "text" } },
      { id: "cohere/embed-v3", name: "Embed V3", pricing: { prompt: "0.0000001", completion: "0" }, architecture: { output_modalities: ["embedding"] } },
    ];
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ data: mock_data }),
    } as unknown as Response);

    const models = await fetch_openrouter_models();
    expect(models.find((m) => m.id === "openai/gpt-4o")?.purpose).toBe("chat");
    expect(models.find((m) => m.id === "cohere/embed-v3")?.purpose).toBe("embedding");
  });

  it("fetch_openrouter_models: API 오류 → 빈 배열", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 401 } as Response);
    expect(await fetch_openrouter_models()).toEqual([]);
  });

  it("fetch_openrouter_models: 네트워크 오류 → 빈 배열", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("network error"));
    expect(await fetch_openrouter_models()).toEqual([]);
  });

  it("fetch_openai_models: 성공 응답 파싱 — embed ID 패턴 감지", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ data: [
        { id: "gpt-4o", owned_by: "openai" },
        { id: "text-embedding-ada-002", owned_by: "openai" },
      ]}),
    } as unknown as Response);

    const models = await fetch_openai_models("https://api.openai.com/v1");
    expect(models.find((m) => m.id === "gpt-4o")?.purpose).toBe("chat");
    expect(models.find((m) => m.id === "text-embedding-ada-002")?.purpose).toBe("embedding");
  });

  it("fetch_openai_models: 실패 → 빈 배열", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 500 } as Response);
    expect(await fetch_openai_models("https://api.openai.com/v1")).toEqual([]);
  });

  it("fetch_ollama_models: 성공 응답 파싱 — bert family → embedding", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ models: [
        { name: "llama3.2", size: 4000000 },
        { name: "nomic-embed-text", size: 274000, details: { family: "bert" } },
      ]}),
    } as unknown as Response);

    const models = await fetch_ollama_models("http://localhost:11434");
    expect(models.find((m) => m.id === "llama3.2")?.purpose).toBe("chat");
    expect(models.find((m) => m.id === "nomic-embed-text")?.purpose).toBe("embedding");
  });

  it("fetch_ollama_models: 실패 → 빈 배열", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("connection refused"));
    expect(await fetch_ollama_models("http://localhost:11434")).toEqual([]);
  });
});
