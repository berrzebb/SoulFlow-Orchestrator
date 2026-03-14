/**
 * TR-5: Tokenizer/Hybrid Retrieval Eval Executor.
 *
 * 토크나이저 + 하이브리드 검색 함수를 EvalExecutorLike로 감싸
 * eval pipeline에서 deterministic 회귀 테스트를 실행.
 *
 * input JSON schema:
 *   tokenize         → { type, text }
 *   extract_keywords → { type, query }
 *   build_fts_query  → { type, query }
 *   normalize_query  → { type, query }
 *   rrf_merge        → { type, fts_ranked[], vec_ranked[], k? }
 *   mmr_rerank       → { type, items[], limit, lambda? }
 */

import type { EvalExecutorLike } from "./contracts.js";
import { DEFAULT_TOKENIZER } from "../search/index.js";
import { normalize_query } from "../orchestration/guardrails/session-reuse.js";
import { rrf_merge, mmr_rerank } from "../agent/memory-scoring.js";

export type TokenizerEvalInput =
  | { type: "tokenize"; text: string }
  | { type: "extract_keywords"; query: string }
  | { type: "build_fts_query"; query: string }
  | { type: "normalize_query"; query: string }
  | { type: "rrf_merge"; fts_ranked: string[]; vec_ranked: string[]; k?: number }
  | {
      type: "mmr_rerank";
      items: Array<{ id: string; score: number; content: string }>;
      limit: number;
      lambda?: number;
    };

export function create_tokenizer_executor(): EvalExecutorLike {
  return {
    async execute(raw_input: string) {
      try {
        const input: TokenizerEvalInput = JSON.parse(raw_input);

        if (input.type === "tokenize") {
          return { output: DEFAULT_TOKENIZER.tokenize(input.text).join(" ") };
        }

        if (input.type === "extract_keywords") {
          return { output: DEFAULT_TOKENIZER.extract_keywords(input.query).join(" ") };
        }

        if (input.type === "build_fts_query") {
          return { output: DEFAULT_TOKENIZER.build_fts_query(input.query) };
        }

        if (input.type === "normalize_query") {
          return { output: normalize_query(input.query) };
        }

        if (input.type === "rrf_merge") {
          const merged = rrf_merge(input.fts_ranked, input.vec_ranked, input.k);
          return { output: merged.map((s) => s.chunk_id).join(",") };
        }

        if (input.type === "mmr_rerank") {
          const content_map = new Map(input.items.map((item) => [item.id, item.content]));
          const scored = input.items.map((item) => ({ chunk_id: item.id, score: item.score }));
          const reranked = mmr_rerank(
            scored,
            (id) => content_map.get(id) ?? "",
            input.limit,
            input.lambda,
          );
          return { output: reranked.map((s) => s.chunk_id).join(",") };
        }

        return { output: "", error: `unknown tokenizer eval type: ${(input as Record<string, unknown>).type}` };
      } catch (e) {
        return { output: "", error: e instanceof Error ? e.message : String(e) };
      }
    },
  };
}
