import { describe, it, expect } from "vitest";
import { adapt_bundle_to_summary, validator_badge_variant, next_task_hint } from "@src/repo-profile/validator-summary-adapter.ts";
import { create_artifact_bundle } from "@src/repo-profile/artifact-bundle.ts";

// ── adapt_bundle_to_summary ───────────────────────────────────────────────────

describe("adapt_bundle_to_summary", () => {
  it("빈 bundle → 카운트 0, failed_validators 빈 배열", () => {
    const bundle = create_artifact_bundle({ repo_id: "r" });
    const summary = adapt_bundle_to_summary(bundle);
    expect(summary.repo_id).toBe("r");
    expect(summary.total_validators).toBe(0);
    expect(summary.passed_validators).toBe(0);
    expect(summary.failed_validators).toHaveLength(0);
  });

  it("모두 passed → failed_validators 빈 배열, passed_validators = total", () => {
    const bundle = create_artifact_bundle({
      repo_id: "r",
      validator_results: [
        { kind: "lint", command: "eslint src/", passed: true },
        { kind: "test", command: "vitest run", passed: true },
      ],
    });
    const summary = adapt_bundle_to_summary(bundle);
    expect(summary.total_validators).toBe(2);
    expect(summary.passed_validators).toBe(2);
    expect(summary.failed_validators).toHaveLength(0);
  });

  it("일부 실패 → failed_validators에 실패 항목만 포함", () => {
    const bundle = create_artifact_bundle({
      repo_id: "r",
      validator_results: [
        { kind: "lint", command: "eslint src/", passed: true },
        { kind: "test", command: "vitest run", passed: false, output: "2 failed" },
      ],
    });
    const summary = adapt_bundle_to_summary(bundle);
    expect(summary.total_validators).toBe(2);
    expect(summary.passed_validators).toBe(1);
    expect(summary.failed_validators).toHaveLength(1);
    expect(summary.failed_validators[0].kind).toBe("test");
    expect(summary.failed_validators[0].command).toBe("vitest run");
    expect(summary.failed_validators[0].output).toBe("2 failed");
  });

  it("전부 실패 → failed_validators에 모두 포함", () => {
    const bundle = create_artifact_bundle({
      repo_id: "r",
      validator_results: [
        { kind: "lint", command: "eslint src/", passed: false },
        { kind: "typecheck", command: "tsc --noEmit", passed: false },
      ],
    });
    const summary = adapt_bundle_to_summary(bundle);
    expect(summary.failed_validators).toHaveLength(2);
    expect(summary.passed_validators).toBe(0);
  });

  it("output 없는 실패 → output은 undefined", () => {
    const bundle = create_artifact_bundle({
      repo_id: "r",
      validator_results: [{ kind: "lint", command: "eslint src/", passed: false }],
    });
    const summary = adapt_bundle_to_summary(bundle);
    expect(summary.failed_validators[0].output).toBeUndefined();
  });

  it("eval_summary.bundle_id → artifact_bundle_id에 전달", () => {
    const bundle = create_artifact_bundle({
      repo_id: "r",
      eval_summary: { bundle_id: "bundle-abc", total_cases: 5, passed_cases: 5, score: 1 },
    });
    const summary = adapt_bundle_to_summary(bundle);
    expect(summary.artifact_bundle_id).toBe("bundle-abc");
  });

  it("eval_summary 없으면 artifact_bundle_id는 undefined", () => {
    const bundle = create_artifact_bundle({ repo_id: "r" });
    const summary = adapt_bundle_to_summary(bundle);
    expect(summary.artifact_bundle_id).toBeUndefined();
  });

  it("created_at이 bundle에서 그대로 전달된다", () => {
    const fixed = "2026-01-01T00:00:00.000Z";
    const bundle = create_artifact_bundle({ repo_id: "r", created_at: fixed });
    const summary = adapt_bundle_to_summary(bundle);
    expect(summary.created_at).toBe(fixed);
  });
});

// ── validator_badge_variant ───────────────────────────────────────────────────

describe("validator_badge_variant", () => {
  it("validators 없으면 off", () => {
    const bundle = create_artifact_bundle({ repo_id: "r" });
    expect(validator_badge_variant(adapt_bundle_to_summary(bundle))).toBe("off");
  });

  it("모두 통과 → ok", () => {
    const bundle = create_artifact_bundle({
      repo_id: "r",
      validator_results: [{ kind: "lint", command: "eslint", passed: true }],
    });
    expect(validator_badge_variant(adapt_bundle_to_summary(bundle))).toBe("ok");
  });

  it("일부 실패 → warn", () => {
    const bundle = create_artifact_bundle({
      repo_id: "r",
      validator_results: [
        { kind: "lint", command: "eslint", passed: true },
        { kind: "test", command: "vitest", passed: false },
      ],
    });
    expect(validator_badge_variant(adapt_bundle_to_summary(bundle))).toBe("warn");
  });

  it("전부 실패 → err", () => {
    const bundle = create_artifact_bundle({
      repo_id: "r",
      validator_results: [
        { kind: "lint", command: "eslint", passed: false },
        { kind: "test", command: "vitest", passed: false },
      ],
    });
    expect(validator_badge_variant(adapt_bundle_to_summary(bundle))).toBe("err");
  });
});

// ── RPF-6: risk_tier + eval_score passthrough ─────────────────────────────────

describe("adapt_bundle_to_summary — RPF-6 fields", () => {
  it("risk_tier가 bundle에서 summary로 전달됨", () => {
    const bundle = create_artifact_bundle({ repo_id: "r", risk_tier: "high" });
    const summary = adapt_bundle_to_summary(bundle);
    expect(summary.risk_tier).toBe("high");
  });

  it("risk_tier 없으면 summary.risk_tier는 undefined", () => {
    const bundle = create_artifact_bundle({ repo_id: "r" });
    const summary = adapt_bundle_to_summary(bundle);
    expect(summary.risk_tier).toBeUndefined();
  });

  it("eval_summary.score가 eval_score로 전달됨", () => {
    const bundle = create_artifact_bundle({
      repo_id: "r",
      eval_summary: { total_cases: 10, passed_cases: 8, score: 0.8 },
    });
    const summary = adapt_bundle_to_summary(bundle);
    expect(summary.eval_score).toBe(0.8);
  });

  it("eval_summary 없으면 eval_score는 undefined", () => {
    const bundle = create_artifact_bundle({ repo_id: "r" });
    const summary = adapt_bundle_to_summary(bundle);
    expect(summary.eval_score).toBeUndefined();
  });
});

// ── RPF-6: next_task_hint ─────────────────────────────────────────────────────

describe("next_task_hint", () => {
  it("실패 validator 있으면 Fix 힌트 반환", () => {
    const bundle = create_artifact_bundle({
      repo_id: "r",
      validator_results: [
        { kind: "lint", command: "eslint src/", passed: false },
        { kind: "test", command: "vitest run", passed: false },
      ],
    });
    const hint = next_task_hint(adapt_bundle_to_summary(bundle));
    expect(hint).toContain("Fix 2");
    expect(hint).toContain("lint");
  });

  it("critical risk → 리뷰 힌트", () => {
    const bundle = create_artifact_bundle({ repo_id: "r", risk_tier: "critical" });
    const hint = next_task_hint(adapt_bundle_to_summary(bundle));
    expect(hint).toContain("critical");
  });

  it("eval_score 낮으면 개선 힌트", () => {
    const bundle = create_artifact_bundle({
      repo_id: "r",
      eval_summary: { total_cases: 10, passed_cases: 6, score: 0.6 },
    });
    const hint = next_task_hint(adapt_bundle_to_summary(bundle));
    expect(hint).toContain("eval score");
    expect(hint).toContain("60%");
  });

  it("모든 조건 통과 → ready to proceed", () => {
    const bundle = create_artifact_bundle({
      repo_id: "r",
      risk_tier: "low",
      validator_results: [{ kind: "lint", command: "eslint", passed: true }],
      eval_summary: { total_cases: 10, passed_cases: 9, score: 0.9 },
    });
    const hint = next_task_hint(adapt_bundle_to_summary(bundle));
    expect(hint).toContain("ready to proceed");
  });

  // RPF-6: 우선순위 중첩 케이스 — 실패 > 위험 > eval 순서 검증

  it("실패 + critical risk + 낮은 eval → 실패 힌트 우선", () => {
    const bundle = create_artifact_bundle({
      repo_id: "r",
      risk_tier: "critical",
      validator_results: [{ kind: "lint", command: "eslint", passed: false }],
      eval_summary: { total_cases: 10, passed_cases: 5, score: 0.5 },
    });
    const hint = next_task_hint(adapt_bundle_to_summary(bundle));
    expect(hint).toContain("Fix 1");
    expect(hint).not.toContain("critical");
    expect(hint).not.toContain("eval score");
  });

  it("critical risk + 낮은 eval (실패 없음) → 위험 힌트 우선", () => {
    const bundle = create_artifact_bundle({
      repo_id: "r",
      risk_tier: "critical",
      validator_results: [{ kind: "lint", command: "eslint", passed: true }],
      eval_summary: { total_cases: 10, passed_cases: 5, score: 0.5 },
    });
    const hint = next_task_hint(adapt_bundle_to_summary(bundle));
    expect(hint).toContain("critical");
    expect(hint).not.toContain("eval score");
  });
});
