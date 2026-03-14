/**
 * PAR-5 + PAR-6: Parallel Conflict Eval Executor.
 *
 * reconcile 파이프라인(PAR-1~PAR-6) 함수를 EvalExecutorLike로 감싸
 * eval pipeline에서 결정론적 회귀 테스트를 실행한다.
 *
 * input JSON schema:
 *   reconcile  → { type, agent_results[], policy, use_parsed? }
 *   critic     → { type, value, condition }
 *   read_model → { type, memory, field }
 */

import type { EvalExecutorLike } from "./contracts.js";
import {
  build_parallel_envelope,
  detect_conflicts,
} from "../orchestration/parallel-contracts.js";
import { apply_reconcile_policy } from "../orchestration/reconcile-policy.js";
import { evaluate_critic_condition } from "../orchestration/critic-gate.js";
import { extract_reconcile_read_model } from "../orchestration/reconcile-read-model.js";
import type { DeterministicReconcilePolicy } from "../orchestration/reconcile-policy.js";
import type { ParallelAgentResult } from "../orchestration/parallel-contracts.js";

// ── 입력 타입 ─────────────────────────────────────────────────────

export type ParallelConflictEvalInput =
  | {
      type: "reconcile";
      agent_results: Array<{
        agent_id: string;
        content: string | null;
        parsed?: unknown;
        error?: string;
      }>;
      policy: DeterministicReconcilePolicy;
      use_parsed?: boolean;
    }
  | {
      type: "critic";
      value: unknown;
      condition: string;
    }
  | {
      type: "read_model";
      memory: Record<string, unknown>;
      field: "has_failures" | "total_conflicts" | "unresolved_count" | "reconcile_count" | "critic_count";
    };

// ── 직렬화 ────────────────────────────────────────────────────────

function serialize_result(result: unknown): string {
  if (result === null || result === undefined) return "null";
  if (typeof result === "string") return result;
  return JSON.stringify(result);
}

// ── executor 생성 ─────────────────────────────────────────────────

/** parallel conflict 파이프라인을 eval pipeline에 연결하는 executor. */
export function create_parallel_conflict_executor(): EvalExecutorLike {
  return {
    async execute(raw_input: string) {
      try {
        const input = JSON.parse(raw_input) as ParallelConflictEvalInput;

        if (input.type === "reconcile") {
          const results = input.agent_results as ParallelAgentResult[];
          const envelope = build_parallel_envelope(
            results.map((r) => r.agent_id),
            results,
          );
          const compare = input.use_parsed ? "parsed" : undefined;
          const conflict_set = detect_conflicts(results, compare);
          const reconciled = apply_reconcile_policy(envelope, input.policy, conflict_set);
          return { output: serialize_result(reconciled) };
        }

        if (input.type === "critic") {
          const { verdict } = evaluate_critic_condition(input.value, input.condition);
          return { output: verdict };
        }

        if (input.type === "read_model") {
          const model = extract_reconcile_read_model(input.memory);
          switch (input.field) {
            case "has_failures":   return { output: String(model.has_failures) };
            case "total_conflicts": return { output: String(model.total_conflicts) };
            case "unresolved_count": return { output: String(model.unresolved_count) };
            case "reconcile_count": return { output: String(model.reconcile_summaries.length) };
            case "critic_count":   return { output: String(model.critic_summaries.length) };
          }
        }

        return { output: "", error: `unknown type: ${(input as Record<string, unknown>).type}` };
      } catch (e) {
        return { output: "", error: e instanceof Error ? e.message : String(e) };
      }
    },
  };
}
