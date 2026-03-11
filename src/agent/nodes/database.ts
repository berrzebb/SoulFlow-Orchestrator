/** Database 노드 핸들러 — 워크플로우에서 SQLite 데이터소스 쿼리. */

import type { NodeHandler } from "../node-registry.js";
import type { DatabaseNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates, node_error } from "../orche-node-executor.js";
import { error_message } from "../../utils/common.js";

export const database_handler: NodeHandler = {
  node_type: "database",
  icon: "\u{1F5C4}",
  color: "#1565c0",
  shape: "rect",
  output_schema: [
    { name: "result",  type: "string",  description: "Query result (JSON)" },
    { name: "success", type: "boolean", description: "Whether query succeeded" },
  ],
  input_schema: [
    { name: "operation",  type: "string", description: "query/tables/schema/explain" },
    { name: "datasource", type: "string", description: "Datasource name" },
    { name: "sql",        type: "string", description: "SQL query" },
  ],
  create_default: () => ({ operation: "query", datasource: "", sql: "", table: "", max_rows: 100 }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as DatabaseNodeDefinition;
    const tpl = { memory: ctx.memory };
    const datasource = resolve_templates(n.datasource || "", tpl);
    const sql = resolve_templates(n.sql || "", tpl);

    if (!datasource) return node_error("datasource is required");

    try {
      const { DatabaseTool } = await import("../tools/database.js");
      const tool = new DatabaseTool({ workspace: ctx.workspace });
      const result = await tool.execute({
        operation: n.operation || "query",
        datasource,
        sql,
        table: n.table || "",
        max_rows: n.max_rows || 100,
      });
      return { output: { result, success: !result.startsWith("Error:") } };
    } catch (err) {
      return node_error(error_message(err));
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as DatabaseNodeDefinition;
    const warnings: string[] = [];
    if (!n.datasource?.trim()) warnings.push("datasource is required");
    if (n.operation === "query" && !n.sql?.trim()) warnings.push("sql is required");
    return { preview: { operation: n.operation, datasource: n.datasource }, warnings };
  },
};
