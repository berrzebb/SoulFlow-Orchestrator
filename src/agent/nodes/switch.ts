/** Switch (N-way 분기) 노드 핸들러. */

import { createContext, runInNewContext } from "node:vm";
import type { NodeHandler } from "../node-registry.js";
import type { SwitchNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { error_message } from "../../utils/common.js";

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

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as SwitchNodeDefinition;
    const sandbox = createContext({ memory: ctx.memory });
    try {
      const result = String(runInNewContext(n.expression, sandbox, { timeout: 1_000 }));
      const matched = n.cases?.find((c) => c.value === result);
      return {
        output: { matched_case: matched ? matched.value : "default" },
        branch: matched ? matched.value : "default",
      };
    } catch (e) {
      throw new Error(`switch expression evaluation failed: ${error_message(e)}`);
    }
  },

  test(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): OrcheNodeTestResult {
    const n = node as SwitchNodeDefinition;
    const warnings: string[] = [];
    if (!n.expression?.trim()) warnings.push("expression is empty");
    try {
      const sandbox = createContext({ memory: ctx.memory });
      const result = runInNewContext(n.expression, sandbox, { timeout: 500 });
      return { preview: { expression: n.expression, would_match: String(result), cases: n.cases?.length || 0 }, warnings };
    } catch (e) {
      warnings.push(`expression error: ${error_message(e)}`);
      return { preview: { expression: n.expression, cases: n.cases?.length || 0 }, warnings };
    }
  },
};
