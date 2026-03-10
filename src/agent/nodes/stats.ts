/** Stats 노드 핸들러 — 워크플로우에서 수치 통계 분석. */

import type { NodeHandler } from "../node-registry.js";
import type { StatsNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";
import { error_message } from "../../utils/common.js";

export const stats_handler: NodeHandler = {
  node_type: "stats",
  icon: "\u{1F4CA}",
  color: "#283593",
  shape: "rect",
  output_schema: [
    { name: "result",  type: "string",  description: "Statistics result (JSON)" },
    { name: "success", type: "boolean", description: "Whether analysis succeeded" },
  ],
  input_schema: [
    { name: "operation", type: "string", description: "summary/percentile/histogram/correlation/normalize/outliers" },
    { name: "data",      type: "string", description: "Numeric data" },
  ],
  create_default: () => ({ operation: "summary", data: "", data2: "", percentile: 50, bins: 10, threshold: 2, window: 3, alpha: 0.3, periods: 5, lag: 1 }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as StatsNodeDefinition;
    const tpl = { memory: ctx.memory };
    const op = n.operation || "summary";
    const data = resolve_templates(n.data || "", tpl);

    // 시계열 연산은 TimeseriesTool로 위임
    const TIMESERIES_OPS = ["moving_average", "ema", "linear_forecast", "anomaly", "diff", "cumsum", "normalize", "autocorrelation"];
    if (TIMESERIES_OPS.includes(op)) {
      try {
        const { TimeseriesTool } = await import("../tools/timeseries.js");
        const tool = new TimeseriesTool();
        const result = await tool.execute({
          action: op,
          data,
          window: n.window ?? 3,
          alpha: n.alpha ?? 0.3,
          periods: n.periods ?? 5,
          threshold: n.threshold ?? 2,
          lag: n.lag ?? 1,
        });
        return { output: { result, success: !result.startsWith("{\"error\"") } };
      } catch (err) {
        return { output: { result: error_message(err), success: false } };
      }
    }

    try {
      const { StatsTool } = await import("../tools/stats.js");
      const tool = new StatsTool();
      const result = await tool.execute({
        operation: op,
        data,
        data2: resolve_templates(n.data2 || "", tpl),
        percentile: n.percentile ?? 50,
        bins: n.bins ?? 10,
        threshold: n.threshold ?? 2,
      });
      return { output: { result, success: !result.startsWith("Error:") } };
    } catch (err) {
      return { output: { result: error_message(err), success: false } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as StatsNodeDefinition;
    const warnings: string[] = [];
    if (!n.data?.trim()) warnings.push("data is required");
    if (n.operation === "correlation" && !n.data2?.trim()) warnings.push("data2 is required for correlation");
    return { preview: { operation: n.operation }, warnings };
  },
};
