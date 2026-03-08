/** OpenAI 호환 embedding 서비스 (OpenRouter, Ollama, vLLM 등). */

import { create_logger } from "../logger.js";

const log = create_logger("embed-service");

const DEFAULT_MODEL = "openai/text-embedding-3-small";
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_BATCH_SIZE = 96;

export interface EmbedServiceDeps {
  get_api_key: () => Promise<string | null>;
  api_base?: string;
  /** true이면 API 키 없이 요청 (Ollama 등 로컬 서비스). */
  skip_auth?: boolean;
  /** 기본 모델. */
  default_model?: string;
}

/** OpenAI 호환 /embeddings 엔드포인트로 텍스트 → 벡터 변환. */
export function create_embed_service(deps: EmbedServiceDeps) {
  const api_base = deps.api_base || "https://openrouter.ai/api/v1";
  const default_model = deps.default_model || DEFAULT_MODEL;

  return async (
    texts: string[],
    opts: { model?: string; dimensions?: number },
  ): Promise<{ embeddings: number[][]; token_usage?: number }> => {
    const api_key = deps.skip_auth ? null : await deps.get_api_key();
    if (!api_key && !deps.skip_auth) throw new Error("embedding API key not configured");

    const model = opts.model || default_model;
    const all_embeddings: number[][] = [];
    let total_tokens = 0;

    // 배치 분할
    for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
      const batch = texts.slice(i, i + MAX_BATCH_SIZE);

      const body: Record<string, unknown> = { model, input: batch };
      if (opts.dimensions) body.dimensions = opts.dimensions;

      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (api_key) headers.Authorization = `Bearer ${api_key}`;

      const res = await fetch(`${api_base}/embeddings`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });

      if (!res.ok) {
        const err = await res.text().catch(() => "");
        log.warn("embedding API error", { status: res.status, model, api_base });
        throw new Error(`Embedding API error (${res.status}): ${err.slice(0, 200)}`);
      }

      const json = await res.json() as {
        data: Array<{ embedding: number[]; index: number }>;
        usage?: { total_tokens?: number };
      };

      // index 순으로 정렬
      const sorted = json.data.sort((a, b) => a.index - b.index);
      for (const item of sorted) {
        all_embeddings.push(item.embedding);
      }
      total_tokens += json.usage?.total_tokens ?? 0;
    }

    log.info("embed", { model, count: texts.length, tokens: total_tokens, api_base });
    return { embeddings: all_embeddings, token_usage: total_tokens || undefined };
  };
}

/** 등록된 프로바이더 인스턴스 정보로 embed service 생성. */
export interface EmbedFromProviderOpts {
  provider_type: string;
  model?: string;
  api_base?: string;
  get_api_key: () => Promise<string | null>;
}

const SKIP_AUTH_PROVIDERS = new Set(["ollama", "orchestrator_llm"]);

export function create_embed_service_from_provider(opts: EmbedFromProviderOpts) {
  const skip_auth = SKIP_AUTH_PROVIDERS.has(opts.provider_type);
  return create_embed_service({
    get_api_key: opts.get_api_key,
    api_base: opts.api_base,
    skip_auth,
    default_model: opts.model || DEFAULT_MODEL,
  });
}

// ── 멀티모달 임베딩 ──────────────────────────────────────────────────────────

/** 이미지 + 텍스트 혼합 임베딩 입력. */
export type ImageEmbedInput = string | { image_data_url: string };

/**
 * 멀티모달 임베딩 함수 타입.
 * jina-clip-v2, voyage-multimodal-3 등 텍스트·이미지를 같은 벡터 공간에 임베딩하는 모델에 사용.
 */
export type ImageEmbedFn = (
  inputs: ImageEmbedInput[],
  opts: { model?: string; dimensions?: number },
) => Promise<{ embeddings: number[][] }>;

/**
 * 멀티모달 /embeddings 서비스.
 * - 텍스트 입력: { "text": "..." } 포맷
 * - 이미지 입력: { "image": "<data_url>" } 포맷 (jina-clip-v2 호환)
 */
export function create_multimodal_embed_service(deps: EmbedServiceDeps): ImageEmbedFn {
  const api_base = deps.api_base || "https://openrouter.ai/api/v1";
  const default_model = deps.default_model || "jina-ai/jina-clip-v2";

  return async (
    inputs: ImageEmbedInput[],
    opts: { model?: string; dimensions?: number },
  ): Promise<{ embeddings: number[][] }> => {
    const api_key = deps.skip_auth ? null : await deps.get_api_key();
    if (!api_key && !deps.skip_auth) throw new Error("image embedding API key not configured");

    const model = opts.model || default_model;
    const all_embeddings: number[][] = [];

    for (let i = 0; i < inputs.length; i += MAX_BATCH_SIZE) {
      const batch = inputs.slice(i, i + MAX_BATCH_SIZE);

      // jina-clip-v2 형식: [{ "text": "..." } | { "image": "<url_or_base64>" }]
      const input_items = batch.map((item) =>
        typeof item === "string" ? { text: item } : { image: item.image_data_url },
      );

      const body: Record<string, unknown> = { model, input: input_items };
      if (opts.dimensions) body.dimensions = opts.dimensions;

      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (api_key) headers.Authorization = `Bearer ${api_key}`;

      const res = await fetch(`${api_base}/embeddings`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });

      if (!res.ok) {
        const err = await res.text().catch(() => "");
        log.warn("multimodal embedding API error", { status: res.status, model });
        throw new Error(`Multimodal embedding API error (${res.status}): ${err.slice(0, 200)}`);
      }

      const json = await res.json() as {
        data: Array<{ embedding: number[]; index: number }>;
      };
      const sorted = json.data.sort((a, b) => a.index - b.index);
      for (const item of sorted) all_embeddings.push(item.embedding);
    }

    log.info("image-embed", { model, count: inputs.length, api_base });
    return { embeddings: all_embeddings };
  };
}

export function create_multimodal_embed_service_from_provider(opts: EmbedFromProviderOpts): ImageEmbedFn {
  const skip_auth = SKIP_AUTH_PROVIDERS.has(opts.provider_type);
  return create_multimodal_embed_service({
    get_api_key: opts.get_api_key,
    api_base: opts.api_base,
    skip_auth,
    default_model: opts.model,
  });
}
