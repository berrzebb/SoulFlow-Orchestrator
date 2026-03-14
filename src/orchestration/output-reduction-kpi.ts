/**
 * E5: OutputReductionKpi — output reduction 효과 측정 accumulator.
 *
 * ToolOutputReducer.reduce() 결과를 누적하여 chars 절감률,
 * overflow(truncated) 카운터, kind 분포를 집계한다.
 */

import type { ReducedOutput, ToolOutputKind } from "./tool-output-reducer.js";

export interface ReductionStat {
  raw_chars: number;
  /** prompt_text 기준 압축 후 길이. */
  reduced_chars: number;
  kind: ToolOutputKind;
  truncated: boolean;
}

export interface ReductionKpiSummary {
  count: number;
  total_raw_chars: number;
  total_reduced_chars: number;
  /** reduced / raw 비율 (1.0 = 절감 없음, count=0 이면 1.0). */
  overall_ratio: number;
  /** truncated=true인 케이스 수. */
  overflow_count: number;
  kind_counts: Record<ToolOutputKind, number>;
}

export interface OutputReductionKpi {
  record(stat: ReductionStat): void;
  summary(): ReductionKpiSummary;
  reset(): void;
}

function empty_kind_counts(): Record<ToolOutputKind, number> {
  return { plain: 0, shell: 0, test: 0, json: 0, diff: 0, log: 0, table: 0 };
}

export function create_output_reduction_kpi(): OutputReductionKpi {
  let count = 0;
  let total_raw = 0;
  let total_reduced = 0;
  let overflow = 0;
  const kind_counts = empty_kind_counts();

  return {
    record({ raw_chars, reduced_chars, kind, truncated }: ReductionStat): void {
      count++;
      total_raw += raw_chars;
      total_reduced += reduced_chars;
      if (truncated) overflow++;
      kind_counts[kind] = (kind_counts[kind] ?? 0) + 1;
    },

    summary(): ReductionKpiSummary {
      return {
        count,
        total_raw_chars: total_raw,
        total_reduced_chars: total_reduced,
        overall_ratio: total_raw === 0 ? 1.0 : total_reduced / total_raw,
        overflow_count: overflow,
        kind_counts: { ...kind_counts },
      };
    },

    reset(): void {
      count = 0;
      total_raw = 0;
      total_reduced = 0;
      overflow = 0;
      Object.assign(kind_counts, empty_kind_counts());
    },
  };
}

/** ReducedOutput → ReductionStat 변환 (prompt_text 길이를 reduced_chars로 사용). */
export function stat_from_reduced(reduced: ReducedOutput): ReductionStat {
  return {
    raw_chars: reduced.meta.raw_chars,
    reduced_chars: reduced.prompt_text.length,
    kind: reduced.kind,
    truncated: reduced.meta.truncated,
  };
}
