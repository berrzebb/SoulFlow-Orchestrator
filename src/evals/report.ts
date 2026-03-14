/**
 * EV-4: Run Report / Baseline Diff.
 *
 * EvaluationReport 직렬화 + baseline snapshot 비교 + markdown summary.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import type { Scorecard } from "./judges.js";

/* ── 데이터 모델 ─────────────────────────────── */

export interface EvaluationReport {
  /** 데이터셋 이름. */
  dataset: string;
  /** ISO 타임스탬프. */
  timestamp: string;
  /** 전체 케이스 수. */
  total: number;
  /** 통과 수. */
  passed: number;
  /** 실패 수. */
  failed: number;
  /** 전체 소요 시간 (ms). */
  duration_ms: number;
  /** 개별 scorecard. */
  scorecards: Scorecard[];
}

export interface BaselineDiffEntry {
  case_id: string;
  dimension: string;
  /** 이전 점수. */
  before: number;
  /** 현재 점수. */
  after: number;
  /** 점수 변화 (after - before). */
  delta: number;
  /** 상태 변화. */
  status: "improved" | "regressed" | "unchanged";
}

export interface BaselineDiff {
  dataset: string;
  /** 비교 대상 baseline 타임스탬프. */
  baseline_timestamp: string;
  /** 현재 리포트 타임스탬프. */
  current_timestamp: string;
  entries: BaselineDiffEntry[];
  /** 전체 통과율 변화. */
  pass_rate_delta: number;
  /** 전체 점수 변화. */
  score_delta: number;
}

/* ── Report 생성 ─────────────────────────────── */

export function create_report(dataset: string, scorecards: Scorecard[], duration_ms: number): EvaluationReport {
  const passed = scorecards.filter((sc) => sc.overall_passed).length;
  return {
    dataset,
    timestamp: new Date().toISOString(),
    total: scorecards.length,
    passed,
    failed: scorecards.length - passed,
    duration_ms,
    scorecards,
  };
}

/* ── Baseline 저장/로드 ──────────────────────── */

export function save_baseline(file_path: string, report: EvaluationReport): void {
  writeFileSync(file_path, JSON.stringify(report, null, 2), "utf-8");
}

export function load_baseline(file_path: string): EvaluationReport | null {
  if (!existsSync(file_path)) return null;
  return JSON.parse(readFileSync(file_path, "utf-8")) as EvaluationReport;
}

/* ── Baseline Diff ──────────────────────────── */

export function compute_diff(baseline: EvaluationReport, current: EvaluationReport): BaselineDiff {
  const entries: BaselineDiffEntry[] = [];
  const baseline_map = new Map<string, Scorecard>();
  for (const sc of baseline.scorecards) baseline_map.set(sc.case_id, sc);

  for (const sc of current.scorecards) {
    const base_sc = baseline_map.get(sc.case_id);
    for (const entry of sc.entries) {
      const base_entry = base_sc?.entries.find((e) => e.dimension === entry.dimension);
      const before = base_entry?.score ?? 0;
      const after = entry.score;
      const delta = after - before;
      entries.push({
        case_id: sc.case_id,
        dimension: entry.dimension,
        before,
        after,
        delta,
        status: delta > 0 ? "improved" : delta < 0 ? "regressed" : "unchanged",
      });
    }
  }

  const baseline_pass_rate = baseline.total > 0 ? baseline.passed / baseline.total : 0;
  const current_pass_rate = current.total > 0 ? current.passed / current.total : 0;
  const baseline_avg_score = avg_score(baseline.scorecards);
  const current_avg_score = avg_score(current.scorecards);

  return {
    dataset: current.dataset,
    baseline_timestamp: baseline.timestamp,
    current_timestamp: current.timestamp,
    entries,
    pass_rate_delta: current_pass_rate - baseline_pass_rate,
    score_delta: current_avg_score - baseline_avg_score,
  };
}

/* ── Markdown Summary ────────────────────────── */

export function render_markdown_summary(report: EvaluationReport, diff?: BaselineDiff): string {
  const lines: string[] = [];
  const pass_rate = report.total > 0 ? ((report.passed / report.total) * 100).toFixed(1) : "0.0";

  lines.push(`# Evaluation Report: ${report.dataset}`);
  lines.push("");
  lines.push(`- **Timestamp**: ${report.timestamp}`);
  lines.push(`- **Total**: ${report.total} | **Passed**: ${report.passed} | **Failed**: ${report.failed}`);
  lines.push(`- **Pass Rate**: ${pass_rate}%`);
  lines.push(`- **Duration**: ${report.duration_ms}ms`);

  if (diff) {
    lines.push("");
    lines.push("## Baseline Comparison");
    lines.push("");
    lines.push(`- **Baseline**: ${diff.baseline_timestamp}`);
    lines.push(`- **Pass Rate Delta**: ${format_delta(diff.pass_rate_delta * 100)}%`);
    lines.push(`- **Score Delta**: ${format_delta(diff.score_delta)}`);

    const regressed = diff.entries.filter((e) => e.status === "regressed");
    const improved = diff.entries.filter((e) => e.status === "improved");

    if (regressed.length > 0) {
      lines.push("");
      lines.push("### Regressions");
      lines.push("");
      for (const e of regressed) {
        lines.push(`- \`${e.case_id}\` [${e.dimension}]: ${e.before.toFixed(2)} → ${e.after.toFixed(2)} (${format_delta(e.delta)})`);
      }
    }

    if (improved.length > 0) {
      lines.push("");
      lines.push("### Improvements");
      lines.push("");
      for (const e of improved) {
        lines.push(`- \`${e.case_id}\` [${e.dimension}]: ${e.before.toFixed(2)} → ${e.after.toFixed(2)} (${format_delta(e.delta)})`);
      }
    }
  }

  lines.push("");
  lines.push("## Scorecards");
  lines.push("");
  for (const sc of report.scorecards) {
    const status = sc.overall_passed ? "PASS" : "FAIL";
    lines.push(`### ${sc.case_id} — ${status} (${sc.overall_score.toFixed(2)})`);
    lines.push("");
    for (const e of sc.entries) {
      const icon = e.passed ? "+" : "-";
      lines.push(`- [${icon}] ${e.dimension}: ${e.score.toFixed(2)}${e.detail ? ` — ${e.detail}` : ""}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/* ── helpers ───────────────────────────────── */

function avg_score(scorecards: Scorecard[]): number {
  if (scorecards.length === 0) return 0;
  return scorecards.reduce((sum, sc) => sum + sc.overall_score, 0) / scorecards.length;
}

function format_delta(value: number): string {
  const formatted = value.toFixed(2);
  return value > 0 ? `+${formatted}` : formatted;
}
