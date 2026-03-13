/** EV-2: 로컬 EvalRunner — 데이터셋 케이스를 순차 실행 + 채점. */

import type { EvalCase, EvalDataset, EvalResult, EvalRunSummary, EvalExecutorLike, EvalScorerLike } from "./contracts.js";
import { CONTAINS_SCORER } from "./scorers.js";

export interface EvalRunnerOptions {
  /** 케이스당 타임아웃 (ms). 기본 30초. */
  timeout_ms?: number;
  /** 태그 필터 — 지정 시 해당 태그를 가진 케이스만 실행. */
  filter_tags?: string[];
}

export class EvalRunner {
  private readonly executor: EvalExecutorLike;
  private readonly scorer: EvalScorerLike;
  private readonly timeout_ms: number;
  private readonly filter_tags: string[] | undefined;

  constructor(executor: EvalExecutorLike, scorer?: EvalScorerLike, options?: EvalRunnerOptions) {
    this.executor = executor;
    this.scorer = scorer ?? CONTAINS_SCORER;
    this.timeout_ms = options?.timeout_ms ?? 30_000;
    this.filter_tags = options?.filter_tags;
  }

  /** 데이터셋 전체 실행 → EvalRunSummary 반환. */
  async run_dataset(dataset: EvalDataset): Promise<EvalRunSummary> {
    const start = Date.now();
    const cases = this.apply_filter(dataset.cases);
    const results: EvalResult[] = [];

    for (const c of cases) {
      results.push(await this.run_case(c, dataset.name));
    }

    const passed = results.filter((r) => r.passed).length;
    const error_count = results.filter((r) => r.error).length;
    return {
      dataset: dataset.name,
      total: results.length,
      passed,
      failed: results.length - passed,
      error_count,
      duration_ms: Date.now() - start,
      results,
    };
  }

  /** 단일 케이스 실행 → EvalResult. */
  async run_case(eval_case: EvalCase, dataset_name: string): Promise<EvalResult> {
    const start = Date.now();
    try {
      const { output, error } = await this.execute_with_timeout(eval_case.input);
      if (error) {
        return {
          case_id: eval_case.id, dataset: dataset_name,
          passed: false, actual: output, score: 0,
          duration_ms: Date.now() - start, error,
        };
      }
      const { passed, score } = this.scorer.score(eval_case.input, eval_case.expected, output);
      return {
        case_id: eval_case.id, dataset: dataset_name,
        passed, actual: output, score,
        duration_ms: Date.now() - start,
      };
    } catch (e) {
      return {
        case_id: eval_case.id, dataset: dataset_name,
        passed: false, score: 0,
        duration_ms: Date.now() - start,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  private apply_filter(cases: EvalCase[]): EvalCase[] {
    if (!this.filter_tags?.length) return cases;
    return cases.filter((c) => c.tags?.some((t) => this.filter_tags!.includes(t)));
  }

  private async execute_with_timeout(input: string): Promise<{ output: string; error?: string }> {
    return Promise.race([
      this.executor.execute(input),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`eval timeout: ${this.timeout_ms}ms`)), this.timeout_ms),
      ),
    ]);
  }
}
