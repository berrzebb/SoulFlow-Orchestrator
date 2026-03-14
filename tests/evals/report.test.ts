import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  create_report, save_baseline, load_baseline,
  compute_diff, render_markdown_summary,
} from "../../src/evals/report.js";
import type { Scorecard } from "../../src/evals/judges.js";

function make_scorecard(case_id: string, passed: boolean, score: number, dimension = "content"): Scorecard {
  return {
    case_id,
    entries: [{ dimension, passed, score }],
    overall_passed: passed,
    overall_score: score,
  };
}

describe("create_report", () => {
  it("scorecard → EvaluationReport 생성", () => {
    const scorecards = [
      make_scorecard("c1", true, 1),
      make_scorecard("c2", false, 0.3),
      make_scorecard("c3", true, 0.8),
    ];
    const report = create_report("test-ds", scorecards, 150);
    expect(report.dataset).toBe("test-ds");
    expect(report.total).toBe(3);
    expect(report.passed).toBe(2);
    expect(report.failed).toBe(1);
    expect(report.duration_ms).toBe(150);
    expect(report.timestamp).toBeTruthy();
  });

  it("빈 scorecard → total 0", () => {
    const report = create_report("empty", [], 0);
    expect(report.total).toBe(0);
    expect(report.passed).toBe(0);
  });
});

describe("save_baseline / load_baseline", () => {
  let tmp: string;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "eval-report-")); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it("저장 후 로드 → 동일 데이터", () => {
    const report = create_report("ds", [make_scorecard("c1", true, 1)], 50);
    const path = join(tmp, "baseline.json");
    save_baseline(path, report);
    const loaded = load_baseline(path);
    expect(loaded).toBeTruthy();
    expect(loaded!.dataset).toBe("ds");
    expect(loaded!.scorecards).toHaveLength(1);
  });

  it("파일 미존재 시 null 반환", () => {
    expect(load_baseline(join(tmp, "missing.json"))).toBeNull();
  });
});

describe("compute_diff", () => {
  it("개선/회귀/유지 감지", () => {
    const baseline = create_report("ds", [
      make_scorecard("c1", true, 1.0),
      make_scorecard("c2", false, 0.3),
      make_scorecard("c3", true, 0.5),
    ], 100);

    const current = create_report("ds", [
      make_scorecard("c1", true, 1.0),  // unchanged
      make_scorecard("c2", true, 0.8),  // improved
      make_scorecard("c3", false, 0.2), // regressed
    ], 80);

    const diff = compute_diff(baseline, current);
    expect(diff.dataset).toBe("ds");

    const c1 = diff.entries.find((e) => e.case_id === "c1")!;
    expect(c1.status).toBe("unchanged");
    expect(c1.delta).toBe(0);

    const c2 = diff.entries.find((e) => e.case_id === "c2")!;
    expect(c2.status).toBe("improved");
    expect(c2.delta).toBeCloseTo(0.5);

    const c3 = diff.entries.find((e) => e.case_id === "c3")!;
    expect(c3.status).toBe("regressed");
    expect(c3.delta).toBeCloseTo(-0.3);
  });

  it("pass_rate_delta 계산", () => {
    const baseline = create_report("ds", [
      make_scorecard("c1", false, 0),
      make_scorecard("c2", false, 0),
    ], 0);
    const current = create_report("ds", [
      make_scorecard("c1", true, 1),
      make_scorecard("c2", false, 0),
    ], 0);
    const diff = compute_diff(baseline, current);
    expect(diff.pass_rate_delta).toBeCloseTo(0.5);
  });

  it("새 케이스 (baseline에 없는 case_id) → before=0", () => {
    const baseline = create_report("ds", [], 0);
    const current = create_report("ds", [make_scorecard("new", true, 0.7)], 0);
    const diff = compute_diff(baseline, current);
    expect(diff.entries[0].before).toBe(0);
    expect(diff.entries[0].after).toBeCloseTo(0.7);
    expect(diff.entries[0].status).toBe("improved");
  });
});

describe("render_markdown_summary", () => {
  it("기본 리포트 markdown 생성", () => {
    const report = create_report("test", [
      make_scorecard("c1", true, 1),
      make_scorecard("c2", false, 0),
    ], 100);
    const md = render_markdown_summary(report);
    expect(md).toContain("# Evaluation Report: test");
    expect(md).toContain("**Total**: 2");
    expect(md).toContain("**Passed**: 1");
    expect(md).toContain("**Failed**: 1");
    expect(md).toContain("50.0%");
    expect(md).toContain("c1 — PASS");
    expect(md).toContain("c2 — FAIL");
  });

  it("baseline diff 포함 markdown 생성", () => {
    const baseline = create_report("ds", [make_scorecard("c1", false, 0.2)], 0);
    const current = create_report("ds", [make_scorecard("c1", true, 0.9)], 0);
    const diff = compute_diff(baseline, current);
    const md = render_markdown_summary(current, diff);
    expect(md).toContain("## Baseline Comparison");
    expect(md).toContain("### Improvements");
    expect(md).toContain("c1");
  });

  it("regression 표시", () => {
    const baseline = create_report("ds", [make_scorecard("c1", true, 1)], 0);
    const current = create_report("ds", [make_scorecard("c1", false, 0)], 0);
    const diff = compute_diff(baseline, current);
    const md = render_markdown_summary(current, diff);
    expect(md).toContain("### Regressions");
  });

  it("빈 리포트 markdown", () => {
    const report = create_report("empty", [], 0);
    const md = render_markdown_summary(report);
    expect(md).toContain("# Evaluation Report: empty");
    expect(md).toContain("**Total**: 0");
  });
});
