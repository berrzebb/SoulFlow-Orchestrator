/** PAR-2: Reconcile (병렬 결과 합의) 노드 핸들러. */

import type { NodeHandler } from "../node-registry.js";
import type { ReconcileNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import {
  build_parallel_envelope,
  detect_conflicts,
  type ParallelAgentResult,
} from "../../orchestration/parallel-contracts.js";
import { apply_reconcile_policy } from "../../orchestration/reconcile-policy.js";

export const reconcile_handler: NodeHandler = {
  node_type: "reconcile",
  icon: "⚖",
  color: "#795548",
  shape: "diamond",
  output_schema: [
    { name: "reconciled",       type: "unknown", description: "최종 합의된 값" },
    { name: "conflicts",        type: "object",  description: "충돌이 감지된 필드 목록" },
    { name: "policy_applied",   type: "string",  description: "적용된 해소 정책" },
    { name: "succeeded",        type: "number",  description: "성공한 에이전트 수" },
    { name: "failed",           type: "number",  description: "실패한 에이전트 수" },
  ],
  input_schema: [
    { name: "source_node_ids", type: "array",  description: "병렬 실행된 노드 ID 목록" },
    { name: "policy",          type: "string", description: "해소 정책" },
  ],
  create_default: () => ({
    source_node_ids: [],
    policy: "majority_vote" as const,
    use_parsed: false,
  }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as ReconcileNodeDefinition;
    const results = collect_results(n.source_node_ids, ctx.memory, n.use_parsed);
    const envelope = build_parallel_envelope(n.source_node_ids, results);
    const conflicts = detect_conflicts(results, n.use_parsed ? "parsed" : undefined);
    // use_parsed가 false이면 conflict_set 없이 content 문자열 직접 해소
    const reconciled = apply_reconcile_policy(envelope, n.policy, n.use_parsed ? conflicts : undefined);
    return {
      output: {
        reconciled,
        conflicts,
        policy_applied: n.policy,
        succeeded: envelope.succeeded,
        failed: envelope.failed,
      },
    };
  },

  test(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): OrcheNodeTestResult {
    const n = node as ReconcileNodeDefinition;
    const warnings: string[] = [];
    if (!n.source_node_ids?.length) warnings.push("source_node_ids is empty");
    const missing = (n.source_node_ids ?? []).filter((id) => !(id in ctx.memory));
    if (missing.length) warnings.push(`upstream data not yet available: ${missing.join(", ")}`);
    return {
      preview: { policy: n.policy, source_count: n.source_node_ids?.length ?? 0, use_parsed: n.use_parsed },
      warnings,
    };
  },
};

/** memory에서 source_node_ids에 해당하는 결과를 ParallelAgentResult로 수집. */
function collect_results(
  source_ids: string[],
  memory: Record<string, unknown>,
  use_parsed?: boolean,
): ParallelAgentResult[] {
  return source_ids.map((id) => {
    const value = memory[id];
    if (value === undefined || value === null) {
      return { agent_id: id, content: null, error: `no_data:${id}` };
    }
    if (typeof value === "string") {
      return { agent_id: id, content: value };
    }
    if (typeof value === "object") {
      const obj = value as Record<string, unknown>;
      const content = typeof obj["content"] === "string" ? obj["content"] : null;
      const parsed = use_parsed ? (obj["parsed"] ?? obj) : undefined;
      const error = typeof obj["error"] === "string" ? obj["error"] : undefined;
      return { agent_id: id, content, parsed, ...(error ? { error } : {}) };
    }
    return { agent_id: id, content: String(value) };
  });
}
