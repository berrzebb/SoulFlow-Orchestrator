/** Math 노드 핸들러 — 워크플로우에서 수학 연산. */

import type { NodeHandler } from "../node-registry.js";
import type { MathNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";
import { error_message } from "../../utils/common.js";

export const math_handler: NodeHandler = {
  node_type: "math",
  icon: "\u{1F522}",
  color: "#1565c0",
  shape: "rect",
  output_schema: [
    { name: "result",  type: "string",  description: "Math result" },
    { name: "success", type: "boolean", description: "Whether operation succeeded" },
  ],
  input_schema: [
    { name: "operation",  type: "string", description: "eval/convert/compound_interest/loan_payment/roi/..." },
    { name: "expression", type: "string", description: "Math expression (for eval)" },
  ],
  create_default: () => ({ operation: "eval", expression: "", value: 0, from: "", to: "", principal: 0, rate: 0, periods: 0 }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as MathNodeDefinition;
    try {
      if (n.operation === "currency") {
        const { CurrencyTool } = await import("../tools/currency.js");
        const tool = new CurrencyTool();
        const result = await tool.execute({
          action: n.currency_action || "info",
          code: n.currency_code, from: n.currency_from, to: n.currency_to,
          amount: n.currency_amount, text: n.expression,
        });
        return { output: { result, success: !result.startsWith("{\"error\"") } };
      }
      const { MathTool } = await import("../tools/math.js");
      const tool = new MathTool();
      const tpl = { memory: ctx.memory };
      const result = await tool.execute({
        operation: n.operation || "eval",
        expression: resolve_templates(n.expression || "", tpl),
        value: n.value, from: n.from, to: n.to,
        principal: n.principal, rate: n.rate, periods: n.periods,
        cost: n.cost, gain: n.gain, decimals: n.decimals,
        a: n.a, b: n.b, n: n.n,
      });
      return { output: { result, success: !result.startsWith("Error:") } };
    } catch (err) {
      return { output: { result: error_message(err), success: false } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as MathNodeDefinition;
    const warnings: string[] = [];
    if (n.operation === "eval" && !n.expression?.trim()) warnings.push("expression is required for eval");
    if (n.operation === "convert" && (!n.from || !n.to)) warnings.push("from and to units are required for convert");
    return { preview: { operation: n.operation }, warnings };
  },
};
