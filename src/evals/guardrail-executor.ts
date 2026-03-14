/**
 * EG-5: Guardrail Eval Executor.
 *
 * guardrail 결정 함수(session reuse, budget)를 EvalExecutorLike로 감싸
 * eval pipeline에서 deterministic 회귀 테스트를 실행할 수 있게 한다.
 *
 * input JSON schema:
 *   session_reuse → { type, query, session_history[], freshness_window_ms?, similarity_threshold? }
 *   budget       → { type, max_tool_calls, used_tool_calls }
 */

import type { EvalExecutorLike } from "./contracts.js";
import { evaluate_reuse, build_session_evidence } from "../orchestration/guardrails/index.js";
import { create_budget_tracker, is_over_budget } from "../orchestration/guardrails/index.js";

/** executor가 파싱하는 입력 구조. */
export type GuardrailEvalInput =
  | {
      type: "session_reuse";
      query: string;
      session_history: Array<{ role: string; content: string }>;
      freshness_window_ms?: number;
      similarity_threshold?: number;
    }
  | {
      type: "budget";
      max_tool_calls: number;
      used_tool_calls: number;
    };

/** guardrail 함수를 eval pipeline에 연결하는 executor 생성. */
export function create_guardrail_executor(): EvalExecutorLike {
  return {
    async execute(raw_input: string) {
      try {
        const input: GuardrailEvalInput = JSON.parse(raw_input);

        if (input.type === "session_reuse") {
          const fw = input.freshness_window_ms ?? 300_000;
          const now = Date.now();
          const evidence = build_session_evidence(input.session_history, now, fw);
          const decision = evaluate_reuse(input.query, evidence, now, {
            freshness_window_ms: fw,
            similarity_threshold: input.similarity_threshold ?? 0.85,
          });
          return { output: decision.kind };
        }

        if (input.type === "budget") {
          const tracker = create_budget_tracker(input.max_tool_calls);
          tracker.used = input.used_tool_calls;
          return { output: is_over_budget(tracker) ? "budget_exceeded" : "within_budget" };
        }

        return { output: "", error: `unknown guardrail type: ${(input as Record<string, unknown>).type}` };
      } catch (e) {
        return { output: "", error: e instanceof Error ? e.message : String(e) };
      }
    },
  };
}
