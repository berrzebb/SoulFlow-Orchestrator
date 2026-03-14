/** 메모리 검색 스코어링: RRF 융합 + 시간 감쇠. */

import { DEFAULT_TOKENIZER } from "../search/index.js";

/** RRF 파라미터. 낮을수록 상위 순위 집중, 높을수록 균등. memsearch 기본값. */
const RRF_K = 60;

/** 일별 기록 시간 감쇠 반감기 (일). */
const DECAY_HALF_LIFE_DAYS = 14;

/** ln(2) / half_life */
const DECAY_LAMBDA = Math.LN2 / DECAY_HALF_LIFE_DAYS;

export interface ScoredChunk {
  chunk_id: string;
  score: number;
}

/**
 * Reciprocal Rank Fusion — 두 랭킹 리스트를 점수 스케일 무관하게 병합.
 *
 * RRF_score(d) = Σ 1/(k + rank_i(d))
 *
 * 순위 기반이므로 BM25 점수와 벡터 거리의 스케일 차이를 정규화할 필요 없음.
 */
export function rrf_merge(
  fts_ranked: string[],
  vec_ranked: string[],
  k = RRF_K,
): ScoredChunk[] {
  const scores = new Map<string, number>();

  for (let i = 0; i < fts_ranked.length; i++) {
    const id = fts_ranked[i];
    scores.set(id, (scores.get(id) || 0) + 1 / (k + i));
  }
  for (let i = 0; i < vec_ranked.length; i++) {
    const id = vec_ranked[i];
    scores.set(id, (scores.get(id) || 0) + 1 / (k + i));
  }

  return [...scores.entries()]
    .map(([chunk_id, score]) => ({ chunk_id, score }))
    .sort((a, b) => b.score - a.score);
}

/**
 * 시간 감쇠 적용. longterm(evergreen) 문서는 감쇠 면제.
 *
 * decayed = score × e^(-λ × age_days)
 */
export function apply_temporal_decay(
  scored: ScoredChunk[],
  age_fn: (chunk_id: string) => number | null,
): ScoredChunk[] {
  return scored.map(({ chunk_id, score }) => {
    const age = age_fn(chunk_id);
    if (age === null) return { chunk_id, score }; // evergreen
    const decay = Math.exp(-DECAY_LAMBDA * Math.max(0, age));
    return { chunk_id, score: score * decay };
  }).sort((a, b) => b.score - a.score);
}

/**
 * MMR (Maximal Marginal Relevance) 리랭킹.
 * 관련도와 다양성 균형. lambda=1이면 순수 관련도, 0이면 최대 다양성.
 *
 * MMR = λ × relevance - (1-λ) × max_sim(selected)
 * 유사도는 Jaccard 토큰 유사도 (벡터 없이 텍스트만으로 계산).
 */
export function mmr_rerank(
  scored: ScoredChunk[],
  content_fn: (chunk_id: string) => string,
  limit: number,
  lambda = 0.7,
): ScoredChunk[] {
  if (scored.length <= 1 || lambda >= 1.0) return scored.slice(0, limit);

  const selected: ScoredChunk[] = [];
  const remaining = [...scored];
  const max_score = remaining[0]?.score || 1;

  // 토큰셋 캐시 — 동일 chunk를 루프마다 재계산하지 않도록
  const token_cache = new Map<string, Set<string>>();
  const get_tokens = (id: string): Set<string> => {
    let t = token_cache.get(id);
    if (!t) { t = new Set(DEFAULT_TOKENIZER.tokenize(content_fn(id))); token_cache.set(id, t); }
    return t;
  };

  while (selected.length < limit && remaining.length > 0) {
    let best_idx = 0;
    let best_mmr = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const relevance = remaining[i].score / max_score;
      let max_sim = 0;
      if (selected.length > 0) {
        const candidate_tokens = get_tokens(remaining[i].chunk_id);
        for (const s of selected) {
          const sim = jaccard(candidate_tokens, get_tokens(s.chunk_id));
          if (sim > max_sim) max_sim = sim;
        }
      }
      const mmr = lambda * relevance - (1 - lambda) * max_sim;
      if (mmr > best_mmr) { best_mmr = mmr; best_idx = i; }
    }

    selected.push(remaining[best_idx]);
    remaining.splice(best_idx, 1);
  }

  return selected;
}


function jaccard(a: Set<string>, b: Set<string>): number {
  let intersection = 0;
  for (const w of a) if (b.has(w)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
