/** DateCalc 노드 핸들러 — 워크플로우에서 날짜/시간 계산. */

import type { NodeHandler } from "../node-registry.js";
import type { DateCalcNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";
import { error_message } from "../../utils/common.js";

export const date_calc_handler: NodeHandler = {
  node_type: "date_calc",
  icon: "\u{1F4C5}",
  color: "#e65100",
  shape: "rect",
  output_schema: [
    { name: "result",  type: "string",  description: "Date calculation result" },
    { name: "success", type: "boolean", description: "Whether operation succeeded" },
  ],
  input_schema: [
    { name: "operation", type: "string", description: "add/diff/timezone/business_days/format/parse/..." },
    { name: "date",      type: "string", description: "Input date (ISO 8601)" },
  ],
  create_default: () => ({ operation: "now", date: "", date2: "", amount: 0, unit: "d", from_tz: "UTC", to_tz: "UTC", format: "YYYY-MM-DD" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as DateCalcNodeDefinition;
    try {
      const { DateTimeTool } = await import("../tools/datetime.js");
      const tool = new DateTimeTool();
      const tpl = { memory: ctx.memory };
      const result = await tool.execute({
        action: n.operation || "now",
        date: resolve_templates(n.date || "", tpl),
        date2: resolve_templates(n.date2 || "", tpl),
        amount: n.amount, unit: n.unit,
        from_tz: n.from_tz, to_tz: n.to_tz,
        format: n.format,
        start_date: resolve_templates(n.start_date || "", tpl),
        end_date: resolve_templates(n.end_date || "", tpl),
        step_days: n.step_days,
      });
      return { output: { result, success: !result.startsWith("Error:") } };
    } catch (err) {
      return { output: { result: error_message(err), success: false } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as DateCalcNodeDefinition;
    return { preview: { operation: n.operation }, warnings: [] };
  },
};
