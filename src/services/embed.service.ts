/** OpenRouter 기반 embedding 서비스. */

import { create_logger } from "../logger.js";
import { error_message } from "../utils/common.js";

const log = create_logger("embed-service");

const DEFAULT_MODEL = "openai/text-embedding-3-small";
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_BATCH_SIZE = 96;

export interface EmbedServiceDeps {
  get_api_key: () => Promise<string | null>;
  api_base?: string;
}

/** OpenRouter /embeddings 엔드포인트를 호출하여 텍스트 → 벡터 변환. */
export function create_embed_service(deps: EmbedServiceDeps) {
  const api_base = deps.api_base || "https://openrouter.ai/api/v1";

  return async (
    texts: string[],
    opts: { model?: string; dimensions?: number },
  ): Promise<{ embeddings: number[][]; token_usage?: number }> => {
    const api_key = await deps.get_api_key();
    if (!api_key) throw new Error("embedding API key not configured");

    const model = opts.model || DEFAULT_MODEL;
    const all_embeddings: number[][] = [];
    let total_tokens = 0;

    // 배치 분할
    for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
      const batch = texts.slice(i, i + MAX_BATCH_SIZE);

      const body: Record<string, unknown> = { model, input: batch };
      if (opts.dimensions) body.dimensions = opts.dimensions;

      const res = await fetch(`${api_base}/embeddings`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${api_key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });

      if (!res.ok) {
        const err = await res.text().catch(() => "");
        log.warn("embedding API error", { status: res.status, model });
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

    log.info("embed", { model, count: texts.length, tokens: total_tokens });
    return { embeddings: all_embeddings, token_usage: total_tokens || undefined };
  };
}
