/**
 * EV-4/6: eval-run CLI — 데이터셋/번들 로드 → 실행 → report + baseline diff.
 *
 * Usage:
 *   npx tsx scripts/eval-run.ts <dataset-dir> [options]
 *   npx tsx scripts/eval-run.ts --bundle <name> [options]
 *   npx tsx scripts/eval-run.ts --smoke [options]
 *   npx tsx scripts/eval-run.ts --full [options]
 *
 * Options:
 *   --bundle <name>     번들 이름으로 실행
 *   --smoke             smoke 번들만 실행
 *   --full              모든 번들 실행
 *   --threshold <n>     최소 통과율 (0-100). 미달 시 exit 1
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
import { get_bundle, get_smoke_bundles, list_bundles, load_bundle_datasets } from "../src/evals/bundles.js";
import { create_guardrail_executor } from "../src/evals/guardrail-executor.js";
import { create_tokenizer_executor } from "../src/evals/tokenizer-executor.js";
import type { EvalExecutorLike, EvalScorerLike, EvalDataset } from "../src/evals/contracts.js";

interface CliArgs {
  datasetDir: string | null;
  bundle: string | null;
  smoke: boolean;
  full: boolean;
  threshold: number | null;
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

  const datasets = resolve_datasets(args);
  if (datasets.length === 0) {
    console.log("No datasets found.");
    return;
  }

  const scorer = SCORER_MAP[args.scorer] ?? CONTAINS_SCORER;
  const tags = merge_tags(args);

  let total_passed = 0;
  let total_cases = 0;

  for (const dataset of datasets) {
    console.log(`\nRunning: ${dataset.name} (${dataset.cases.length} cases)`);

    const executor = resolve_executor(dataset.name);
    const runner = new EvalRunner(executor, scorer, {
      filter_tags: tags?.length ? tags : undefined,
    });
    const summary = await runner.run_dataset(dataset);
    const scorecards = summary.results.map((r) => ({
      case_id: r.case_id,
      entries: [{ dimension: "content", passed: r.passed, score: r.score, detail: r.error }],
      overall_passed: r.passed,
      overall_score: r.score,
    }));

    const report = create_report(dataset.name, scorecards, summary.duration_ms);
    console.log(`  Total: ${report.total} | Passed: ${report.passed} | Failed: ${report.failed}`);

    total_passed += report.passed;
    total_cases += report.total;

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

  if (args.threshold !== null && total_cases > 0) {
    const pass_rate = (total_passed / total_cases) * 100;
    console.log(`\nOverall: ${total_passed}/${total_cases} (${pass_rate.toFixed(1)}%) — threshold: ${args.threshold}%`);
    if (pass_rate < args.threshold) {
      console.error(`FAIL: pass rate ${pass_rate.toFixed(1)}% below threshold ${args.threshold}%`);
      process.exit(1);
    }
  }
}

function resolve_datasets(args: CliArgs): EvalDataset[] {
  if (args.bundle) {
    const bundle = get_bundle(args.bundle);
    if (!bundle) {
      console.error(`Error: unknown bundle "${args.bundle}". Available: ${list_bundles().map((b) => b.name).join(", ")}`);
      process.exit(1);
    }
    return load_bundle_datasets(bundle);
  }

  if (args.smoke) {
    const bundles = get_smoke_bundles();
    if (bundles.length === 0) {
      console.log("No smoke bundles registered.");
      return [];
    }
    console.log(`Smoke bundles: ${bundles.map((b) => b.name).join(", ")}`);
    return bundles.flatMap((b) => load_bundle_datasets(b));
  }

  if (args.full) {
    const bundles = list_bundles();
    if (bundles.length === 0) {
      console.log("No bundles registered.");
      return [];
    }
    console.log(`Full run: ${bundles.map((b) => b.name).join(", ")}`);
    return bundles.flatMap((b) => load_bundle_datasets(b));
  }

  if (args.datasetDir) {
    return load_eval_datasets(resolve(args.datasetDir));
  }

  console.error("Error: specify <dataset-dir>, --bundle <name>, --smoke, or --full.");
  printUsage();
  process.exit(1);
}

function merge_tags(args: CliArgs): string[] | undefined {
  if (args.tags?.length) return args.tags;
  if (args.bundle) {
    const bundle = get_bundle(args.bundle);
    return bundle?.tags;
  }
  if (args.smoke) return ["smoke"];
  return undefined;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    datasetDir: null, bundle: null, smoke: false, full: false,
    threshold: null, baseline: null, saveBaseline: false,
    output: null, markdown: false, tags: null, scorer: "contains", help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--bundle") { args.bundle = argv[++i]; continue; }
    if (arg === "--smoke") { args.smoke = true; continue; }
    if (arg === "--full") { args.full = true; continue; }
    if (arg === "--threshold") { args.threshold = Number(argv[++i]); continue; }
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

const ECHO_EXECUTOR: EvalExecutorLike = {
  async execute(input: string) { return { output: `echo: ${input}` }; },
};

const EXECUTOR_MAP: Record<string, () => EvalExecutorLike> = {
  guardrails: create_guardrail_executor,
  tokenizer: create_tokenizer_executor,
};

function resolve_executor(dataset_name: string): EvalExecutorLike {
  return EXECUTOR_MAP[dataset_name]?.() ?? ECHO_EXECUTOR;
}

function printUsage() {
  console.log(`Usage: npx tsx scripts/eval-run.ts [<dataset-dir>] [options]

Modes:
  <dataset-dir>         Run all datasets in directory
  --bundle <name>       Run a specific eval bundle
  --smoke               Run smoke bundles only
  --full                Run all registered bundles

Options:
  --threshold <n>       Minimum pass rate (0-100). Exit 1 if below
  --baseline <path>     Baseline JSON file path for diff comparison
  --save-baseline       Save current result as baseline
  --output <path>       Report JSON output path
  --markdown            Print markdown summary
  --tags <t1,t2>        Tag filter (comma-separated)
  --scorer <name>       Scorer: exact, contains, regex (default: contains)
  -h, --help            Show this help`);
}

main().then(() => process.exit(0)).catch((e: unknown) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
