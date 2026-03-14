/**
 * PAR-3: CriticGate — 조건 기반 bounded retry loop.
 *
 * reconcile 결과를 critic 함수로 평가하여 pass/fail/rework 판정.
 * rework 시 retry_fn을 호출하여 새 값을 받아 재평가.
 * DEFAULT_MAX_ROUNDS 초과 시 항상 "fail"로 강제 종료.
 */

// ── Types ────────────────────────────────────────────────────────

/** Critic 판정 결과. */
export type CriticVerdict = "pass" | "fail" | "rework";

/** Critic 한 번의 평가 결과. */
export interface CriticGateResult {
  verdict: CriticVerdict;
  reason?: string;
  rework_instruction?: string;
}

/** Retry 예산 — 남은 라운드 추적. */
export interface RetryBudget {
  max_rounds: number;
  rounds_used: number;
}

export const DEFAULT_MAX_ROUNDS = 2;

/** Critic 평가 함수 시그니처. */
export type CriticFn = (value: unknown, budget: RetryBudget) => CriticGateResult;

// ── evaluate_critic_condition ─────────────────────────────────────

/**
 * JS 조건 표현식을 평가하여 CriticGateResult 반환.
 * 표현식은 `value` 변수를 참조할 수 있다.
 * - true / "pass" → pass
 * - "rework"      → rework
 * - 그 외        → fail
 */
export function evaluate_critic_condition(value: unknown, condition: string): CriticGateResult {
  try {
    // new Function: 표현식 평가. value를 스코프로 주입.
    const fn = new Function("value", `return (${condition})`);
    const result = fn(value) as unknown;
    if (result === true || result === "pass") return { verdict: "pass" };
    if (result === "rework") return { verdict: "rework", rework_instruction: "condition returned rework" };
    return { verdict: "fail", reason: `condition evaluated to: ${JSON.stringify(result)}` };
  } catch (err) {
    return { verdict: "fail", reason: `condition error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ── run_critic_gate ───────────────────────────────────────────────

/**
 * Bounded critic retry loop.
 *
 * 1. critic_fn(current_value, budget) 호출
 * 2. "pass" / "fail" → 즉시 반환
 * 3. "rework" + 예산 남음 → retry_fn(instruction, round)으로 새 값 획득 후 재시도
 * 4. "rework" + 예산 소진 → verdict를 "fail"로 강제 종료
 *
 * @param initial_value  첫 번째 평가 대상 값
 * @param critic_fn      평가 함수
 * @param retry_fn       rework 시 새 값을 반환하는 콜백 (instruction, round)
 * @param max_rounds     최대 재시도 횟수 (기본 2)
 */
export function run_critic_gate(
  initial_value: unknown,
  critic_fn: CriticFn,
  retry_fn: (instruction: string, round: number) => unknown,
  max_rounds: number = DEFAULT_MAX_ROUNDS,
): { result: CriticGateResult; final_value: unknown; budget: RetryBudget } {
  const budget: RetryBudget = { max_rounds, rounds_used: 0 };
  let current_value = initial_value;

  while (budget.rounds_used <= max_rounds) {
    const result = critic_fn(current_value, { ...budget });
    budget.rounds_used++;

    if (result.verdict !== "rework") {
      return { result, final_value: current_value, budget };
    }

    if (budget.rounds_used > max_rounds) {
      return {
        result: { verdict: "fail", reason: `critic budget exhausted after ${max_rounds} rounds` },
        final_value: current_value,
        budget,
      };
    }

    current_value = retry_fn(result.rework_instruction ?? "", budget.rounds_used);
  }

  return {
    result: { verdict: "fail", reason: "critic budget exhausted" },
    final_value: current_value,
    budget,
  };
}
