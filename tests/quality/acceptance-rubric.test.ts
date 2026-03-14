import { describe, it, expect } from "vitest";
import {
  apply_rubric,
  DEFAULT_RUBRIC,
  type AcceptanceRubric,
  type Scorecard,
} from "@src/quality/acceptance-rubric.ts";
import type { Scorecard as EvalScorecard } from "@src/evals/judges.ts";

function make_scorecard(entries: Array<{ dimension: string; score: number }>): EvalScorecard {
  const mapped = entries.map((e) => ({ ...e, passed: e.score >= 1, detail: undefined }));
  const overall_score = mapped.length > 0
    ? mapped.reduce((s, e) => s + e.score, 0) / mapped.length
    : 1;
  return {
    case_id: "test-case",
    entries: mapped,
    overall_passed: mapped.every((e) => e.passed),
    overall_score,
  };
}

describe("apply_rubric — DEFAULT_RUBRIC (pass_at=0.8, warn_at=0.5)", () => {
  it("모든 dimension score ≥ 0.8 → overall pass", () => {
    const result = apply_rubric(make_scorecard([
      { dimension: "route", score: 1.0 },
      { dimension: "quality", score: 0.9 },
    ]), DEFAULT_RUBRIC);
    expect(result.overall_verdict).toBe("pass");
    expect(result.dimensions.every((d) => d.verdict === "pass")).toBe(true);
  });

  it("하나라도 0.5 ≤ score < 0.8 → overall warn", () => {
    const result = apply_rubric(make_scorecard([
      { dimension: "route", score: 1.0 },
      { dimension: "quality", score: 0.6 },
    ]), DEFAULT_RUBRIC);
    expect(result.overall_verdict).toBe("warn");
  });

  it("하나라도 score < 0.5 → overall fail (fail > warn 우선)", () => {
    const result = apply_rubric(make_scorecard([
      { dimension: "route", score: 1.0 },
      { dimension: "quality", score: 0.6 },  // warn
      { dimension: "latency", score: 0.2 },   // fail
    ]), DEFAULT_RUBRIC);
    expect(result.overall_verdict).toBe("fail");
  });

  it("entries 없음 → overall pass (빈 scorecard 방어)", () => {
    const result = apply_rubric(make_scorecard([]), DEFAULT_RUBRIC);
    expect(result.overall_verdict).toBe("pass");
    expect(result.dimensions).toHaveLength(0);
  });

  it("경계값: score = pass_at(0.8) → pass", () => {
    const result = apply_rubric(make_scorecard([{ dimension: "x", score: 0.8 }]), DEFAULT_RUBRIC);
    expect(result.dimensions[0].verdict).toBe("pass");
  });

  it("경계값: score = warn_at(0.5) → warn", () => {
    const result = apply_rubric(make_scorecard([{ dimension: "x", score: 0.5 }]), DEFAULT_RUBRIC);
    expect(result.dimensions[0].verdict).toBe("warn");
  });

  it("경계값: score < warn_at(0.5) → fail", () => {
    const result = apply_rubric(make_scorecard([{ dimension: "x", score: 0.49 }]), DEFAULT_RUBRIC);
    expect(result.dimensions[0].verdict).toBe("fail");
  });
});

describe("apply_rubric — 차원별 임계값 override", () => {
  const custom_rubric: AcceptanceRubric = {
    dimensions: {
      // latency는 더 관대하게 (0.6 pass, 0.3 warn)
      latency: { pass_at: 0.6, warn_at: 0.3 },
      // cost는 더 엄격하게 (0.95 pass, 0.8 warn)
      cost: { pass_at: 0.95, warn_at: 0.8 },
    },
    default_threshold: { pass_at: 0.8, warn_at: 0.5 },
  };

  it("latency 0.65 → 관대한 임계값으로 pass", () => {
    const result = apply_rubric(make_scorecard([{ dimension: "latency", score: 0.65 }]), custom_rubric);
    expect(result.dimensions[0].verdict).toBe("pass");
  });

  it("cost 0.85 → 엄격한 임계값으로 warn", () => {
    const result = apply_rubric(make_scorecard([{ dimension: "cost", score: 0.85 }]), custom_rubric);
    expect(result.dimensions[0].verdict).toBe("warn");
  });

  it("미지정 차원은 default_threshold 사용", () => {
    const result = apply_rubric(
      make_scorecard([{ dimension: "quality", score: 0.75 }]),
      custom_rubric,
    );
    // default: pass_at=0.8 → 0.75 < 0.8 → warn
    expect(result.dimensions[0].verdict).toBe("warn");
  });
});

describe("apply_rubric — case_id 전달", () => {
  it("scorecard case_id가 결과에 보존됨", () => {
    const sc = make_scorecard([{ dimension: "x", score: 1 }]);
    sc.case_id = "my-case-123";
    const result = apply_rubric(sc as Scorecard, DEFAULT_RUBRIC);
    expect(result.case_id).toBe("my-case-123");
  });
});
