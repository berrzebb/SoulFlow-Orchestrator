/** SQL Builder 노드 핸들러 — 워크플로우에서 SQL 쿼리 빌드. */

import type { NodeHandler } from "../node-registry.js";
import type { SqlBuilderNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";

export const sql_builder_handler: NodeHandler = {
  node_type: "sql_builder",
  icon: "\u{1F4CA}",
  color: "#336791",
  shape: "rect",
  output_schema: [
    { name: "sql", type: "string", description: "Generated SQL query" },
    { name: "params", type: "unknown", description: "Bind parameters" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "select / insert / update / delete / create_table" },
    { name: "table", type: "string", description: "Table name" },
  ],
  create_default: () => ({ action: "select", table: "", columns: '["*"]', dialect: "sqlite" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as SqlBuilderNodeDefinition;
    try {
      const { SqlBuilderTool } = await import("../tools/sql-builder.js");
      const tool = new SqlBuilderTool();
      const tpl = { memory: ctx.memory };
      const result = await tool.execute({
        action: n.action || "select",
        table: resolve_templates(n.table || "", tpl),
        columns: n.columns,
        where: n.where,
        values: n.values,
        order_by: n.order_by,
        limit: n.limit,
        dialect: n.dialect || "sqlite",
      });
      const parsed = result.startsWith("{") ? JSON.parse(result) : { sql: result };
      return { output: { sql: parsed.sql || result, params: parsed.params || [] } };
    } catch {
      return { output: { sql: "", params: [] } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as SqlBuilderNodeDefinition;
    const warnings: string[] = [];
    if (!n.table) warnings.push("table is required");
    return { preview: { action: n.action, table: n.table }, warnings };
  },
};
