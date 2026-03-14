/** PAR-3: CriticGate (조건 평가 + retry budget) 노드 핸들러. */

import type { NodeHandler } from "../node-registry.js";
import type { CriticGateNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import {
  evaluate_critic_condition,
  DEFAULT_MAX_ROUNDS,
  type CriticGateResult,
} from "../../orchestration/critic-gate.js";

export const critic_gate_handler: NodeHandler = {
  node_type: "critic_gate",
  icon: "⚖",
  color: "#9c27b0",
  shape: "diamond",
  output_schema: [
    { name: "verdict",             type: "string",  description: "pass | fail | rework" },
    { name: "passed",              type: "boolean", description: "verdict === pass" },
    { name: "reason",              type: "string",  description: "판정 이유" },
    { name: "rework_instruction",  type: "string",  description: "rework 시 downstream 지시" },
    { name: "rounds_used",         type: "number",  description: "소비된 라운드 수" },
  ],
  input_schema: [
    { name: "source_node_id", type: "string", description: "평가 대상 노드 ID" },
    { name: "condition",      type: "string", description: "JS 조건 표현식 (value 참조)" },
  ],
  create_default: () => ({
    source_node_id: "",
    condition: "value !== null && value !== undefined",
    max_rounds: DEFAULT_MAX_ROUNDS,
  }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as CriticGateNodeDefinition;
    const max_rounds = n.max_rounds ?? DEFAULT_MAX_ROUNDS;

    // memory에서 이전 라운드 수를 읽어 budget 누적
    const rounds_key = `${n.node_id}__rounds_used`;
    const prev_rounds = (ctx.memory[rounds_key] as number | undefined) ?? 0;
    const rounds_used = prev_rounds + 1;

    const value = ctx.memory[n.source_node_id];
    let result: CriticGateResult;

    if (rounds_used > max_rounds && prev_rounds > 0) {
      // 예산 초과 — 강제 fail
      result = { verdict: "fail", reason: `critic budget exhausted after ${max_rounds} rounds` };
    } else {
      result = evaluate_critic_condition(value, n.condition);
      // rework이지만 이번 라운드가 마지막이면 fail로 전환
      if (result.verdict === "rework" && rounds_used > max_rounds) {
        result = { verdict: "fail", reason: `critic budget exhausted after ${max_rounds} rounds` };
      }
    }

    // 다음 실행을 위해 rounds_used 기록 (pass/fail 이면 초기화)
    ctx.memory[rounds_key] = result.verdict === "rework" ? rounds_used : 0;

    return {
      output: {
        verdict: result.verdict,
        passed: result.verdict === "pass",
        reason: result.reason ?? null,
        rework_instruction: result.verdict === "rework"
          ? (result.rework_instruction ?? n.rework_instruction ?? null)
          : null,
        rounds_used,
      },
    };
  },

  test(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): OrcheNodeTestResult {
    const n = node as CriticGateNodeDefinition;
    const warnings: string[] = [];
    if (!n.source_node_id?.trim()) warnings.push("source_node_id is required");
    if (!n.condition?.trim()) warnings.push("condition expression is required");
    const missing = n.source_node_id && !(n.source_node_id in ctx.memory);
    if (missing) warnings.push(`upstream data not yet available: ${n.source_node_id}`);
    return {
      preview: {
        source_node_id: n.source_node_id,
        condition: n.condition,
        max_rounds: n.max_rounds ?? DEFAULT_MAX_ROUNDS,
      },
      warnings,
    };
  },
};
