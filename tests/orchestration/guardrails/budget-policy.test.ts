import { describe, it, expect } from "vitest";
import {
  create_budget_state,
  is_budget_enabled,
  is_budget_exceeded,
  remaining_calls,
  record_tool_calls,
  DISABLED_POLICY,
  STOP_REASON_BUDGET_EXCEEDED,
  type ExecutionBudgetPolicy,
} from "../../../src/orchestration/guardrails/budget-policy.js";

describe("ExecutionBudgetPolicy", () => {
  it("DISABLED_POLICY → max_tool_calls_per_run = 0", () => {
    expect(DISABLED_POLICY.max_tool_calls_per_run).toBe(0);
  });

  it("is_budget_enabled: 0 → false", () => {
    expect(is_budget_enabled({ max_tool_calls_per_run: 0 })).toBe(false);
  });

  it("is_budget_enabled: > 0 → true", () => {
    expect(is_budget_enabled({ max_tool_calls_per_run: 10 })).toBe(true);
  });
});

describe("ToolCallBudgetState", () => {
  const policy: ExecutionBudgetPolicy = { max_tool_calls_per_run: 5 };

  it("초기 상태: executed_count = 0", () => {
    const state = create_budget_state(policy);
    expect(state.executed_count).toBe(0);
    expect(state.policy).toBe(policy);
  });

  it("record_tool_calls: 카운트 증가", () => {
    const s0 = create_budget_state(policy);
    const s1 = record_tool_calls(s0);
    expect(s1.executed_count).toBe(1);
    expect(s0.executed_count).toBe(0); // immutable
  });

  it("record_tool_calls: 배치 증가", () => {
    const s0 = create_budget_state(policy);
    const s1 = record_tool_calls(s0, 3);
    expect(s1.executed_count).toBe(3);
  });

  it("remaining_calls: 정확한 잔여 계산", () => {
    const s0 = create_budget_state(policy);
    expect(remaining_calls(s0)).toBe(5);
    const s1 = record_tool_calls(s0, 3);
    expect(remaining_calls(s1)).toBe(2);
  });

  it("remaining_calls: 초과해도 음수 아님", () => {
    const s0 = create_budget_state(policy);
    const s1 = record_tool_calls(s0, 10);
    expect(remaining_calls(s1)).toBe(0);
  });
});

describe("is_budget_exceeded", () => {
  const policy: ExecutionBudgetPolicy = { max_tool_calls_per_run: 3 };

  it("미달 → false", () => {
    const s = record_tool_calls(create_budget_state(policy), 2);
    expect(is_budget_exceeded(s)).toBe(false);
  });

  it("정확히 한도 → true", () => {
    const s = record_tool_calls(create_budget_state(policy), 3);
    expect(is_budget_exceeded(s)).toBe(true);
  });

  it("한도 초과 → true", () => {
    const s = record_tool_calls(create_budget_state(policy), 5);
    expect(is_budget_exceeded(s)).toBe(true);
  });
});

describe("disabled (0 = disabled) semantics", () => {
  it("disabled → is_budget_exceeded 항상 false", () => {
    const s = record_tool_calls(create_budget_state(DISABLED_POLICY), 9999);
    expect(is_budget_exceeded(s)).toBe(false);
  });

  it("disabled → remaining_calls = Infinity", () => {
    const s = create_budget_state(DISABLED_POLICY);
    expect(remaining_calls(s)).toBe(Infinity);
  });

  it("disabled → is_budget_enabled = false", () => {
    expect(is_budget_enabled(DISABLED_POLICY)).toBe(false);
  });
});

describe("STOP_REASON_BUDGET_EXCEEDED", () => {
  it("상수값 고정", () => {
    expect(STOP_REASON_BUDGET_EXCEEDED).toBe("max_tool_calls_exceeded");
  });
});
