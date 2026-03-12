/** GraphQL 도구 — GraphQL 쿼리/뮤테이션 실행. */

import { Tool } from "./base.js";
import { error_message, make_abort_signal } from "../../utils/common.js";
import { HTTP_FETCH_TIMEOUT_MS } from "../../utils/timeouts.js";
import type { JsonSchema, ToolExecutionContext } from "./types.js";

export class GraphqlTool extends Tool {
  readonly name = "graphql";
  readonly category = "external" as const;
  readonly policy_flags = { network: true } as const;
  readonly description = "Execute GraphQL queries and mutations. Supports variables, custom headers, and introspection.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["query", "introspect"], description: "Operation (default: query)" },
      url: { type: "string", description: "GraphQL endpoint URL" },
      query: { type: "string", description: "GraphQL query/mutation string" },
      variables: { type: "string", description: "JSON variables string" },
      headers: { type: "string", description: "JSON headers string" },
      operation_name: { type: "string", description: "Operation name (for multi-operation documents)" },
    },
    required: ["url"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>, context?: ToolExecutionContext): Promise<string> {
    const action = String(params.action || "query");
    const url = String(params.url || "").trim();
    if (!url) return "Error: url is required";

    try { new URL(url); } catch { return "Error: invalid URL"; }

    if (action === "introspect") {
      return this.execute_query(url, INTROSPECTION_QUERY, {}, null, params, context);
    }

    const query = String(params.query || "").trim();
    if (!query) return "Error: query is required";

    let variables: Record<string, unknown> = {};
    if (params.variables) {
      try { variables = JSON.parse(String(params.variables)); } catch { return "Error: invalid variables JSON"; }
    }

    const op_name = params.operation_name ? String(params.operation_name) : null;
    return this.execute_query(url, query, variables, op_name, params, context);
  }

  private async execute_query(
    url: string, query: string, variables: Record<string, unknown>,
    operation_name: string | null, params: Record<string, unknown>, context?: ToolExecutionContext,
  ): Promise<string> {
    let custom_headers: Record<string, string> = {};
    if (params.headers) {
      try { custom_headers = JSON.parse(String(params.headers)); } catch { return "Error: invalid headers JSON"; }
    }

    const body: Record<string, unknown> = { query, variables };
    if (operation_name) body.operationName = operation_name;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...custom_headers },
        body: JSON.stringify(body),
        signal: make_abort_signal(HTTP_FETCH_TIMEOUT_MS, context?.signal),
      });

      const text = await res.text();
      let data: unknown;
      try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 5000) }; }

      return JSON.stringify({ status: res.status, data }, null, 2);
    } catch (err) {
      return `Error: ${error_message(err)}`;
    }
  }
}

const INTROSPECTION_QUERY = `query IntrospectionQuery {
  __schema {
    queryType { name }
    mutationType { name }
    types {
      name kind description
      fields(includeDeprecated: false) { name type { name kind ofType { name kind } } }
    }
  }
}`;
