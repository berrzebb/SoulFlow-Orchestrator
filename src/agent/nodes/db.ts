/** DB (데이터베이스) 노드 핸들러. */

import type { NodeHandler, RunnerContext } from "../node-registry.js";
import type { DbNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";
import { error_message } from "../../utils/common.js";

export const db_handler: NodeHandler = {
  node_type: "db",
  icon: "⛁",
  color: "#e74c3c",
  shape: "rect",
  output_schema: [
    { name: "rows",          type: "array",  description: "Query result rows" },
    { name: "affected_rows", type: "number", description: "Affected row count" },
  ],
  input_schema: [
    { name: "query",      type: "string", description: "SQL or query expression" },
    { name: "datasource", type: "string", description: "Datasource identifier" },
    { name: "params",     type: "object", description: "Query parameters" },
  ],
  create_default: () => ({ operation: "query", datasource: "", query: "" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as DbNodeDefinition;
    const tpl_ctx = { memory: ctx.memory };
    const query = resolve_templates(n.query, tpl_ctx);
    const datasource = resolve_templates(n.datasource, tpl_ctx);

    return {
      output: {
        rows: [],
        affected_rows: 0,
        _meta: { operation: n.operation, datasource, query, resolved: true },
      },
    };
  },

  async runner_execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext, runner: RunnerContext): Promise<OrcheNodeExecuteResult> {
    const qdb = runner.services?.query_db;
    if (!qdb) return this.execute(node, ctx);

    const n = node as DbNodeDefinition;
    const tpl_ctx = { memory: ctx.memory };
    const query = resolve_templates(n.query, tpl_ctx);
    const datasource = resolve_templates(n.datasource, tpl_ctx);

    try {
      const result = await qdb(datasource, query, n.params as Record<string, unknown> | undefined);
      return { output: { rows: result.rows, affected_rows: result.affected_rows } };
    } catch (err) {
      runner.logger.warn("db_node_error", { node_id: n.node_id, error: error_message(err) });
      return { output: { rows: [], affected_rows: 0, error: error_message(err) } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as DbNodeDefinition;
    const warnings: string[] = [];
    if (!n.datasource) warnings.push("datasource is empty");
    if (!n.query) warnings.push("query is empty");
    if (n.operation === "delete" && !n.query.toLowerCase().includes("where")) {
      warnings.push("DELETE without WHERE — all rows will be affected");
    }
    return { preview: { operation: n.operation, datasource: n.datasource, query: n.query }, warnings };
  },
};
