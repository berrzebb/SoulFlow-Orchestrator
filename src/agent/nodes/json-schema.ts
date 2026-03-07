/** JSON Schema 노드 핸들러 — 워크플로우에서 JSON Schema 검증/생성. */

import type { NodeHandler } from "../node-registry.js";
import type { JsonSchemaNodeDefinition, OrcheNodeDefinition } from "../workflow-node.types.js";
import type { OrcheNodeExecutorContext, OrcheNodeExecuteResult, OrcheNodeTestResult } from "../orche-node-executor.js";
import { resolve_templates } from "../orche-node-executor.js";

export const json_schema_handler: NodeHandler = {
  node_type: "json_schema",
  icon: "\u{1F4CB}",
  color: "#5c6bc0",
  shape: "rect",
  output_schema: [
    { name: "result", type: "unknown", description: "Schema operation result" },
    { name: "valid", type: "boolean", description: "Validation result" },
  ],
  input_schema: [
    { name: "action", type: "string", description: "validate / generate / draft_convert / merge / diff / dereference / mock" },
    { name: "schema", type: "string", description: "JSON Schema" },
  ],
  create_default: () => ({ action: "validate", schema: "", data: "" }),

  async execute(node: OrcheNodeDefinition, ctx: OrcheNodeExecutorContext): Promise<OrcheNodeExecuteResult> {
    const n = node as JsonSchemaNodeDefinition;
    try {
      const { JsonSchemaTool } = await import("../tools/json-schema.js");
      const tool = new JsonSchemaTool();
      const tpl = { memory: ctx.memory };
      const result = await tool.execute({
        action: n.action || "validate",
        schema: n.schema ? resolve_templates(n.schema, tpl) : undefined,
        data: n.data ? resolve_templates(n.data, tpl) : undefined,
        target_draft: n.target_draft,
        schema2: n.schema2 ? resolve_templates(n.schema2, tpl) : undefined,
      });
      const parsed = JSON.parse(result);
      return { output: { result: parsed, valid: parsed.valid ?? true } };
    } catch {
      return { output: { result: null, valid: false } };
    }
  },

  test(node: OrcheNodeDefinition): OrcheNodeTestResult {
    const n = node as JsonSchemaNodeDefinition;
    const warnings: string[] = [];
    if (n.action === "validate" && !n.schema) warnings.push("schema is required for validate");
    return { preview: { action: n.action }, warnings };
  },
};
