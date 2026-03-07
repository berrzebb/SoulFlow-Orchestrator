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
  if (input === null || input === undefined) return undefined;
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

/** OpenRouter /api/v1/models 응답 파싱. */
function parse_openrouter_v1(data: Array<{
  id: string; name: string; context_length?: number;
  pricing?: { prompt?: string; completion?: string };
  architecture?: { modality?: string; input_modalities?: string[]; output_modalities?: string[] };
}>): ModelInfo[] {
  return data.map((m) => {
    const input = m.pricing?.prompt ? parseFloat(m.pricing.prompt) * 1_000_000 : undefined;
    const output = m.pricing?.completion ? parseFloat(m.pricing.completion) * 1_000_000 : undefined;
    return {
      id: m.id,
      name: m.name || m.id,
      provider: "openrouter",
      purpose: detect_openrouter_purpose(m.id, m.architecture),
      context_length: m.context_length,
      pricing_input: input,
      pricing_output: output,
      cost_score: compute_cost_score(input, output),
    };
  });
}

/** OpenRouter /api/frontend/models 응답 파싱 (embedding 모델 포함). */
function parse_openrouter_frontend(data: Array<{
  slug: string; name?: string; context_length?: number;
  endpoint?: { pricing?: { prompt?: string; completion?: string } };
}>): ModelInfo[] {
  return data
    .filter((m) => EMBED_PATTERNS.some((p) => p.test(m.slug)))
    .map((m) => {
      const pricing = m.endpoint?.pricing;
      const input = pricing?.prompt ? parseFloat(pricing.prompt) * 1_000_000 : undefined;
      const output = pricing?.completion ? parseFloat(pricing.completion) * 1_000_000 : undefined;
      return {
        id: m.slug,
        name: m.name || m.slug,
        provider: "openrouter",
        purpose: "embedding" as const,
        context_length: m.context_length,
        pricing_input: input,
        pricing_output: output,
        cost_score: compute_cost_score(input, output),
      };
    });
}

/** OpenRouter: /api/v1/models + /api/frontend/models (embedding 보충). */
export async function fetch_openrouter_models(api_key?: string): Promise<ModelInfo[]> {
  const cached = from_cache("openrouter");
  if (cached) return cached;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (api_key) headers.Authorization = `Bearer ${api_key}`;

  try {
    const [v1_res, fe_res] = await Promise.all([
      fetch("https://openrouter.ai/api/v1/models", { headers, signal: AbortSignal.timeout(TIMEOUT_MS) }),
      fetch("https://openrouter.ai/api/frontend/models", { signal: AbortSignal.timeout(TIMEOUT_MS) }).catch(() => null),
    ]);

    if (!v1_res.ok) { log.warn("openrouter /models failed", { status: v1_res.status }); return []; }
    const v1_json = await v1_res.json() as { data: Parameters<typeof parse_openrouter_v1>[0] };
    const models = parse_openrouter_v1(v1_json.data);

    // /api/v1/models에 없는 embedding 모델을 frontend API에서 보충
    if (fe_res?.ok) {
      try {
        const fe_json = await fe_res.json() as { data: Parameters<typeof parse_openrouter_frontend>[0] };
        const existing_ids = new Set(models.map((m) => m.id));
        const embed_models = parse_openrouter_frontend(fe_json.data).filter((m) => !existing_ids.has(m.id));
        models.push(...embed_models);
      } catch { /* frontend API 파싱 실패 시 무시 */ }
    }

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

/** API 키 없이도 사용할 수 있는 잘 알려진 모델 정적 카탈로그. */
const STATIC_ANTHROPIC_MODELS: ModelInfo[] = [
  { id: "claude-opus-4-6", name: "Claude Opus 4.6", provider: "anthropic", purpose: "chat" as const, context_length: 200000, pricing_input: 5, pricing_output: 25 },
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", provider: "anthropic", purpose: "chat" as const, context_length: 200000, pricing_input: 3, pricing_output: 15 },
  { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5", provider: "anthropic", purpose: "chat" as const, context_length: 200000, pricing_input: 1, pricing_output: 5 },
  { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5", provider: "anthropic", purpose: "chat" as const, context_length: 200000, pricing_input: 3, pricing_output: 15 },
  { id: "claude-opus-4-5", name: "Claude Opus 4.5", provider: "anthropic", purpose: "chat" as const, context_length: 200000, pricing_input: 5, pricing_output: 25 },
].map((m) => ({ ...m, cost_score: compute_cost_score(m.pricing_input, m.pricing_output) }));

const STATIC_GEMINI_MODELS: ModelInfo[] = [
  { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", provider: "gemini", purpose: "chat", context_length: 1048576 },
  { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", provider: "gemini", purpose: "chat", context_length: 1048576 },
  { id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite", provider: "gemini", purpose: "chat", context_length: 1048576 },
  { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", provider: "gemini", purpose: "chat", context_length: 1048576 },
  { id: "gemini-embedding-001", name: "Gemini Embedding 001", provider: "gemini", purpose: "embedding" },
];

const STATIC_OPENAI_MODELS: ModelInfo[] = [
  { id: "gpt-5.4", name: "GPT-5.4", provider: "openai", purpose: "chat" as const, context_length: 272000, pricing_input: 2.5, pricing_output: 15 },
  { id: "gpt-5", name: "GPT-5", provider: "openai", purpose: "chat" as const, pricing_input: 1.25, pricing_output: 10 },
  { id: "gpt-5-mini", name: "GPT-5 Mini", provider: "openai", purpose: "chat" as const, pricing_input: 0.25, pricing_output: 2 },
  { id: "gpt-5-nano", name: "GPT-5 Nano", provider: "openai", purpose: "chat" as const, pricing_input: 0.05, pricing_output: 0.4 },
  { id: "o3", name: "o3", provider: "openai", purpose: "chat" as const, context_length: 200000, pricing_input: 2, pricing_output: 8 },
  { id: "o4-mini", name: "o4-mini", provider: "openai", purpose: "chat" as const, context_length: 200000, pricing_input: 1.1, pricing_output: 4.4 },
  { id: "gpt-4.1", name: "GPT-4.1", provider: "openai", purpose: "chat" as const, context_length: 1047576, pricing_input: 2, pricing_output: 8 },
  { id: "gpt-4.1-mini", name: "GPT-4.1 Mini", provider: "openai", purpose: "chat" as const, context_length: 1047576, pricing_input: 0.4, pricing_output: 1.6 },
  { id: "gpt-4.1-nano", name: "GPT-4.1 Nano", provider: "openai", purpose: "chat" as const, context_length: 1047576, pricing_input: 0.1, pricing_output: 0.4 },
  { id: "text-embedding-3-large", name: "Text Embedding 3 Large", provider: "openai", purpose: "embedding" as const, pricing_input: 0.13 },
  { id: "text-embedding-3-small", name: "Text Embedding 3 Small", provider: "openai", purpose: "embedding" as const, pricing_input: 0.02 },
].map((m) => ({ ...m, cost_score: compute_cost_score(m.pricing_input, m.pricing_output) }));

/** Anthropic: /v1/models API. API 키 없으면 정적 카탈로그 반환. */
export async function fetch_anthropic_models(api_key?: string): Promise<ModelInfo[]> {
  const cached = from_cache("anthropic");
  if (cached) return cached;

  if (!api_key) return STATIC_ANTHROPIC_MODELS;

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

/** Google Gemini: /v1beta/models API. API 키 없으면 정적 카탈로그 반환. */
export async function fetch_gemini_models(api_key?: string): Promise<ModelInfo[]> {
  const cached = from_cache("gemini");
  if (cached) return cached;

  if (!api_key) return STATIC_GEMINI_MODELS;

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

/** OpenAI 정적 카탈로그 (API 키 없을 때 사용). */
export function get_static_openai_models(): ModelInfo[] {
  return STATIC_OPENAI_MODELS;
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
