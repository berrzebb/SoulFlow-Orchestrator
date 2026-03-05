/** Switch (N-way 분기) 노드 핸들러. */

import type { NodeHandler } from "../node-registry.js";
import type { SwitchNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";

export const switch_handler: NodeHandler = {
  node_type: "switch",
  icon: "⑆",
  color: "#ff9800",
  shape: "diamond",
  output_schema: [
    { name: "matched_case", type: "string", description: "Matched case value" },
  ],
  input_schema: [
    { name: "value", type: "unknown", description: "Value to evaluate" },
  ],
  create_default: () => ({ expression: "value", cases: [{ value: "a", targets: [] }] }),

  async execute(): Promise<OrcheNodeExecuteResult> {
    // 스텁: 실제 expression 평가는 추후 구현
    return { output: { matched_case: "default" } };
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as SwitchNodeDefinition;
    const warnings: string[] = [];
    if (!n.expression?.trim()) warnings.push("expression is empty");
    return { preview: { expression: n.expression, cases: n.cases?.length || 0 }, warnings };
  },
};
