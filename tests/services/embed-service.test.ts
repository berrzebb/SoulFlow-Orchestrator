/**
 * embed.service.ts — create_embed_service / create_embed_service_from_provider 테스트.
 * 실제 API 호출 없이 fetch mock 사용.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  create_embed_service,
  create_embed_service_from_provider,
  create_multimodal_embed_service,
  create_multimodal_embed_service_from_provider,
} from "@src/services/embed.service.js";

function make_mock_response(embeddings: number[][], total_tokens = 10) {
  return {
    ok: true,
    json: async () => ({
      data: embeddings.map((embedding, index) => ({ embedding, index })),
      usage: { total_tokens },
    }),
    text: async () => "",
    status: 200,
  };
}

function make_error_response(status: number, body = "API Error") {
  return {
    ok: false,
    json: async () => ({}),
    text: async () => body,
    status,
  };
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("create_embed_service — 기본 동작", () => {
  it("API 키 있을 때 embeddings 반환", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(make_mock_response([[1, 2, 3], [4, 5, 6]], 20) as unknown as Response);

    const embed = create_embed_service({
      get_api_key: async () => "test-api-key",
      api_base: "https://openrouter.ai/api/v1",
    });

    const result = await embed(["hello", "world"], { model: "text-embed-small" });
    expect(result.embeddings).toHaveLength(2);
    expect(result.embeddings[0]).toEqual([1, 2, 3]);
    expect(result.token_usage).toBe(20);
  });

  it("API 키 없을 때 에러 던짐", async () => {
    const embed = create_embed_service({
      get_api_key: async () => null,
    });

    await expect(embed(["test"], {})).rejects.toThrow("embedding API key not configured");
  });

  it("skip_auth=true이면 API 키 없어도 요청", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(make_mock_response([[0.1, 0.2]]) as unknown as Response);

    const embed = create_embed_service({
      get_api_key: async () => null,
      skip_auth: true,
      api_base: "http://localhost:11434/v1",
    });

    const result = await embed(["test"], {});
    expect(result.embeddings).toHaveLength(1);
  });

  it("dimensions 옵션 전달 시 body에 포함", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(make_mock_response([[1, 2]]) as unknown as Response);

    const embed = create_embed_service({
      get_api_key: async () => "key",
    });

    await embed(["text"], { dimensions: 256 });

    const call = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(String(call[1]?.body));
    expect(body.dimensions).toBe(256);
  });

  it("dimensions 없으면 body에 미포함", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(make_mock_response([[1]]) as unknown as Response);

    const embed = create_embed_service({ get_api_key: async () => "key" });
    await embed(["text"], {});

    const call = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(String(call[1]?.body));
    expect(body.dimensions).toBeUndefined();
  });

  it("API 오류 응답 → 에러 던짐", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(make_error_response(401, "Unauthorized") as unknown as Response);

    const embed = create_embed_service({ get_api_key: async () => "bad-key" });
    await expect(embed(["test"], {})).rejects.toThrow("Embedding API error (401)");
  });

  it("index 순서대로 정렬", async () => {
    // 역순으로 반환된 경우 index로 정렬
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          { embedding: [3, 3, 3], index: 2 },
          { embedding: [1, 1, 1], index: 0 },
          { embedding: [2, 2, 2], index: 1 },
        ],
        usage: { total_tokens: 5 },
      }),
      text: async () => "",
      status: 200,
    } as unknown as Response);

    const embed = create_embed_service({ get_api_key: async () => "key" });
    const result = await embed(["a", "b", "c"], {});

    expect(result.embeddings[0]).toEqual([1, 1, 1]);
    expect(result.embeddings[1]).toEqual([2, 2, 2]);
    expect(result.embeddings[2]).toEqual([3, 3, 3]);
  });

  it("usage.total_tokens 없을 때 token_usage는 undefined", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ embedding: [1], index: 0 }] }),
      text: async () => "",
      status: 200,
    } as unknown as Response);

    const embed = create_embed_service({ get_api_key: async () => "key" });
    const result = await embed(["test"], {});
    expect(result.token_usage).toBeUndefined();
  });
});

describe("create_embed_service — 배치 처리", () => {
  it("96개 이하 → 단일 fetch 호출", async () => {
    vi.mocked(fetch).mockResolvedValue(make_mock_response([[1]]) as unknown as Response);

    const embed = create_embed_service({ get_api_key: async () => "key" });
    const texts = Array.from({ length: 5 }, (_, i) => `text ${i}`);
    await embed(texts, {});

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });
});

describe("create_embed_service_from_provider", () => {
  it("ollama → skip_auth=true (API 키 없어도 동작)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(make_mock_response([[0.5, 0.6]]) as unknown as Response);

    const embed = create_embed_service_from_provider({
      provider_type: "ollama",
      get_api_key: async () => null,
      api_base: "http://ollama:11434/v1",
    });

    const result = await embed(["test"], {});
    expect(result.embeddings).toHaveLength(1);
  });

  it("orchestrator_llm → skip_auth=true", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(make_mock_response([[1, 2]]) as unknown as Response);

    const embed = create_embed_service_from_provider({
      provider_type: "orchestrator_llm",
      get_api_key: async () => null,
      api_base: "http://localhost:11434/v1",
    });

    const result = await embed(["hello"], {});
    expect(result.embeddings).toHaveLength(1);
  });

  it("openai → skip_auth=false, API 키 필수", async () => {
    const embed = create_embed_service_from_provider({
      provider_type: "openai",
      get_api_key: async () => null,
    });

    await expect(embed(["test"], {})).rejects.toThrow("embedding API key not configured");
  });

  it("default_model 옵션 전달", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(make_mock_response([[1]]) as unknown as Response);

    const embed = create_embed_service_from_provider({
      provider_type: "openai",
      get_api_key: async () => "key",
      model: "custom-embed-model",
    });

    await embed(["test"], {});

    const call = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(String(call[1]?.body));
    expect(body.model).toBe("custom-embed-model");
  });
});

describe("create_multimodal_embed_service", () => {
  it("텍스트 입력 → {text: ...} 포맷으로 전송", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(make_mock_response([[0.1, 0.2]]) as unknown as Response);

    const embed = create_multimodal_embed_service({ get_api_key: async () => "key" });
    const result = await embed(["hello"], {});

    expect(result.embeddings).toHaveLength(1);
    const call = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(String(call[1]?.body));
    expect(body.input[0]).toEqual({ text: "hello" });
  });

  it("이미지 입력 → {image: data_url} 포맷으로 전송", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(make_mock_response([[0.3, 0.4]]) as unknown as Response);

    const embed = create_multimodal_embed_service({ get_api_key: async () => "key" });
    const data_url = "data:image/png;base64,abc123";
    await embed([{ image_data_url: data_url }], {});

    const call = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(String(call[1]?.body));
    expect(body.input[0]).toEqual({ image: data_url });
  });

  it("텍스트 + 이미지 혼합 입력", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(make_mock_response([[1], [2]]) as unknown as Response);

    const embed = create_multimodal_embed_service({ get_api_key: async () => "key" });
    await embed(["text", { image_data_url: "data:image/png;base64,x" }], {});

    const call = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(String(call[1]?.body));
    expect(body.input[0]).toEqual({ text: "text" });
    expect(body.input[1]).toEqual({ image: "data:image/png;base64,x" });
  });

  it("기본 모델 jina-ai/jina-clip-v2 사용", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(make_mock_response([[1]]) as unknown as Response);

    const embed = create_multimodal_embed_service({ get_api_key: async () => "key" });
    await embed(["test"], {});

    const call = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(String(call[1]?.body));
    expect(body.model).toBe("jina-ai/jina-clip-v2");
  });

  it("API 키 없을 때 에러 던짐", async () => {
    const embed = create_multimodal_embed_service({ get_api_key: async () => null });
    await expect(embed(["test"], {})).rejects.toThrow("image embedding API key not configured");
  });

  it("skip_auth=true → API 키 없어도 요청", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(make_mock_response([[0.1]]) as unknown as Response);

    const embed = create_multimodal_embed_service({ get_api_key: async () => null, skip_auth: true });
    const result = await embed(["test"], {});
    expect(result.embeddings).toHaveLength(1);
  });

  it("API 오류 응답 → 에러 던짐", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(make_error_response(403, "Forbidden") as unknown as Response);

    const embed = create_multimodal_embed_service({ get_api_key: async () => "key" });
    await expect(embed(["test"], {})).rejects.toThrow("Multimodal embedding API error (403)");
  });
});

// ── L54: res.text() throw → .catch(() => "") 폴백 ─────────────────────────

describe("create_embed_service — res.text() throw (L54 catch fallback)", () => {
  it("API 오류 + res.text() throw → .catch(() => '') 폴백 → 에러 메시지에 빈 문자열", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => { throw new Error("text error"); }, // L54: .catch(() => "") 호출됨
    } as unknown as Response);

    const embed = create_embed_service({ get_api_key: async () => "key" });
    await expect(embed(["test"], {})).rejects.toThrow("Embedding API error (500)");
  });
});

// ── L139: multimodal opts.dimensions → body.dimensions 추가 ──────────────

describe("create_multimodal_embed_service — dimensions 옵션 (L139)", () => {
  it("dimensions 있음 → body.dimensions 포함 (L139)", async () => {
    let captured_body: Record<string, unknown> = {};
    vi.mocked(fetch).mockImplementationOnce(async (_, init) => {
      captured_body = JSON.parse((init as RequestInit).body as string);
      return {
        ok: true,
        json: async () => ({ data: [{ embedding: [0.1, 0.2], index: 0 }] }),
      } as unknown as Response;
    });

    const embed = create_multimodal_embed_service({ get_api_key: async () => "key" });
    await embed(["text test"], { dimensions: 512 }); // L139: opts.dimensions = 512
    expect(captured_body.dimensions).toBe(512);
  });
});

// ── L152: multimodal res.text() throw → .catch(() => "") 폴백 ────────────

describe("create_multimodal_embed_service — res.text() throw (L152 catch fallback)", () => {
  it("API 오류 + res.text() throw → .catch(() => '') 폴백", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => { throw new Error("text error"); }, // L152: .catch(() => "") 호출됨
    } as unknown as Response);

    const embed = create_multimodal_embed_service({ get_api_key: async () => "key" });
    await expect(embed(["test"], {})).rejects.toThrow("Multimodal embedding API error (503)");
  });
});

describe("create_multimodal_embed_service_from_provider", () => {
  it("ollama → skip_auth=true", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(make_mock_response([[0.5]]) as unknown as Response);

    const embed = create_multimodal_embed_service_from_provider({
      provider_type: "ollama",
      get_api_key: async () => null,
      api_base: "http://ollama:11434/v1",
    });

    const result = await embed(["test"], {});
    expect(result.embeddings).toHaveLength(1);
  });

  it("openai → API 키 필수", async () => {
    const embed = create_multimodal_embed_service_from_provider({
      provider_type: "openai",
      get_api_key: async () => null,
    });

    await expect(embed(["test"], {})).rejects.toThrow("image embedding API key not configured");
  });
});
