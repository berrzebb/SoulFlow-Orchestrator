/**
 * PAR-3: evaluate_critic_condition + run_critic_gate 검증.
 */

import { describe, it, expect, vi } from "vitest";
import {
  evaluate_critic_condition,
  run_critic_gate,
  DEFAULT_MAX_ROUNDS,
  type CriticFn,
} from "../../src/orchestration/critic-gate.js";

// ── evaluate_critic_condition ─────────────────────────────────────

describe("evaluate_critic_condition", () => {
  it("true 반환 → pass", () => {
    const r = evaluate_critic_condition({ score: 0.9 }, "value.score > 0.5");
    expect(r.verdict).toBe("pass");
  });

  it('"pass" 반환 → pass', () => {
    const r = evaluate_critic_condition("ok", '"pass"');
    expect(r.verdict).toBe("pass");
  });

  it('"rework" 반환 → rework', () => {
    const r = evaluate_critic_condition(null, '"rework"');
    expect(r.verdict).toBe("rework");
    expect(r.rework_instruction).toBeDefined();
  });

  it("false 반환 → fail + reason", () => {
    const r = evaluate_critic_condition(0, "value > 1");
    expect(r.verdict).toBe("fail");
    expect(r.reason).toContain("false");
  });

  it("null 값 → fail", () => {
    const r = evaluate_critic_condition(null, "value !== null");
    expect(r.verdict).toBe("fail");
  });

  it("표현식 오류 → fail + error reason", () => {
    const r = evaluate_critic_condition({}, "value.nonexistent.deep.prop > 0");
    expect(r.verdict).toBe("fail");
    expect(r.reason).toMatch(/condition error/);
  });

  it("복잡한 객체 평가 → pass", () => {
    const r = evaluate_critic_condition({ items: [1, 2, 3] }, "Array.isArray(value.items) && value.items.length > 0");
    expect(r.verdict).toBe("pass");
  });
});

// ── DEFAULT_MAX_ROUNDS ────────────────────────────────────────────

describe("DEFAULT_MAX_ROUNDS", () => {
  it("기본값 2", () => {
    expect(DEFAULT_MAX_ROUNDS).toBe(2);
  });
});

// ── run_critic_gate ───────────────────────────────────────────────

describe("run_critic_gate — 즉시 종료", () => {
  it("첫 평가 pass → rounds_used 1, retry 없음", () => {
    const critic: CriticFn = () => ({ verdict: "pass" });
    const retry = vi.fn(() => null);
    const { result, budget } = run_critic_gate("value", critic, retry);
    expect(result.verdict).toBe("pass");
    expect(budget.rounds_used).toBe(1);
    expect(retry).not.toHaveBeenCalled();
  });

  it("첫 평가 fail → rounds_used 1, retry 없음", () => {
    const critic: CriticFn = () => ({ verdict: "fail", reason: "bad" });
    const retry = vi.fn(() => null);
    const { result, budget } = run_critic_gate("value", critic, retry);
    expect(result.verdict).toBe("fail");
    expect(budget.rounds_used).toBe(1);
    expect(retry).not.toHaveBeenCalled();
  });
});

describe("run_critic_gate — rework 후 성공", () => {
  it("rework → retry → pass (rounds_used 2)", () => {
    let call = 0;
    const critic: CriticFn = () => {
      call++;
      return call === 1
        ? { verdict: "rework", rework_instruction: "fix it" }
        : { verdict: "pass" };
    };
    const retry = vi.fn(() => "fixed_value");
    const { result, budget, final_value } = run_critic_gate("initial", critic, retry);
    expect(result.verdict).toBe("pass");
    expect(budget.rounds_used).toBe(2);
    expect(retry).toHaveBeenCalledTimes(1);
    expect(retry).toHaveBeenCalledWith("fix it", 1);
    expect(final_value).toBe("fixed_value");
  });
});

describe("run_critic_gate — budget 소진", () => {
  it("항상 rework → max_rounds 소진 후 fail (기본 max=2, 총 3회 평가)", () => {
    const critic: CriticFn = () => ({ verdict: "rework", rework_instruction: "retry" });
    const retry = vi.fn((instr: string, round: number) => `round_${round}`);
    const { result, budget } = run_critic_gate("start", critic, retry);
    expect(result.verdict).toBe("fail");
    expect(result.reason).toMatch(/exhausted/);
    // rounds_used: 첫 평가(1) + 2 retry = rounds_used 3 (but budget.rounds_used tracks evaluation count)
    expect(budget.rounds_used).toBe(DEFAULT_MAX_ROUNDS + 1);
    expect(retry).toHaveBeenCalledTimes(DEFAULT_MAX_ROUNDS);
  });

  it("max_rounds=1 → 두 번째 rework에서 바로 fail", () => {
    const critic: CriticFn = () => ({ verdict: "rework" });
    const retry = vi.fn(() => "new_val");
    const { result, budget } = run_critic_gate("v", critic, retry, 1);
    expect(result.verdict).toBe("fail");
    expect(retry).toHaveBeenCalledTimes(1);
    expect(budget.rounds_used).toBe(2);
  });

  it("max_rounds=0 → 첫 rework에서 바로 fail, retry 미호출", () => {
    const critic: CriticFn = () => ({ verdict: "rework" });
    const retry = vi.fn(() => "x");
    const { result, budget } = run_critic_gate("v", critic, retry, 0);
    expect(result.verdict).toBe("fail");
    expect(retry).not.toHaveBeenCalled();
    expect(budget.rounds_used).toBe(1);
  });
});

describe("run_critic_gate — final_value 추적", () => {
  it("retry 후 값이 갱신됨", () => {
    let call = 0;
    const critic: CriticFn = () => ({ verdict: call++ < 2 ? "rework" : "pass" });
    const retry = vi.fn((instr: string, round: number) => `v${round}`);
    const { final_value } = run_critic_gate("init", critic, retry, 3);
    expect(final_value).toBe("v2");
  });
});
