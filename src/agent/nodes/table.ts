/** Table 노드 핸들러 — 워크플로우에서 테이블 데이터 연산. */

import type { NodeHandler } from "../node-registry.js";
import type { TableNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";
import { error_message } from "../../utils/common.js";

export const table_handler: NodeHandler = {
  node_type: "table",
  icon: "\u{1F4CB}",
  color: "#00695c",
  shape: "rect",
  output_schema: [
    { name: "result",  type: "string",  description: "Table operation result (JSON)" },
    { name: "success", type: "boolean", description: "Whether operation succeeded" },
  ],
  input_schema: [
    { name: "operation", type: "string", description: "sort/filter/group_by/join/pivot/aggregate/..." },
    { name: "data",      type: "string", description: "JSON array of objects" },
  ],
  create_default: () => ({ operation: "sort", data: "", data2: "", field: "", condition: "", join_field: "id", join_type: "inner", agg: "count" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as TableNodeDefinition;
    try {
      const { TableTool } = await import("../tools/table.js");
      const tool = new TableTool();
      const tpl = { memory: ctx.memory };
      const result = await tool.execute({
        operation: n.operation || "sort",
        data: resolve_templates(n.data || "", tpl),
        data2: resolve_templates(n.data2 || "", tpl),
        field: n.field || "",
        fields: n.fields || "",
        order: n.order || "asc",
        condition: resolve_templates(n.condition || "", tpl),
        join_field: n.join_field || "id",
        join_type: n.join_type || "inner",
        agg: n.agg || "count",
        value_field: n.value_field || "value",
        start: n.start, end: n.end,
      });
      return { output: { result, success: !result.startsWith("Error:") } };
    } catch (err) {
      return { output: { result: error_message(err), success: false } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as TableNodeDefinition;
    const warnings: string[] = [];
    if (!n.data?.trim()) warnings.push("data is required");
    return { preview: { operation: n.operation }, warnings };
  },
};
