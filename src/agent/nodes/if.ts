/** IF (조건 분기) 노드 핸들러. */

import { createContext, runInNewContext } from "node:vm";
import type { NodeHandler } from "../node-registry.js";
import type { IfNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { error_message } from "../../utils/common.js";

export const if_handler: NodeHandler = {
  node_type: "if",
  icon: "?",
  color: "#f39c12",
  shape: "diamond",
  output_schema: [
    { name: "branch",           type: "string",  description: '"true" or "false"' },
    { name: "condition_result", type: "boolean", description: "Evaluated condition" },
  ],
  input_schema: [
    { name: "value", type: "unknown", description: "Value to evaluate" },
  ],
  create_default: () => ({ condition: "true" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as IfNodeDefinition;
    const sandbox = createContext({ memory: ctx.memory });
    try {
      const result = runInNewContext(n.condition, sandbox, { timeout: 1_000 });
      const branch = Boolean(result);
      return {
        output: { condition_result: branch, branch: branch ? "true" : "false" },
        branch: branch ? "true" : "false",
      };
    } catch (e) {
      throw new Error(`if condition evaluation failed: ${error_message(e)}`, { cause: e });
    }
  },

  test(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): OrcheNodeTestResult {
    const n = node as IfNodeDefinition;
    const warnings: string[] = [];
    try {
      const sandbox = createContext({ memory: ctx.memory });
      const result = runInNewContext(n.condition, sandbox, { timeout: 500 });
      return { preview: { condition: n.condition, would_take: result ? "true" : "false" }, warnings };
    } catch (e) {
      warnings.push(`condition evaluation error: ${error_message(e)}`);
      return { preview: { condition: n.condition, would_take: "unknown" }, warnings };
    }
  },
};
