/** OpenAPI 노드 핸들러 — 워크플로우에서 OpenAPI 스펙 처리. */

import type { NodeHandler } from "../node-registry.js";
import type { OpenApiNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";

export const openapi_handler: NodeHandler = {
  node_type: "openapi",
  icon: "\u{1F4D6}",
  color: "#43a047",
  shape: "rect",
  output_schema: [
    { name: "result", type: "unknown", description: "OpenAPI operation result" },
    { name: "success", type: "boolean", description: "Whether operation succeeded" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "parse / list_endpoints / get_operation / validate / generate_client / to_markdown" },
    { name: "spec", type: "string", description: "OpenAPI spec JSON" },
  ],
  create_default: () => ({ action: "list_endpoints", spec: "" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as OpenApiNodeDefinition;
    try {
      const { OpenApiTool } = await import("../tools/openapi.js");
      const tool = new OpenApiTool();
      const tpl = { memory: ctx.memory };
      const result = await tool.execute({
        action: n.action || "list_endpoints",
        spec: n.spec ? resolve_templates(n.spec, tpl) : undefined,
        path: n.path ? resolve_templates(n.path, tpl) : undefined,
        method: n.method,
        language: n.language,
      });
      const parsed = result.startsWith("{") || result.startsWith("[") ? JSON.parse(result) : { data: result };
      return { output: { result: parsed, success: !parsed.error } };
    } catch {
      return { output: { result: null, success: false } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as OpenApiNodeDefinition;
    const warnings: string[] = [];
    if (!n.spec) warnings.push("spec is required");
    return { preview: { action: n.action }, warnings };
  },
};
