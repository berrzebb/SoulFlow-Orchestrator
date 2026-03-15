/**
 * FE-3: RunResult — eval_score 배지 조건부 렌더 테스트.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RunResult, type RunResultValue } from "@/pages/prompting/run-result";

function make_value(overrides: Partial<RunResultValue> = {}): RunResultValue {
  return {
    content: "hello",
    finish_reason: "stop",
    latency_ms: 500,
    usage: { total_tokens: 100 },
    model: "claude-3",
    provider_id: "anthropic",
    ...overrides,
  };
}

describe("RunResult — eval_score 배지", () => {
  it("eval_score 없으면 점수 배지 미렌더", () => {
    render(<RunResult value={make_value()} />);
    expect(screen.queryByText(/%$/)).toBeNull();
  });

  it("eval_score=0.95 → '95%' 배지 렌더", () => {
    render(<RunResult value={make_value({ eval_score: 0.95 })} />);
    expect(screen.getByText("95%")).toBeInTheDocument();
  });

  it("eval_score=0.6 → '60%' 배지 렌더", () => {
    render(<RunResult value={make_value({ eval_score: 0.6 })} />);
    expect(screen.getByText("60%")).toBeInTheDocument();
  });

  it("eval_score=0.2 → '20%' 배지 렌더", () => {
    render(<RunResult value={make_value({ eval_score: 0.2 })} />);
    expect(screen.getByText("20%")).toBeInTheDocument();
  });

  it("에러 상태에서 eval_score 있어도 에러 뷰 렌더", () => {
    render(<RunResult value={make_value({ error: "API failed", eval_score: 0.9 })} />);
    expect(screen.getByText("API failed")).toBeInTheDocument();
    // 에러 뷰에서는 eval_score 배지 렌더 안 함
    expect(screen.queryByText("90%")).toBeNull();
  });

  it("null value → 빈 뷰 렌더 (eval_score 배지 없음)", () => {
    render(<RunResult value={null} />);
    expect(screen.queryByText(/%$/)).toBeNull();
  });
});
