/** GraphQL 노드 핸들러 — 워크플로우에서 GraphQL 쿼리 실행. */

import type { NodeHandler } from "../node-registry.js";
import type { GraphqlNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";
import { error_message } from "../../utils/common.js";

export const graphql_handler: NodeHandler = {
  node_type: "graphql",
  icon: "\u25C7",
  color: "#e535ab",
  shape: "rect",
  output_schema: [
    { name: "data", type: "string", description: "Response data JSON" },
    { name: "status", type: "number", description: "HTTP status code" },
    { name: "success", type: "boolean", description: "Whether query succeeded" },
  ],
  input_schema: [
    { name: "url", type: "string", description: "GraphQL endpoint URL" },
    { name: "query", type: "string", description: "GraphQL query" },
    { name: "variables", type: "string", description: "JSON variables" },
  ],
  create_default: () => ({ url: "", query: "", variables: "{}", headers: "{}", operation_name: "" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as GraphqlNodeDefinition;
    try {
      const { GraphqlTool } = await import("../tools/graphql.js");
      const tool = new GraphqlTool();
      const tpl = { memory: ctx.memory };
      const result = await tool.execute({
        action: "query",
        url: resolve_templates(n.url || "", tpl),
        query: resolve_templates(n.query || "", tpl),
        variables: resolve_templates(n.variables || "{}", tpl),
        headers: resolve_templates(n.headers || "{}", tpl),
        operation_name: n.operation_name || "",
      });
      const parsed = result.startsWith("{") ? JSON.parse(result) : {};
      return { output: { data: JSON.stringify(parsed.data ?? {}), status: parsed.status ?? 0, success: !result.startsWith("Error:") } };
    } catch (err) {
      return { output: { data: "{}", status: 0, success: false } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as GraphqlNodeDefinition;
    const warnings: string[] = [];
    if (!n.url) warnings.push("url is required");
    if (!n.query) warnings.push("query is required");
    return { preview: { url: n.url }, warnings };
  },
};
