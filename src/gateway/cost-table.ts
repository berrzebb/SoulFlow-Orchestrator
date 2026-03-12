/** 모델별 토큰 단가 테이블 (USD / 1M tokens). */

export type TokenPricing = {
  input_per_1m: number;
  output_per_1m: number;
  cache_read_per_1m?: number;
  cache_write_per_1m?: number;
};

/** 기준일: 2026-03 Anthropic·OpenAI·Google 공개 가격 */
const PRICING_TABLE: Record<string, TokenPricing> = {
  // ── Anthropic ──
  "claude-opus-4-6":    { input_per_1m: 15.00, output_per_1m: 75.00,  cache_read_per_1m: 1.50,  cache_write_per_1m: 18.75 },
  "claude-opus-4-5":    { input_per_1m: 15.00, output_per_1m: 75.00,  cache_read_per_1m: 1.50,  cache_write_per_1m: 18.75 },
  "claude-sonnet-4-6":  { input_per_1m: 3.00,  output_per_1m: 15.00,  cache_read_per_1m: 0.30,  cache_write_per_1m: 3.75  },
  "claude-sonnet-4-5":  { input_per_1m: 3.00,  output_per_1m: 15.00,  cache_read_per_1m: 0.30,  cache_write_per_1m: 3.75  },
  "claude-haiku-4-5":   { input_per_1m: 0.80,  output_per_1m: 4.00,   cache_read_per_1m: 0.08,  cache_write_per_1m: 1.00  },
  // ── OpenAI ──
  "gpt-4o":             { input_per_1m: 2.50,  output_per_1m: 10.00,  cache_read_per_1m: 1.25  },
  "gpt-4o-mini":        { input_per_1m: 0.15,  output_per_1m: 0.60,   cache_read_per_1m: 0.075 },
  "o1":                 { input_per_1m: 15.00, output_per_1m: 60.00,  cache_read_per_1m: 7.50  },
  "o3":                 { input_per_1m: 10.00, output_per_1m: 40.00,  cache_read_per_1m: 2.50  },
  "o3-mini":            { input_per_1m: 1.10,  output_per_1m: 4.40,   cache_read_per_1m: 0.55  },
  "o4-mini":            { input_per_1m: 1.10,  output_per_1m: 4.40,   cache_read_per_1m: 0.275 },
  // ── Google ──
  "gemini-2.5-pro":     { input_per_1m: 1.25,  output_per_1m: 10.00  },
  "gemini-2.0-flash":   { input_per_1m: 0.10,  output_per_1m: 0.40   },
  "gemini-2.0-flash-lite": { input_per_1m: 0.075, output_per_1m: 0.30 },
};

/** 모델명으로 단가 조회. 버전 suffix(날짜 등) 포함 이름도 prefix 매칭으로 처리. */
export function get_pricing(model: string): TokenPricing | null {
  if (!model) return null;
  if (PRICING_TABLE[model]) return PRICING_TABLE[model];
  const key = Object.keys(PRICING_TABLE).find(
    (k) => model.startsWith(k) || model.toLowerCase().includes(k.toLowerCase()),
  );
  return key ? PRICING_TABLE[key] : null;
}

/** 토큰 수로 USD 비용 추정. 단가 정보 없는 모델은 0 반환. */
export function estimate_cost_usd(
  model: string,
  input_tokens: number,
  output_tokens: number,
  cache_read_tokens = 0,
  cache_write_tokens = 0,
): number {
  const p = get_pricing(model);
  if (!p) return 0;
  let cost = (input_tokens / 1_000_000) * p.input_per_1m;
  cost += (output_tokens / 1_000_000) * p.output_per_1m;
  if (cache_read_tokens > 0 && p.cache_read_per_1m) {
    cost += (cache_read_tokens / 1_000_000) * p.cache_read_per_1m;
  }
  if (cache_write_tokens > 0 && p.cache_write_per_1m) {
    cost += (cache_write_tokens / 1_000_000) * p.cache_write_per_1m;
  }
  return cost;
}

/** 현재 단가 테이블 전체 반환 (dashboard 표시용). */
export function get_all_pricing(): Record<string, TokenPricing> {
  return { ...PRICING_TABLE };
}
