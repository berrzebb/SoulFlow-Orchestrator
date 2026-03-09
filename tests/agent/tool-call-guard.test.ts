import { describe, it, expect } from "vitest";
import { ConsecutiveToolCallGuard } from "@src/agent/tool-call-guard.js";
import type { ToolCallRequest } from "@src/providers/types.js";

function make_call(name: string, args: Record<string, unknown> = {}): ToolCallRequest {
  return { id: "call_1", name, arguments: args };
}

describe("ConsecutiveToolCallGuard", () => {
  it("첫 호출 → 차단 안 함", () => {
    const guard = new ConsecutiveToolCallGuard(2);
    const result = guard.observe([make_call("web_search", { q: "test" })]);
    expect(result.blocked).toBe(false);
  });

  it("동일 호출 반복 시 차단", () => {
    const guard = new ConsecutiveToolCallGuard(2);
    const calls = [make_call("web_search", { q: "test" })];
    guard.observe(calls); // 1회
    guard.observe(calls); // 2회 (repeated_rounds=1)
    const result = guard.observe(calls); // 3회 (repeated_rounds=2 >= max)
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe("repeated_tool_calls");
  });

  it("다른 호출이 중간에 오면 카운터 리셋", () => {
    const guard = new ConsecutiveToolCallGuard(2);
    const callA = [make_call("web_search", { q: "a" })];
    const callB = [make_call("web_search", { q: "b" })];
    guard.observe(callA);
    guard.observe(callA); // repeated_rounds=1
    guard.observe(callB); // 다른 시그니처 → repeated_rounds=0
    const result = guard.observe(callA); // 다시 시작
    expect(result.blocked).toBe(false);
  });

  it("빈 tool_calls → 리셋 + 비차단", () => {
    const guard = new ConsecutiveToolCallGuard(2);
    const calls = [make_call("web_search")];
    guard.observe(calls);
    guard.observe(calls);
    const result = guard.observe([]);
    expect(result.blocked).toBe(false);
    // 리셋 후 다시 시작
    const next = guard.observe(calls);
    expect(next.blocked).toBe(false);
  });

  it("reset() 호출 시 카운터 초기화", () => {
    const guard = new ConsecutiveToolCallGuard(2);
    const calls = [make_call("web_search")];
    guard.observe(calls);
    guard.observe(calls);
    guard.reset();
    guard.observe(calls); // 리셋 후 1회
    const result = guard.observe(calls); // 2회 (repeated_rounds=1)
    expect(result.blocked).toBe(false);
  });

  it("max_repeated_rounds=1 → 한 번 반복만으로 차단", () => {
    const guard = new ConsecutiveToolCallGuard(1);
    const calls = [make_call("tool")];
    guard.observe(calls); // 첫 호출
    const result = guard.observe(calls); // 동일 → repeated_rounds=1 >= 1
    expect(result.blocked).toBe(true);
  });

  it("정렬된 시그니처 비교 (순서 무관)", () => {
    const guard = new ConsecutiveToolCallGuard(2);
    const callsAB = [make_call("b"), make_call("a")];
    const callsBA = [make_call("a"), make_call("b")];
    guard.observe(callsAB);
    guard.observe(callsBA); // 정렬 후 동일
    const result = guard.observe(callsAB);
    expect(result.blocked).toBe(true);
  });

  it("null/undefined tool_calls → 비차단", () => {
    const guard = new ConsecutiveToolCallGuard(2);
    const result = guard.observe(null as unknown as ToolCallRequest[]);
    expect(result.blocked).toBe(false);
  });

  it("constructor max_repeated_rounds=0 → || 2 fallback으로 2 사용", () => {
    const guard = new ConsecutiveToolCallGuard(0);
    const calls = [make_call("tool")];
    guard.observe(calls);
    guard.observe(calls); // repeated_rounds=1
    const result = guard.observe(calls); // repeated_rounds=2 >= 2 → blocked
    expect(result.blocked).toBe(true);
  });

  it("name 없는 tool_call → row.name||'' fallback 경로", () => {
    const guard = new ConsecutiveToolCallGuard(2);
    const calls = [{ id: "c1", name: "" as any, arguments: {} }] as ToolCallRequest[];
    guard.observe(calls);
    const result = guard.observe(calls); // repeated_rounds=1 < 2
    expect(result.blocked).toBe(false);
  });
});
