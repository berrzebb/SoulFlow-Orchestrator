/**
 * E5: OutputReductionExecutor — output reduction 회귀 평가 executor.
 *
 * input:    JSON { text, hint?, max_chars?, mode? }
 * output:   JSON { kind?, prompt_chars?, storage_chars?, raw_chars, truncated, preview }
 * expected: JSON { kind?, max_prompt_chars?, contains?, truncated? }
 *
 * mode "memory": MemoryIngestionReducer 경로 평가.
 * mode "tool"  : ToolOutputReducer 경로 평가 (기본값).
 */

import { create_tool_output_reducer } from "../orchestration/tool-output-reducer.js";
import { create_memory_ingestion_reducer } from "../orchestration/memory-ingestion-reducer.js";
import type { EvalExecutorLike, EvalScorerLike } from "./contracts.js";

interface ReduceInput {
  text: string;
  hint?: string;
  max_chars?: number;
  mode?: "tool" | "memory";
}

interface ReduceExpected {
  kind?: string;
  max_prompt_chars?: number;
  contains?: string;
  truncated?: boolean;
}

export function create_output_reduction_executor(): EvalExecutorLike {
  return {
    async execute(raw_input: string): Promise<{ output: string }> {
      const input: ReduceInput = JSON.parse(raw_input);
      const max = input.max_chars ?? 500;

      if ((input.mode ?? "tool") === "memory") {
        const reducer = create_memory_ingestion_reducer(max);
        const reduced = reducer.reduce(input.text, input.hint ?? "");
        return {
          output: JSON.stringify({
            raw_chars: input.text.length,
            reduced_chars: reduced.length,
            truncated: reduced.length < input.text.length,
            preview: reduced.slice(0, 120),
          }),
        };
      }

      const reducer = create_tool_output_reducer(max);
      const result = reducer.reduce({
        tool_name: input.hint ?? "",
        params: {},
        result_text: input.text,
        is_error: false,
      });
      return {
        output: JSON.stringify({
          kind: result.kind,
          prompt_chars: result.prompt_text.length,
          storage_chars: result.storage_text.length,
          raw_chars: result.meta.raw_chars,
          truncated: result.meta.truncated,
          preview: result.prompt_text.slice(0, 120),
        }),
      };
    },
  };
}

export function create_output_reduction_scorer(): EvalScorerLike {
  return {
    score(
      _input: string,
      expected_raw: string | undefined,
      actual: string,
    ): { passed: boolean; score: number } {
      if (!expected_raw) return { passed: true, score: 1 };

      const expected: ReduceExpected = JSON.parse(expected_raw);
      const actual_obj = JSON.parse(actual) as Record<string, unknown>;

      const checks: boolean[] = [];

      if (expected.kind !== undefined) {
        checks.push(actual_obj["kind"] === expected.kind);
      }
      if (expected.max_prompt_chars !== undefined) {
        const chars = Number(actual_obj["prompt_chars"] ?? actual_obj["reduced_chars"] ?? Infinity);
        checks.push(chars <= expected.max_prompt_chars);
      }
      if (expected.contains !== undefined) {
        const preview = String(actual_obj["preview"] ?? "");
        checks.push(preview.includes(expected.contains));
      }
      if (expected.truncated !== undefined) {
        checks.push(Boolean(actual_obj["truncated"]) === expected.truncated);
      }

      if (checks.length === 0) return { passed: true, score: 1 };
      const passed_count = checks.filter(Boolean).length;
      return { passed: passed_count === checks.length, score: passed_count / checks.length };
    },
  };
}
