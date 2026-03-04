/** Context Window Guard — 프롬프트 전송 전 토큰 추정 + 사전 차단. */

const DEFAULT_CHARS_PER_TOKEN = 4;
const DEFAULT_HARD_MIN_TOKENS = 16_000;
const DEFAULT_WARN_BELOW_TOKENS = 8_000;

export type ContextGuardOptions = {
  prompt_chars: number;
  chars_per_token?: number;
  hard_min_tokens?: number;
  warn_below_tokens?: number;
};

export type GuardResult =
  | { ok: true; estimated_tokens: number }
  | { ok: false; estimated_tokens: number; reason: "hard_block" | "warn" };

/** 프롬프트 크기 기반 토큰 추정. 모델 컨텍스트 윈도우가 부족하면 차단/경고. */
export function evaluate_context_window_guard(opts: ContextGuardOptions): GuardResult {
  const cpt = opts.chars_per_token ?? DEFAULT_CHARS_PER_TOKEN;
  const estimated_tokens = Math.ceil(opts.prompt_chars / cpt);
  const hard_min = opts.hard_min_tokens ?? DEFAULT_HARD_MIN_TOKENS;
  const warn_below = opts.warn_below_tokens ?? DEFAULT_WARN_BELOW_TOKENS;

  if (estimated_tokens >= hard_min) {
    return { ok: false, estimated_tokens, reason: "hard_block" };
  }
  if (estimated_tokens >= warn_below) {
    return { ok: false, estimated_tokens, reason: "warn" };
  }
  return { ok: true, estimated_tokens };
}
