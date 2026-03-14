/**
 * EV-4: eval-run CLI — 데이터셋 로드 → 실행 → report + baseline diff.
 *
 * Usage:
 *   npx tsx scripts/eval-run.ts <dataset-dir> [options]
 *
 * Options:
 *   --baseline <path>   Baseline JSON 파일 경로 (diff 비교용)
 *   --save-baseline     현재 결과를 baseline으로 저장
 *   --output <path>     Report JSON 출력 경로
 *   --markdown          Markdown summary 출력
 *   --tags <t1,t2>      태그 필터 (쉼표 구분)
 *   --scorer <name>     Scorer 이름 (exact, contains, regex). 기본: contains
 *   -h, --help          도움말
 */

import { resolve } from "node:path";
import { writeFileSync } from "node:fs";
import { load_eval_datasets } from "../src/evals/loader.js";
import { EvalRunner } from "../src/evals/runner.js";
import { EXACT_MATCH_SCORER, CONTAINS_SCORER, REGEX_SCORER } from "../src/evals/scorers.js";
import { create_report, save_baseline, load_baseline, compute_diff, render_markdown_summary } from "../src/evals/report.js";
import type { EvalExecutorLike, EvalScorerLike } from "../src/evals/contracts.js";

interface CliArgs {
  datasetDir: string | null;
  baseline: string | null;
  saveBaseline: boolean;
  output: string | null;
  markdown: boolean;
  tags: string[] | null;
  scorer: string;
  help: boolean;
}

const SCORER_MAP: Record<string, EvalScorerLike> = {
  exact: EXACT_MATCH_SCORER,
  contains: CONTAINS_SCORER,
  regex: REGEX_SCORER,
};

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printUsage();
    return;
  }

  if (!args.datasetDir) {
    console.error("Error: dataset directory is required.");
    printUsage();
    process.exit(1);
  }

  const scorer = SCORER_MAP[args.scorer] ?? CONTAINS_SCORER;

  const datasets = load_eval_datasets(resolve(args.datasetDir));
  if (datasets.length === 0) {
    console.log("No datasets found.");
    return;
  }

  const echo_executor: EvalExecutorLike = {
    async execute(input: string) { return { output: `echo: ${input}` }; },
  };

  const runner = new EvalRunner(echo_executor, scorer, {
    filter_tags: args.tags?.length ? args.tags : undefined,
  });

  for (const dataset of datasets) {
    console.log(`\nRunning: ${dataset.name} (${dataset.cases.length} cases)`);

    const summary = await runner.run_dataset(dataset);
    const scorecards = summary.results.map((r) => ({
      case_id: r.case_id,
      entries: [{ dimension: "content", passed: r.passed, score: r.score, detail: r.error }],
      overall_passed: r.passed,
      overall_score: r.score,
    }));

    const report = create_report(dataset.name, scorecards, summary.duration_ms);
    console.log(`  Total: ${report.total} | Passed: ${report.passed} | Failed: ${report.failed}`);

    if (args.output) {
      const outPath = resolve(args.output);
      writeFileSync(outPath, JSON.stringify(report, null, 2), "utf-8");
      console.log(`  Report saved: ${outPath}`);
    }

    if (args.saveBaseline && args.baseline) {
      save_baseline(resolve(args.baseline), report);
      console.log(`  Baseline saved: ${args.baseline}`);
    }

    if (args.baseline && !args.saveBaseline) {
      const baseline = load_baseline(resolve(args.baseline));
      if (baseline) {
        const diff = compute_diff(baseline, report);
        const regressed = diff.entries.filter((e) => e.status === "regressed").length;
        const improved = diff.entries.filter((e) => e.status === "improved").length;
        console.log(`  Baseline diff: ${improved} improved, ${regressed} regressed, pass_rate_delta=${(diff.pass_rate_delta * 100).toFixed(1)}%`);
      }
    }

    if (args.markdown) {
      const baseline = args.baseline ? load_baseline(resolve(args.baseline)) : null;
      const diff = baseline ? compute_diff(baseline, report) : undefined;
      console.log("\n" + render_markdown_summary(report, diff));
    }
  }
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    datasetDir: null, baseline: null, saveBaseline: false,
    output: null, markdown: false, tags: null, scorer: "contains", help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--baseline") { args.baseline = argv[++i]; continue; }
    if (arg === "--save-baseline") { args.saveBaseline = true; continue; }
    if (arg === "--output") { args.output = argv[++i]; continue; }
    if (arg === "--markdown") { args.markdown = true; continue; }
    if (arg === "--tags") { args.tags = (argv[++i] ?? "").split(",").filter(Boolean); continue; }
    if (arg === "--scorer") { args.scorer = argv[++i]; continue; }
    if (arg === "-h" || arg === "--help") { args.help = true; continue; }
    if (!args.datasetDir) { args.datasetDir = arg; continue; }
  }
  return args;
}

function printUsage() {
  console.log(`Usage: npx tsx scripts/eval-run.ts <dataset-dir> [options]

Options:
  --baseline <path>   Baseline JSON file path for diff comparison
  --save-baseline     Save current result as baseline
  --output <path>     Report JSON output path
  --markdown          Print markdown summary
  --tags <t1,t2>      Tag filter (comma-separated)
  --scorer <name>     Scorer: exact, contains, regex (default: contains)
  -h, --help          Show this help`);
}

main().then(() => process.exit(0)).catch((e: unknown) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
