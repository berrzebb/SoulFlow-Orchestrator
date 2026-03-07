/** 프로바이더별 모델 카탈로그 동적 조회 서비스. */

import { create_logger } from "../logger.js";

const log = create_logger("model-catalog");

const TIMEOUT_MS = 15_000;
const CACHE_TTL_MS = 5 * 60_000;

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  purpose: "chat" | "embedding" | "both";
  context_length?: number;
  /** USD per 1M input tokens. */
  pricing_input?: number;
  /** USD per 1M output tokens (null for embedding). */
  pricing_output?: number;
  /** 낮을수록 비용 효율 좋음. (input + output) / 2M tokens 기준. */
  cost_score?: number;
}

interface CacheEntry {
  models: ModelInfo[];
  fetched_at: number;
}

const cache = new Map<string, CacheEntry>();

function from_cache(key: string): ModelInfo[] | null {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.fetched_at < CACHE_TTL_MS) return entry.models;
  return null;
}

function to_cache(key: string, models: ModelInfo[]): void {
  cache.set(key, { models, fetched_at: Date.now() });
}

function compute_cost_score(input?: number, output?: number): number | undefined {
  if (input == null) return undefined;
  return Math.round(((input + (output ?? 0)) / 2) * 1000) / 1000;
}

/** 잘 알려진 embedding 모델 ID 패턴. */
const EMBED_PATTERNS = [
  /embed/i, /e5-/i, /bge-/i, /gte-/i, /nomic-embed/i,
  /voyage-/i, /cohere\/embed/i, /jina.*embed/i,
];

function detect_openrouter_purpose(
  id: string,
  arch?: { modality?: string; input_modalities?: string[]; output_modalities?: string[] },
): "chat" | "embedding" | "both" {
  // output_modalities에 embedding이 포함되면 확실
  if (arch?.output_modalities?.includes("embedding")) return "embedding";
  // modality 문자열에 embed 포함
  if (arch?.modality?.toLowerCase().includes("embed")) return "embedding";
  // 모델 ID 패턴 매칭
  if (EMBED_PATTERNS.some((p) => p.test(id))) return "embedding";
  return "chat";
}

/** OpenRouter: /models API → 모델 목록 + 가격. */
export async function fetch_openrouter_models(api_key?: string): Promise<ModelInfo[]> {
  const cached = from_cache("openrouter");
  if (cached) return cached;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (api_key) headers.Authorization = `Bearer ${api_key}`;

  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) { log.warn("openrouter /models failed", { status: res.status }); return []; }

    const json = await res.json() as {
      data: Array<{
        id: string;
        name: string;
        context_length?: number;
        pricing?: { prompt?: string; completion?: string };
        architecture?: {
          modality?: string;
          input_modalities?: string[];
          output_modalities?: string[];
        };
      }>;
    };

    const models: ModelInfo[] = json.data.map((m) => {
      const input = m.pricing?.prompt ? parseFloat(m.pricing.prompt) * 1_000_000 : undefined;
      const output = m.pricing?.completion ? parseFloat(m.pricing.completion) * 1_000_000 : undefined;
      const purpose = detect_openrouter_purpose(m.id, m.architecture);
      return {
        id: m.id,
        name: m.name || m.id,
        provider: "openrouter",
        purpose,
        context_length: m.context_length,
        pricing_input: input,
        pricing_output: output,
        cost_score: compute_cost_score(input, output),
      };
    });

    to_cache("openrouter", models);
    log.info("openrouter models fetched", { count: models.length });
    return models;
  } catch (e) {
    log.warn("openrouter models fetch error", { error: String(e) });
    return [];
  }
}

/** OpenAI-compatible: /models API. */
export async function fetch_openai_models(api_base: string, api_key?: string): Promise<ModelInfo[]> {
  const cache_key = `openai:${api_base}`;
  const cached = from_cache(cache_key);
  if (cached) return cached;

  const headers: Record<string, string> = {};
  if (api_key) headers.Authorization = `Bearer ${api_key}`;

  try {
    const url = `${api_base.replace(/\/$/, "")}/models`;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) { log.warn("openai /models failed", { status: res.status, api_base }); return []; }

    const json = await res.json() as { data: Array<{ id: string; owned_by?: string }> };

    const models: ModelInfo[] = json.data.map((m) => {
      const is_embed = m.id.includes("embed");
      return {
        id: m.id,
        name: m.id,
        provider: "openai_compatible",
        purpose: is_embed ? "embedding" : "chat",
      };
    });

    to_cache(cache_key, models);
    log.info("openai models fetched", { api_base, count: models.length });
    return models;
  } catch (e) {
    log.warn("openai models fetch error", { api_base, error: String(e) });
    return [];
  }
}

/** Anthropic: /v1/models API. */
export async function fetch_anthropic_models(api_key?: string): Promise<ModelInfo[]> {
  const cached = from_cache("anthropic");
  if (cached) return cached;

  if (!api_key) return [];

  try {
    const res = await fetch("https://api.anthropic.com/v1/models", {
      headers: {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) { log.warn("anthropic /models failed", { status: res.status }); return []; }

    const json = await res.json() as { data: Array<{ id: string; display_name?: string; type?: string }> };

    const models: ModelInfo[] = json.data.map((m) => ({
      id: m.id,
      name: m.display_name || m.id,
      provider: "anthropic",
      purpose: "chat" as const,
    }));

    to_cache("anthropic", models);
    log.info("anthropic models fetched", { count: models.length });
    return models;
  } catch (e) {
    log.warn("anthropic models fetch error", { error: String(e) });
    return [];
  }
}

/** Google Gemini: /v1beta/models API. */
export async function fetch_gemini_models(api_key?: string): Promise<ModelInfo[]> {
  const cached = from_cache("gemini");
  if (cached) return cached;

  if (!api_key) return [];

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${api_key}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) { log.warn("gemini /models failed", { status: res.status }); return []; }

    const json = await res.json() as {
      models: Array<{
        name: string;
        displayName: string;
        inputTokenLimit?: number;
        outputTokenLimit?: number;
        supportedGenerationMethods?: string[];
      }>;
    };

    const models: ModelInfo[] = (json.models || []).map((m) => {
      const id = m.name.replace("models/", "");
      const is_embed = m.supportedGenerationMethods?.includes("embedContent") ?? false;
      return {
        id,
        name: m.displayName || id,
        provider: "gemini",
        purpose: is_embed ? "embedding" : "chat",
        context_length: m.inputTokenLimit,
      };
    });

    to_cache("gemini", models);
    log.info("gemini models fetched", { count: models.length });
    return models;
  } catch (e) {
    log.warn("gemini models fetch error", { error: String(e) });
    return [];
  }
}

/** Ollama: /api/tags API. */
export async function fetch_ollama_models(ollama_base: string): Promise<ModelInfo[]> {
  const cache_key = `ollama:${ollama_base}`;
  const cached = from_cache(cache_key);
  if (cached) return cached;

  try {
    const url = `${ollama_base.replace(/\/$/, "")}/api/tags`;
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) { log.warn("ollama /api/tags failed", { status: res.status }); return []; }

    const json = await res.json() as { models: Array<{ name: string; size?: number; details?: { family?: string } }> };

    const models: ModelInfo[] = (json.models || []).map((m) => {
      const is_embed = m.name.includes("embed") || m.details?.family === "bert";
      return {
        id: m.name,
        name: m.name,
        provider: "ollama",
        purpose: is_embed ? "embedding" : "chat",
      };
    });

    to_cache(cache_key, models);
    log.info("ollama models fetched", { base: ollama_base, count: models.length });
    return models;
  } catch (e) {
    log.warn("ollama models fetch error", { base: ollama_base, error: String(e) });
    return [];
  }
}

/** 캐시 무효화. */
export function invalidate_model_cache(provider?: string): void {
  if (provider) {
    for (const key of cache.keys()) {
      if (key.startsWith(provider)) cache.delete(key);
    }
  } else {
    cache.clear();
  }
}
