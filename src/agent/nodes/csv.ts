/** CSV 노드 핸들러 — 워크플로우에서 CSV 파싱/생성. */

import type { NodeHandler } from "../node-registry.js";
import type { CsvNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";

export const csv_handler: NodeHandler = {
  node_type: "csv",
  icon: "\u{1F4CA}",
  color: "#4caf50",
  shape: "rect",
  output_schema: [
    { name: "result", type: "unknown", description: "Parsed rows or generated CSV" },
    { name: "count", type: "number", description: "Row count" },
    { name: "success", type: "boolean", description: "Whether operation succeeded" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "parse / generate" },
    { name: "data", type: "string", description: "CSV or JSON data" },
  ],
  create_default: () => ({ action: "parse", data: "", delimiter: ",", has_header: true }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as CsvNodeDefinition;
    try {
      const { CsvTool } = await import("../tools/csv.js");
      const tool = new CsvTool();
      const tpl = { memory: ctx.memory };
      const result = await tool.execute({
        action: n.action || "parse",
        data: resolve_templates(n.data || "", tpl),
        delimiter: n.delimiter || ",",
        has_header: n.has_header !== false,
      });
      const parsed = result.startsWith("{") ? JSON.parse(result) : {};
      return { output: { result: parsed.rows ?? parsed, count: parsed.count ?? 0, success: !result.startsWith("Error:") } };
    } catch (_err) {
      return { output: { result: null, count: 0, success: false } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as CsvNodeDefinition;
    const warnings: string[] = [];
    if (!n.data) warnings.push("data is required");
    return { preview: { action: n.action, delimiter: n.delimiter || "," }, warnings };
  },
};
