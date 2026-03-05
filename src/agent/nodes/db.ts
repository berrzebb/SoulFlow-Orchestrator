/** DB (데이터베이스) 노드 핸들러. */

import type { NodeHandler } from "../node-registry.js";
import type { DbNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";

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

    // 스텁: 실제 DB 연결은 datasource 설정 기반으로 런타임에서 주입.
    // phase-loop-runner가 datasource resolver를 통해 실제 실행.
    return {
      output: {
        rows: [],
        affected_rows: 0,
        _meta: { operation: n.operation, datasource, query, resolved: true },
      },
    };
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
